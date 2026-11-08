"""Measure and decompose real FastAPI reading-override API latency.

The harness intentionally lives under ``tests/performance``: it instruments only
benchmark-process service and repository instances, never production code.
"""

from __future__ import annotations

import argparse
from contextlib import contextmanager
from dataclasses import asdict, dataclass, field
from importlib.metadata import PackageNotFoundError, version
import json
from pathlib import Path
import platform
import subprocess
import sys
from tempfile import TemporaryDirectory
from time import perf_counter_ns
from typing import Any, Callable, Iterator

from fastapi.testclient import TestClient


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
if str(REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT))

from backend.app.main import create_app  # noqa: E402
from backend.app.readings.models import ReadingOverride, ReadingOverrideKey  # noqa: E402
from tests.performance.reading_override_scenarios import (  # noqa: E402
    ReadingOverrideScenario,
    build_content,
    load_manifest,
)


QUERY_CLASSES = (
    "reading_overrides_existence_checks",
    "reading_overrides_exact_key_lookups",
    "analysis_cache_reads",
    "analysis_cache_writes",
    "reading_exception_snapshot_reads",
)
REQUIRED_STAGES = (
    "http_total",
    "override_service",
    "analysis",
    "override_repository",
    "analysis_repository",
    "response_and_framework_residual",
)


@dataclass
class _Span:
    name: str
    started_ns: int
    ended_ns: int = 0
    children: list["_Span"] = field(default_factory=list)

    @property
    def duration_ns(self) -> int:
        return self.ended_ns - self.started_ns


class StageRecorder:
    """Collect nested perf-counter spans and derive exclusive durations safely."""

    def __init__(self) -> None:
        self._roots: list[_Span] = []
        self._stack: list[_Span] = []
        self.enabled = True

    @contextmanager
    def stage(self, name: str) -> Iterator[None]:
        if not self.enabled:
            yield
            return
        span = _Span(name, perf_counter_ns())
        if self._stack:
            self._stack[-1].children.append(span)
        else:
            self._roots.append(span)
        self._stack.append(span)
        try:
            yield
        finally:
            span.ended_ns = perf_counter_ns()
            self._stack.pop()

    def durations(self) -> tuple[dict[str, int], dict[str, int], list[dict[str, Any]]]:
        inclusive: dict[str, int] = {}
        exclusive: dict[str, int] = {}

        def render(span: _Span) -> dict[str, Any]:
            child_duration = sum(child.duration_ns for child in span.children)
            inclusive[span.name] = inclusive.get(span.name, 0) + span.duration_ns
            exclusive[span.name] = exclusive.get(span.name, 0) + (
                span.duration_ns - child_duration
            )
            return {
                "name": span.name,
                "inclusiveNs": span.duration_ns,
                "exclusiveNs": span.duration_ns - child_duration,
                "children": [render(child) for child in span.children],
            }

        tree = [render(root) for root in self._roots]
        return inclusive, exclusive, tree


@dataclass(frozen=True)
class TimingSample:
    durations_ns: dict[str, int]
    query_counts: dict[str, int]
    operation: str
    scope: str
    cache_temperature: str
    exception_volume: int
    override_volume: int
    exclusive_durations_ns: dict[str, int] = field(default_factory=dict)
    spans: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "durationsNs": self.durations_ns,
            "exclusiveDurationsNs": self.exclusive_durations_ns,
            "spans": self.spans,
            "queryCounts": self.query_counts,
            "operation": self.operation,
            "scope": self.scope,
            "cacheTemperature": self.cache_temperature,
            "exceptionVolume": self.exception_volume,
            "overrideVolume": self.override_volume,
        }


