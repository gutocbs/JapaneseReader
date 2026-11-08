"""Regression coverage for bulk reading-override lookup during a cold analysis."""

from __future__ import annotations

from collections.abc import Iterator

import pytest

from backend.app.analysis.furigana import FuriganaAligner
from backend.app.analysis.morphology import SudachiMorphologicalAnalyzer
from backend.app.analysis.service import AnalysisService
from backend.app.documents.models import CreateDocument
from backend.app.persistence.memory.analyses import InMemoryAnalysisRepository
from backend.app.persistence.memory.documents import InMemoryDocumentRepository
from backend.app.persistence.memory.readings import InMemoryReadingOverrideRepository
from backend.app.readings.models import ReadingOverride, ReadingOverrideKey
from backend.app.readings.service import ReadingOverrideResolver
from tests.performance.reading_override_scenarios import build_content, load_manifest


class CountingReadingOverrideRepository(InMemoryReadingOverrideRepository):
    """Record the resolver's bulk and per-key repository access paths."""

    def __init__(self) -> None:
        super().__init__()
        self.bulk_read_calls = 0
        self.exact_key_get_calls = 0

    def list_for_document_revision(self, document_id, document_revision):
        self.bulk_read_calls += 1
        return super().list_for_document_revision(document_id, document_revision)

    def get(self, key):
        self.exact_key_get_calls += 1
        return super().get(key)


@pytest.fixture
def analyzer() -> Iterator[SudachiMorphologicalAnalyzer]:
    instance = SudachiMorphologicalAnalyzer()
    yield instance
    instance.close()


def _flatten(analysis):
    return tuple(
        (token.start_offset, token.end_offset, token.surface, token.reading, token.has_reading_override)
        for block in analysis.blocks
        for token in block.tokens
    )


def test_cold_medium_analysis_loads_local_override_once_without_per_token_lookups(analyzer) -> None:
    """A 50k cold analysis must bulk-load overrides instead of querying each token."""

    scenario = next(case for case in load_manifest() if case.name == "medium")
    content = build_content(scenario)
    documents = InMemoryDocumentRepository()
    document = documents.create(CreateDocument("medium lookup regression", content))

    baseline = AnalysisService(
        documents, InMemoryAnalysisRepository(), analyzer, FuriganaAligner()
    ).analyze(document.id)
    baseline_tokens = _flatten(baseline)
    target = next(
        token
        for block in baseline.blocks
        for token in block.tokens
        if token.surface == scenario.target and token.reading == scenario.dictionary_reading
    )
    assert scenario.target_occurrences > 1

    overrides = CountingReadingOverrideRepository()
    overrides.upsert(ReadingOverride(
        ReadingOverrideKey(
            document.id, document.revision, target.start_offset, target.end_offset
        ),
        scenario.replacement_reading,
    ))
    analysis = AnalysisService(
        documents,
        InMemoryAnalysisRepository(),
        analyzer,
        FuriganaAligner(),
        ReadingOverrideResolver(overrides),
    ).analyze(document.id)

    overridden_token = next(
        token
        for block in analysis.blocks
        for token in block.tokens
        if (token.start_offset, token.end_offset)
        == (target.start_offset, target.end_offset)
    )
    expected_tokens = tuple(
        (
            start_offset,
            end_offset,
            surface,
            scenario.replacement_reading if (start_offset, end_offset) == (target.start_offset, target.end_offset) else reading,
            (start_offset, end_offset) == (target.start_offset, target.end_offset),
        )
        for start_offset, end_offset, surface, reading, has_reading_override in baseline_tokens
    )

    assert overrides.exact_key_get_calls == 0
    assert overrides.bulk_read_calls == 1
    assert overridden_token.reading == scenario.replacement_reading
    assert overridden_token.has_reading_override is True
    assert _flatten(analysis) == expected_tokens
