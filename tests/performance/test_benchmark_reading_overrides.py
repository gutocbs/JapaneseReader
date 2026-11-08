"""Tests for the reading-override backend diagnostic harness."""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path

import pytest

from tests.performance.benchmark_reading_overrides import (
    TimingSample,
    classify_sql,
    run_scenario,
    scenario_configurations,
    trace_warm_analysis_transition,
    summarize_samples,
    validate_operation,
)
from tests.performance.reading_override_scenarios import load_manifest


def _sample(duration_ns: int) -> TimingSample:
    return TimingSample(
        durations_ns={
            "http_total": duration_ns,
            "override_service": duration_ns - 10,
            "analysis": duration_ns - 20,
            "override_repository": 5,
            "analysis_repository": 5,
            "response_and_framework_residual": 10,
        },
        query_counts={
            "reading_overrides_existence_checks": 1,
            "reading_overrides_exact_key_lookups": 0,
            "analysis_cache_reads": 1,
            "analysis_cache_writes": 0,
            "reading_exception_snapshot_reads": 1,
        },
        operation="set",
        scope="local",
        cache_temperature="warm",
        exception_volume=0,
        override_volume=0,
    )


def test_summarize_rejects_fewer_than_three_samples() -> None:
    with pytest.raises(ValueError, match="at least 3"):
        summarize_samples([_sample(100), _sample(200)])


def test_summaries_retain_all_samples_and_compute_median() -> None:
    summary = summarize_samples([_sample(300_000), _sample(100_000), _sample(200_000)])

    assert summary["sampleCount"] == 3
    assert summary["timings"]["http_total"]["samplesNs"] == [300_000, 100_000, 200_000]
    assert summary["timings"]["http_total"]["medianNs"] == 200_000
    assert summary["timings"]["http_total"]["medianMs"] == 0.2


def test_run_scenario_records_required_metadata_and_each_raw_sample(tmp_path: Path) -> None:
    case = load_manifest()[0]

    result = run_scenario(
        case,
        runs=3,
        scope="local",
        operation="set",
        cache_temperature="warm",
        exception_volume=0,
        override_volume=0,
        database_directory=tmp_path,
    )

    assert result["metadata"].keys() >= {
        "commit",
        "pythonVersion",
        "dependencies",
        "caseHash",
        "scope",
        "operation",
        "cacheTemperature",
        "exceptionVolume",
        "overrideVolume",
    }
    assert result["metadata"]["caseHash"] == case.sha256
    assert len(result["samples"]) == 3
    assert result["summary"]["sampleCount"] == 3


@pytest.mark.parametrize("operation", ["set", "replace", "delete"])
def test_validate_operation_requires_exactly_one_local_occurrence(operation: str) -> None:
    before = [{"startOffset": 10, "endOffset": 12, "reading": "きのう", "hasReadingOverride": False}]
    after = [{"startOffset": 10, "endOffset": 12, "reading": "さくじつ", "hasReadingOverride": True}]
    response = {
        "affectedOccurrenceCount": 1,
        "overrides": [] if operation == "delete" else [{"startOffset": 10, "endOffset": 12, "reading": "さくじつ"}],
    }
    if operation == "delete":
        after[0] = {**before[0]}

    validate_operation(
        response,
        before,
        after,
        target={"startOffset": 10, "endOffset": 12, "reading": "きのう"},
        expected_revision=1,
        scope="local",
        operation=operation,
        replacement_reading="さくじつ",
    )


@pytest.mark.parametrize("bad_field", ["revision", "surface", "reading", "affected"])
def test_validate_operation_rejects_semantic_mismatches_before_timing(bad_field: str) -> None:
    before = [{"startOffset": 10, "endOffset": 12, "surface": "昨日", "reading": "きのう", "hasReadingOverride": False}]
    after = [{"startOffset": 10, "endOffset": 12, "surface": "昨日", "reading": "さくじつ", "hasReadingOverride": True}]
    response = {"affectedOccurrenceCount": 1, "overrides": [{"startOffset": 10, "endOffset": 12, "reading": "さくじつ"}]}
    target = {"startOffset": 10, "endOffset": 12, "surface": "昨日", "reading": "きのう", "documentRevision": 1}
    revision = 1
    if bad_field == "revision":
        revision = 2
    elif bad_field == "surface":
        after[0]["surface"] = "今日"
    elif bad_field == "reading":
        after[0]["reading"] = "きのう"
    else:
        response["affectedOccurrenceCount"] = 2

    with pytest.raises(AssertionError):
        validate_operation(
            response,
            before,
            after,
            target=target,
            expected_revision=revision,
            scope="local",
            operation="set",
            replacement_reading="さくじつ",
        )


