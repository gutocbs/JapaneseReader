from dataclasses import dataclass
from types import MappingProxyType
from typing import Mapping, Protocol
from uuid import UUID

from backend.app.analysis.models import DocumentAnalysis
from backend.app.analysis.repository import AnalysisRepository
from backend.app.documents.repository import DocumentRepository
from backend.app.documents.service import DocumentNotFoundError
from backend.app.readings.models import (
    ReadingOverride,
    ReadingOverrideKey,
    ReadingOverrideOperation,
    ReadingOverrideScope,
    ResolvedReading,
)
from backend.app.readings.repository import ReadingOverrideRepository
from backend.app.readings.normalization import InvalidReadingError, normalize_kana_reading


class InvalidReadingOverrideTargetError(ValueError):
    def __init__(self, key: ReadingOverrideKey) -> None:
        self.key = key
        super().__init__(
            f"Offsets {key.start_offset}:{key.end_offset} do not identify a token "
            f"in document {key.document_id} revision {key.document_revision}"
        )


class StaleReadingOverrideRevisionError(ValueError):
    def __init__(self, document_id: UUID, revision: int) -> None:
        self.document_id = document_id
        self.document_revision = revision
        super().__init__(
            f"Document {document_id} is no longer at revision {revision}"
        )


class InvalidReadingOverrideVocabularyKeyError(ValueError):
    def __init__(self, vocabulary_key: str) -> None:
        self.vocabulary_key = vocabulary_key
        super().__init__(
            "Vocabulary key must identify the selected analyzed token"
        )


class AnalysisProvider(Protocol):
    def analyze(self, document_id: UUID) -> DocumentAnalysis: ...


@dataclass(frozen=True)
class ReadingOverrideSnapshot:
    _overrides: Mapping[ReadingOverrideKey, ReadingOverride]

    def resolve(
        self, key: ReadingOverrideKey, analyzer_reading: str | None
    ) -> ResolvedReading:
        override = self._overrides.get(key)
        if override is None:
            return ResolvedReading(analyzer_reading, False)
        return ResolvedReading(override.reading, True)


class ReadingOverrideResolver:
    def __init__(self, repository: ReadingOverrideRepository) -> None:
        self._repository = repository

    def has_document(self, document_id: UUID) -> bool:
        return self._repository.has_document(document_id)

    def snapshot(
        self, document_id: UUID, document_revision: int
    ) -> ReadingOverrideSnapshot:
        overrides = self._repository.list_for_document_revision(
            document_id, document_revision
        )
        return ReadingOverrideSnapshot(
            MappingProxyType({override.key: override for override in overrides})
        )


class ReadingOverrideService:
    def __init__(
        self,
        documents: DocumentRepository,
        overrides: ReadingOverrideRepository,
        analyses: AnalysisProvider,
        analysis_repository: AnalysisRepository,
    ) -> None:
        self._documents = documents
        self._overrides = overrides
        self._analyses = analyses
        self._analysis_repository = analysis_repository

    def set_override(
        self,
        key: ReadingOverrideKey,
        reading: str,
        *,
        scope: ReadingOverrideScope = ReadingOverrideScope.LOCAL,
        vocabulary_key: str | None = None,
    ) -> ReadingOverrideOperation:
        with self._documents.revision_guard(key.document_id):
            targets = self._resolve_targets(key, scope, vocabulary_key)
            normalized = normalize_kana_reading(reading)
            overrides = tuple(ReadingOverride(target, normalized) for target in targets)
            for override in overrides:
                self._overrides.upsert(override)
            self._analysis_repository.invalidate_document(key.document_id)
            return ReadingOverrideOperation(len(overrides), overrides)

    def delete_override(
        self,
        key: ReadingOverrideKey,
        *,
        scope: ReadingOverrideScope = ReadingOverrideScope.LOCAL,
        vocabulary_key: str | None = None,
    ) -> ReadingOverrideOperation:
        with self._documents.revision_guard(key.document_id):
            targets = self._resolve_targets(key, scope, vocabulary_key)
            deleted_count = sum(self._overrides.delete(target) for target in targets)
            if deleted_count:
                self._analysis_repository.invalidate_document(key.document_id)
            return ReadingOverrideOperation(deleted_count, ())

    def _resolve_targets(
        self,
        key: ReadingOverrideKey,
        scope: ReadingOverrideScope,
        vocabulary_key: str | None,
    ) -> tuple[ReadingOverrideKey, ...]:
        document = self._documents.get(key.document_id)
        if document is None:
            raise DocumentNotFoundError(key.document_id)
        if document.revision != key.document_revision:
            raise StaleReadingOverrideRevisionError(
                key.document_id, key.document_revision
            )
        analysis = self._analyses.analyze(key.document_id)
        selected = next((
            token
            for block in analysis.blocks
            for token in block.tokens
            if token.start_offset == key.start_offset
            and token.end_offset == key.end_offset
        ), None)
        if selected is None:
            raise InvalidReadingOverrideTargetError(key)
        current = self._documents.get(key.document_id)
        if current is None or current.revision != key.document_revision:
            raise StaleReadingOverrideRevisionError(
                key.document_id, key.document_revision
            )
        if scope == ReadingOverrideScope.LOCAL:
            return (key,)
        if (
            scope != ReadingOverrideScope.VOCABULARY
            or vocabulary_key is None
            or selected.vocabulary_key != vocabulary_key
        ):
            raise InvalidReadingOverrideVocabularyKeyError(vocabulary_key or "")
        return tuple(
            ReadingOverrideKey(
                key.document_id,
                key.document_revision,
                token.start_offset,
                token.end_offset,
            )
            for block in analysis.blocks
            for token in block.tokens
            if token.vocabulary_key == vocabulary_key
        )
