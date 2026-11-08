"""Load deterministic corpora shared by reading-override benchmarks."""

from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import json
from pathlib import Path


_MANIFEST_PATH = Path(__file__).parents[1] / "fixtures" / "reading_override_cases.json"


@dataclass(frozen=True)
class ReadingOverrideScenario:
    """One immutable reading-override corpus described by the shared manifest."""

    name: str
    seed: str
    target: str
    dictionary_reading: str
    replacement_reading: str
    code_points: int
    sha256: str
    target_occurrences: int


def load_manifest(path: Path = _MANIFEST_PATH) -> tuple[ReadingOverrideScenario, ...]:
    """Load immutable scenario descriptions from the compact JSON manifest."""

    manifest = json.loads(path.read_text(encoding="utf-8"))
    common = {
        "seed": manifest["seed"],
        "target": manifest["target"],
        "dictionary_reading": manifest["dictionaryReading"],
        "replacement_reading": manifest["replacementReading"],
    }
    return tuple(
        ReadingOverrideScenario(
            name=entry["name"],
            code_points=entry["codePoints"],
            sha256=entry["sha256"],
            target_occurrences=entry["targetOccurrences"],
            **common,
        )
        for entry in manifest["cases"]
    )


def build_content(case: ReadingOverrideScenario) -> str:
    """Generate and validate the exact Unicode corpus for one manifest case."""

    if case.code_points <= 0 or not case.seed:
        raise ValueError(f"invalid reading-override scenario: {case.name}")

    repetitions = (case.code_points + len(case.seed) - 1) // len(case.seed)
    content = (case.seed * repetitions)[: case.code_points]
    if len(content) != case.code_points:
        raise ValueError(f"code-point count mismatch for scenario: {case.name}")
    if content_sha256(content) != case.sha256:
        raise ValueError(f"SHA-256 mismatch for scenario: {case.name}")
    if count_target_occurrences(content, case.target) != case.target_occurrences:
        raise ValueError(f"target occurrence mismatch for scenario: {case.name}")
    return content


def content_sha256(content: str) -> str:
    """Return the UTF-8 SHA-256 digest used by the shared manifest."""

    return sha256(content.encode("utf-8")).hexdigest()


def count_target_occurrences(content: str, target: str) -> int:
    """Count non-overlapping target surfaces in a generated corpus."""

    return content.count(target)