"""Contract tests for deterministic reading-override benchmark scenarios."""

from __future__ import annotations

from tests.performance.reading_override_scenarios import (
    build_content,
    content_sha256,
    count_target_occurrences,
    load_manifest,
)


def test_manifest_defines_small_medium_and_large_cases() -> None:
    cases = {case.name: case for case in load_manifest()}

    assert {name: case.code_points for name, case in cases.items()} == {
        "small": 10_000,
        "medium": 50_000,
        "large": 100_000,
    }


def test_generated_content_matches_manifest_hashes() -> None:
    for case in load_manifest():
        assert content_sha256(build_content(case)) == case.sha256


def test_each_case_contains_repeated_target_occurrences() -> None:
    for case in load_manifest():
        content = build_content(case)

        assert case.target == "昨日"
        assert case.dictionary_reading == "きのう"
        assert case.replacement_reading == "さくじつ"
        assert count_target_occurrences(content, case.target) == case.target_occurrences


def test_generation_is_code_point_exact_with_non_bmp_text() -> None:
    for case in load_manifest():
        content = build_content(case)

        assert len(content) == case.code_points
        assert "𠮷" in case.seed
        assert "🍵" in case.seed