def classify_sql(statement: str) -> str | None:
    """Classify SQL text without retaining it or any SQLite-expanded values."""
    normalized = " ".join(statement.upper().split())
    if "FROM READING_OVERRIDES" in normalized:
        if normalized.startswith("SELECT 1"):
            return "reading_overrides_existence_checks"
        if normalized.startswith("SELECT READING"):
            return "reading_overrides_exact_key_lookups"
    if "DOCUMENT_ANALYSES" in normalized:
        if normalized.startswith("SELECT"):
            return "analysis_cache_reads"
        if normalized.startswith(("INSERT", "DELETE", "UPDATE")):
            return "analysis_cache_writes"
    if normalized.startswith("SELECT") and "FROM READING_EXCEPTIONS" in normalized:
        return "reading_exception_snapshot_reads"
    return None


class _SqlCounter:
    def __init__(self) -> None:
        self.enabled = False
        self.counts = {name: 0 for name in QUERY_CLASSES}

    def trace(self, statement: str) -> None:
        if not self.enabled:
            return
        classification = classify_sql(statement)
        if classification is not None:
            self.counts[classification] += 1


def _instrument_instance(
    instance: object, method_names: tuple[str, ...], stage: str, recorder: StageRecorder
) -> Callable[[], None]:
    originals: dict[str, Callable[..., Any]] = {}
    for method_name in method_names:
        original = getattr(instance, method_name)
        originals[method_name] = original

        def wrapped(*args: Any, __original: Callable[..., Any] = original, **kwargs: Any) -> Any:
            with recorder.stage(stage):
                return __original(*args, **kwargs)

        setattr(instance, method_name, wrapped)

    def restore() -> None:
        for method_name, original in originals.items():
            setattr(instance, method_name, original)

    return restore


def _instrument_application(app: Any, recorder: StageRecorder) -> Callable[[], None]:
    restores = [
        _instrument_instance(app.state.reading_override_service, ("set_override", "delete_override"), "override_service", recorder),
        _instrument_instance(app.state.analysis_service, ("analyze",), "analysis", recorder),
        _instrument_instance(app.state.reading_override_repository, ("has_document", "get", "upsert", "delete"), "override_repository", recorder),
        _instrument_instance(app.state.analysis_repository, ("find_compatible", "save", "invalidate_document"), "analysis_repository", recorder),
    ]

    def restore() -> None:
        for callback in reversed(restores):
            callback()

    return restore


def _install_trace_callback(app: Any, counter: _SqlCounter) -> Callable[[], None]:
    database = app.state.database
    original_connect = database._connect

    def traced_connect() -> Any:
        connection = original_connect()
        connection.set_trace_callback(counter.trace)
        return connection

    database._connect = traced_connect

    def restore() -> None:
        database._connect = original_connect

    return restore


def _tokens(analysis: dict[str, Any]) -> list[dict[str, Any]]:
    return [token for block in analysis["blocks"] for token in block["tokens"]]


def _key_of(token: dict[str, Any]) -> tuple[int, int]:
    return int(token["startOffset"]), int(token["endOffset"])