def test_validate_operation_checks_vocabulary_affected_count_and_all_matching_tokens() -> None:
    before = [
        {"startOffset": 0, "endOffset": 2, "surface": "昨日", "reading": "きのう", "vocabularyKey": "yesterday", "hasReadingOverride": False},
        {"startOffset": 3, "endOffset": 5, "surface": "昨日", "reading": "きのう", "vocabularyKey": "yesterday", "hasReadingOverride": False},
        {"startOffset": 6, "endOffset": 8, "surface": "今日", "reading": "きょう", "vocabularyKey": "today", "hasReadingOverride": False},
    ]
    after = deepcopy(before)
    for token in after[:2]:
        token["reading"] = "さくじつ"
        token["hasReadingOverride"] = True
    response = {
        "affectedOccurrenceCount": 2,
        "overrides": [
            {"startOffset": 0, "endOffset": 2, "reading": "さくじつ"},
            {"startOffset": 3, "endOffset": 5, "reading": "さくじつ"},
        ],
    }

    validate_operation(
        response,
        before,
        after,
        target={"startOffset": 0, "endOffset": 2, "surface": "昨日", "reading": "きのう", "vocabularyKey": "yesterday"},
        expected_revision=1,
        scope="vocabulary",
        operation="set",
        replacement_reading="さくじつ",
    )

    response["affectedOccurrenceCount"] = 1
    with pytest.raises(AssertionError, match="affected"):
        validate_operation(
            response,
            before,
            after,
            target={"startOffset": 0, "endOffset": 2, "surface": "昨日", "reading": "きのう", "vocabularyKey": "yesterday"},
            expected_revision=1,
            scope="vocabulary",
            operation="set",
            replacement_reading="さくじつ",
        )



def test_validate_operation_counts_only_existing_vocabulary_overrides_on_delete() -> None:
    before = [
        {"startOffset": 0, "endOffset": 2, "surface": "昨日", "reading": "さくじつ", "vocabularyKey": "yesterday", "hasReadingOverride": True},
        {"startOffset": 3, "endOffset": 5, "surface": "昨日", "reading": "きのう", "vocabularyKey": "yesterday", "hasReadingOverride": False},
    ]
    after = [
        {"startOffset": 0, "endOffset": 2, "surface": "昨日", "reading": "きのう", "vocabularyKey": "yesterday", "hasReadingOverride": False},
        {"startOffset": 3, "endOffset": 5, "surface": "昨日", "reading": "きのう", "vocabularyKey": "yesterday", "hasReadingOverride": False},
    ]

    validate_operation(
        {"affectedOccurrenceCount": 1, "overrides": []}, before, after,
        target={"startOffset": 0, "endOffset": 2, "surface": "昨日", "reading": "きのう", "vocabularyKey": "yesterday", "documentRevision": 1},
        expected_revision=1, scope="vocabulary", operation="delete", replacement_reading="さくじつ",
    )


def test_scenario_configurations_cover_operations_scopes_and_supported_volumes() -> None:
    small, large = load_manifest()[0], load_manifest()[-1]
    small_configurations = scenario_configurations(small)
    large_configurations = scenario_configurations(large)

    assert {(item["scope"], item["operation"]) for item in small_configurations} == {
        (scope, operation)
        for scope in ("local", "vocabulary")
        for operation in ("set", "replace", "delete")
    }
    assert {item["exception_volume"] for item in small_configurations} == {0, 100, 1_000}
    assert {item["override_volume"] for item in small_configurations} == {0, 100}
    assert {item["override_volume"] for item in large_configurations} == {0, 100, 1_000}
    assert all(
        item["override_volume"] + (item["operation"] in {"replace", "delete"})
        <= small.target_occurrences
        for item in small_configurations
    )

def test_sql_classifier_counts_warm_fast_path_statement_classes_without_values() -> None:
    case = load_manifest()[0]
    transition = trace_warm_analysis_transition(case)

    assert set(transition) == {"zeroOverrides", "oneLocalOverride"}
    for counts in transition.values():
        assert counts.keys() == {
            "reading_overrides_existence_checks",
            "reading_overrides_exact_key_lookups",
            "analysis_cache_reads",
            "analysis_cache_writes",
            "reading_exception_snapshot_reads",
        }
        assert all(isinstance(value, int) and value >= 0 for value in counts.values())

    assert transition["zeroOverrides"]["reading_overrides_existence_checks"] >= 1
    assert transition["zeroOverrides"]["reading_overrides_exact_key_lookups"] == 0
    assert transition["oneLocalOverride"]["reading_overrides_exact_key_lookups"] >= 1
    assert classify_sql("SELECT reading FROM reading_overrides WHERE document_id = ?") == "reading_overrides_exact_key_lookups"