def validate_operation(
    response: dict[str, Any],
    before: list[dict[str, Any]],
    after: list[dict[str, Any]],
    *,
    target: dict[str, Any],
    expected_revision: int,
    scope: str,
    operation: str,
    replacement_reading: str,
) -> None:
    """Reject a sample before timing is accepted when its API semantics drift."""
    if target.get("documentRevision", expected_revision) != expected_revision:
        raise AssertionError("target revision does not match the created document")
    target_key = _key_of(target)
    before_by_key = {_key_of(token): token for token in before}
    after_by_key = {_key_of(token): token for token in after}
    if target_key not in before_by_key or target_key not in after_by_key:
        raise AssertionError("target occurrence is absent from pre/post analysis")
    if before_by_key[target_key].get("surface") != target.get("surface"):
        raise AssertionError("target surface does not match pre-operation analysis")
    if after_by_key[target_key].get("surface") != target.get("surface"):
        raise AssertionError("target surface does not match post-operation analysis")

    if scope == "local":
        expected_keys = {target_key}
    elif scope == "vocabulary":
        vocabulary_key = target.get("vocabularyKey")
        if not vocabulary_key:
            raise AssertionError("vocabulary target has no vocabulary key")
        expected_keys = {
            key for key, token in before_by_key.items()
            if token.get("vocabularyKey") == vocabulary_key
        }
        if not expected_keys:
            raise AssertionError("vocabulary target has no matching analyzed tokens")
    else:
        raise AssertionError(f"unknown reading override scope: {scope}")

    affected_keys = (
        {key for key in expected_keys if before_by_key[key].get("hasReadingOverride")}
        if operation == "delete" and scope == "vocabulary"
        else expected_keys
    )
    if response.get("affectedOccurrenceCount") != len(affected_keys):
        raise AssertionError("affected occurrence count does not match selected tokens")
    overrides = response.get("overrides")
    if not isinstance(overrides, list):
        raise AssertionError("override response has no override list")
    if operation == "delete":
        if overrides:
            raise AssertionError("delete response must not return stored overrides")
    else:
        if len(overrides) != len(expected_keys):
            raise AssertionError("set response did not return every affected occurrence")
        returned_keys = {
            (int(item["startOffset"]), int(item["endOffset"])) for item in overrides
        }
        if returned_keys != expected_keys:
            raise AssertionError("set response targets do not match analyzed occurrences")
        for item in overrides:
            if item.get("reading") != replacement_reading:
                raise AssertionError("set response reading differs from requested reading")
            if item.get("documentRevision", expected_revision) != expected_revision:
                raise AssertionError("set response revision differs from created document")

    for key in expected_keys:
        previous, current = before_by_key[key], after_by_key.get(key)
        if current is None or current.get("surface") != previous.get("surface"):
            raise AssertionError("affected occurrence changed surface or disappeared")
        if operation == "delete":
            if current.get("hasReadingOverride") or current.get("reading") != target.get("reading"):
                raise AssertionError("delete did not restore the target reading")
        elif current.get("reading") != replacement_reading or not current.get("hasReadingOverride"):
            raise AssertionError("set did not apply the target reading")

    if scope == "local":
        for key, previous in before_by_key.items():
            if key == target_key:
                continue
            current = after_by_key.get(key)
            if current is None or (
                current.get("reading"), current.get("hasReadingOverride")
            ) != (previous.get("reading"), previous.get("hasReadingOverride")):
                raise AssertionError("local operation changed more than one occurrence")


def _seed_exceptions(app: Any, volume: int) -> int:
    repository = app.state.reading_exception_repository
    # Migration 004 always inserts one active exception (私); count it explicitly.
    seeded_active = len(repository.list_active())
    if seeded_active != 1:
        raise AssertionError("expected the migration-seeded reading exception")
    for index in range(volume):
        repository.put(f"診断語{index}", "しんだんご")
    active_count = len(repository.list_active())
    if active_count != seeded_active + volume:
        raise AssertionError("reading exception seeding count does not match requested volume")
    return active_count


def _seed_overrides(
    app: Any,
    document_id: str,
    revision: int,
    candidates: list[dict[str, Any]],
    *,
    operation: str,
    volume: int,
) -> int:
    required = volume + (1 if operation in {"replace", "delete"} else 0)
    if len(candidates) < required:
        raise ValueError(
            f"case has {len(candidates)} valid override candidates but requires {required}"
        )
    repository = app.state.reading_override_repository
    selected = candidates[:required]
    for token in selected:
        repository.upsert(ReadingOverride(
            ReadingOverrideKey(
                document_id, revision, int(token["startOffset"]), int(token["endOffset"])
            ),
            str(token["reading"]),
        ))
    # Direct setup is deliberately invalidated to let the public warm analysis
    # reflect seeded overrides before the timed API request.
    app.state.analysis_repository.invalidate_document(document_id)
    return required


def _metadata(
    case: ReadingOverrideScenario,
    *,
    scope: str,
    operation: str,
    cache_temperature: str,
    exception_volume: int,
    override_volume: int,
    seeded_exception_count: int,
    seeded_override_count: int,
) -> dict[str, Any]:
    def dependency(name: str) -> str:
        try:
            return version(name)
        except PackageNotFoundError:
            return "not-installed"

    try:
        commit = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=REPOSITORY_ROOT, text=True
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        commit = "unavailable"
    return {
        "commit": commit,
        "pythonVersion": platform.python_version(),
        "dependencies": {
            name: dependency(name)
            for name in ("fastapi", "pydantic", "SudachiPy", "SudachiDict-core")
        },
        "case": case.name,
        "caseHash": case.sha256,
        "caseCodePoints": case.code_points,
        "scope": scope,
        "operation": operation,
        "cacheTemperature": cache_temperature,
        "exceptionVolume": exception_volume,
        "overrideVolume": override_volume,
        "seededActiveExceptionCount": seeded_exception_count,
        "seededOverrideCount": seeded_override_count,
    }


def _run_sample(
    case: ReadingOverrideScenario,
    *,
    scope: str,
    operation: str,
    cache_temperature: str,
    exception_volume: int,
    override_volume: int,
    database_path: Path,
) -> tuple[TimingSample, dict[str, Any]]:
    if cache_temperature != "warm":
        raise ValueError("only warm cache measurements are supported by this diagnostic")
    content = build_content(case)
    app = create_app(database_path)
    with TestClient(app) as client:
        created = client.post("/api/documents", json={"title": case.name, "content": content})
        created.raise_for_status()
        document = created.json()
        document_id, revision = document["id"], int(document["revision"])
        seeded_exceptions = _seed_exceptions(app, exception_volume)

        initial = client.post(f"/api/documents/{document_id}/analysis")
        initial.raise_for_status()
        candidates = [token for token in _tokens(initial.json()) if token["surface"] == case.target]
        if not candidates:
            raise AssertionError("scenario target is absent from public analysis")
        seeded_overrides = _seed_overrides(
            app, document_id, revision, candidates, operation=operation, volume=override_volume
        )
        # The analysis API is used to establish and prove the exact warm state.
        warmed = client.post(f"/api/documents/{document_id}/analysis")
        warmed.raise_for_status()
        before_payload = warmed.json()
        before = _tokens(before_payload)
        target = next(token for token in before if _key_of(token) == _key_of(candidates[0]))
        target = {**target, "documentRevision": int(before_payload["documentRevision"])}
        path = f"/api/documents/{document_id}/reading-overrides"
        request = {
            "documentRevision": revision,
            "startOffset": target["startOffset"],
            "endOffset": target["endOffset"],
        }
        if scope == "vocabulary":
            request.update(scope="vocabulary", vocabularyKey=target["vocabularyKey"])
        if operation != "delete":
            request["reading"] = case.replacement_reading

        recorder, counter = StageRecorder(), _SqlCounter()
        restore_trace = _install_trace_callback(app, counter)
        restore_instrumentation = _instrument_application(app, recorder)
        try:
            counter.enabled = True
            with recorder.stage("http_total"):
                if operation == "delete":
                    response = client.request("DELETE", path, json=request)
                else:
                    response = client.put(path, json=request)
            counter.enabled = False
            response.raise_for_status()
        finally:
            counter.enabled = False
            restore_instrumentation()
            restore_trace()
        inclusive, exclusive, spans = recorder.durations()
        if "http_total" not in inclusive or "override_service" not in inclusive:
            raise AssertionError("timed request did not reach the override service")
        inclusive["response_and_framework_residual"] = (
            inclusive["http_total"] - inclusive["override_service"]
        )
        exclusive["response_and_framework_residual"] = inclusive[
            "response_and_framework_residual"
        ]
        for stage in REQUIRED_STAGES:
            inclusive.setdefault(stage, 0)
            exclusive.setdefault(stage, 0)

        # This request is outside the timing and SQL collection; it is semantic proof,
        # not part of the benchmark sample.
        after_response = client.post(f"/api/documents/{document_id}/analysis")
        after_response.raise_for_status()
        after_payload = after_response.json()
        if int(after_payload["documentRevision"]) != revision:
            raise AssertionError("post-operation analysis revision changed")
        validate_operation(
            response.json(), before, _tokens(after_payload), target=target,
            expected_revision=revision, scope=scope, operation=operation,
            replacement_reading=case.replacement_reading,
        )
    return (
        TimingSample(
            durations_ns=inclusive,
            exclusive_durations_ns=exclusive,
            spans=spans,
            query_counts=counter.counts,
            operation=operation,
            scope=scope,
            cache_temperature=cache_temperature,
            exception_volume=exception_volume,
            override_volume=override_volume,
        ),
        _metadata(
            case, scope=scope, operation=operation,
            cache_temperature=cache_temperature, exception_volume=exception_volume,
            override_volume=override_volume,
            seeded_exception_count=seeded_exceptions,
            seeded_override_count=seeded_overrides,
        ),
    )


def trace_warm_analysis_transition(case: ReadingOverrideScenario) -> dict[str, dict[str, int]]:
    """Trace two real, analyzer-warm cache misses without retaining SQL text."""
    content = build_content(case)
    with TemporaryDirectory(prefix="reading-override-trace-") as directory:
        app = create_app(Path(directory) / "trace.db")
        with TestClient(app) as client:
            created = client.post("/api/documents", json={"title": case.name, "content": content})
            created.raise_for_status()
            document = created.json()
            document_id, revision = document["id"], int(document["revision"])
            # First public analysis initializes the real analyzer. Each traced
            # request then starts from a deliberately invalidated cache, isolating
            # the resolver fast-path SQL rather than a cache-return short circuit.
            initial = client.post(f"/api/documents/{document_id}/analysis")
            initial.raise_for_status()
            token = next(item for item in _tokens(initial.json()) if item["surface"] == case.target)
            counter = _SqlCounter()
            restore_trace = _install_trace_callback(app, counter)
            try:
                app.state.analysis_repository.invalidate_document(document_id)
                counter.enabled = True
                zero = client.post(f"/api/documents/{document_id}/analysis")
                zero.raise_for_status()
                counter.enabled = False
                zero_counts = dict(counter.counts)

                app.state.reading_override_repository.upsert(ReadingOverride(
                    ReadingOverrideKey(document_id, revision, int(token["startOffset"]), int(token["endOffset"])),
                    str(token["reading"]),
                ))
                app.state.analysis_repository.invalidate_document(document_id)
                counter.counts = {name: 0 for name in QUERY_CLASSES}
                counter.enabled = True
                one = client.post(f"/api/documents/{document_id}/analysis")
                one.raise_for_status()
                counter.enabled = False
                one_counts = dict(counter.counts)
            finally:
                counter.enabled = False
                restore_trace()
    return {"zeroOverrides": zero_counts, "oneLocalOverride": one_counts}


def summarize_samples(samples: list[TimingSample]) -> dict[str, Any]:
    if len(samples) < 3:
        raise ValueError("runs must be at least 3")
    if not samples:
        raise ValueError("at least one sample is required")

    def med(values: list[int]) -> int:
        return sorted(values)[len(values) // 2]

    timing_names = set().union(*(sample.durations_ns for sample in samples))
    query_names = set().union(*(sample.query_counts for sample in samples))
    return {
        "sampleCount": len(samples),
        "timings": {
            name: {
                "samplesNs": [sample.durations_ns.get(name, 0) for sample in samples],
                "medianNs": med([sample.durations_ns.get(name, 0) for sample in samples]),
                "medianMs": round(med([sample.durations_ns.get(name, 0) for sample in samples]) / 1_000_000, 3),
                "exclusiveSamplesNs": [sample.exclusive_durations_ns.get(name, 0) for sample in samples],
                "exclusiveMedianNs": med([sample.exclusive_durations_ns.get(name, 0) for sample in samples]),
            }
            for name in sorted(timing_names)
        },
        "queryCounts": {
            name: {
                "samples": [sample.query_counts.get(name, 0) for sample in samples],
                "median": med([sample.query_counts.get(name, 0) for sample in samples]),
            }
            for name in sorted(query_names)
        },
    }


def run_scenario(
    case: ReadingOverrideScenario,
    *,
    runs: int,
    scope: str,
    operation: str,
    cache_temperature: str,
    exception_volume: int,
    override_volume: int,
    database_directory: Path | None = None,
) -> dict[str, Any]:
    if runs < 3:
        raise ValueError("runs must be at least 3")
    if scope not in {"local", "vocabulary"} or operation not in {"set", "replace", "delete"}:
        raise ValueError("scope and operation must be supported reading-override values")
    root_context = TemporaryDirectory(prefix="reading-override-benchmark-") if database_directory is None else None
    root = Path(root_context.name) if root_context is not None else database_directory
    assert root is not None
    root.mkdir(parents=True, exist_ok=True)
    try:
        samples: list[TimingSample] = []
        metadata: dict[str, Any] | None = None
        for index in range(runs):
            sample, sample_metadata = _run_sample(
                case, scope=scope, operation=operation,
                cache_temperature=cache_temperature, exception_volume=exception_volume,
                override_volume=override_volume,
                database_path=root / f"{case.name}-{scope}-{operation}-{index}.db",
            )
            samples.append(sample)
            metadata = sample_metadata
        assert metadata is not None
        return {
            "metadata": metadata,
            "samples": [sample.to_dict() for sample in samples],
            "summary": summarize_samples(samples),
        }
    finally:
        if root_context is not None:
            root_context.cleanup()


def scenario_configurations(case: ReadingOverrideScenario) -> tuple[dict[str, Any], ...]:
    """Use six representative, isolated scenarios rather than a costly cross-product.

    Each scope/operation is represented once. Exception volume rotates through
    0, 100, and 1,000; the largest feasible background-override volume is used
    for delete, so 1,000 appears when the corpus has enough occurrences.
    """
    largest = 1_000 if case.target_occurrences >= 1_001 else 100
    return tuple(
        {
            "scope": scope,
            "operation": operation,
            "cache_temperature": "warm",
            "exception_volume": exception_volume,
            "override_volume": override_volume,
        }
        for scope in ("local", "vocabulary")
        for operation, exception_volume, override_volume in (
            ("set", 0, 0),
            ("replace", 100, 100),
            ("delete", 1_000, largest),
        )
    )


def benchmark(sizes: list[int], runs: int) -> dict[str, Any]:
    if runs < 3:
        raise ValueError("runs must be at least 3")
    selected = {size for size in sizes}
    cases = [case for case in load_manifest() if case.code_points in selected]
    if len(cases) != len(selected):
        raise ValueError("each requested size must appear in the scenario manifest")
    results: list[dict[str, Any]] = []
    for case in cases:
        for configuration in scenario_configurations(case):
            results.append(run_scenario(case, runs=runs, **configuration))
    return {
        "schemaVersion": 1,
        "benchmark": "reading-override-backend-v1",
        "runsPerScenario": runs,
        "results": results,
    }


def _parse_sizes(raw: str) -> list[int]:
    try:
        sizes = [int(value) for value in raw.split(",") if value]
    except ValueError as error:
        raise argparse.ArgumentTypeError("sizes must be comma-separated integers") from error
    if not sizes or any(size <= 0 for size in sizes):
        raise argparse.ArgumentTypeError("sizes must contain positive integers")
    return sizes


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--sizes", type=_parse_sizes, default=[10_000, 50_000, 100_000])
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    result = benchmark(args.sizes, args.runs)
    # Validations have already completed for every sample before any file is written.
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"schemaVersion": result["schemaVersion"], "scenarios": len(result["results"])}, indent=2))


if __name__ == "__main__":
    main()
