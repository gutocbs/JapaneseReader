from hashlib import sha256
from uuid import UUID

from backend.app.analysis.furigana import FuriganaAligner
from backend.app.analysis.models import (
    AnalysisBlock, AnalysisCacheKey, AnalysisDiagnostic, AnalysisOptions,
    AnalyzedToken, DocumentAnalysis,
)
from backend.app.analysis.morphology import MorphologicalAnalyzer
from backend.app.analysis.repository import AnalysisRepository
from backend.app.documents.models import Document
from backend.app.documents.repository import DocumentRepository
from backend.app.documents.service import DocumentNotFoundError
from backend.app.vocabulary.models import VocabularyKey
from backend.app.readings.models import ReadingOverrideKey, ResolvedReading
from backend.app.readings.service import ReadingOverrideResolver, ReadingOverrideSnapshot
from backend.app.reading_exceptions.service import ReadingExceptionResolver, ReadingExceptionSnapshot


class EmptyDocumentError(ValueError):
    def __init__(self) -> None:
        super().__init__("Document content must contain non-whitespace text to analyze")


class StaleDocumentRevisionError(ValueError):
    def __init__(self, document_id: UUID, revision: int) -> None:
        self.document_id = document_id
        self.document_revision = revision
        super().__init__(f"Document {document_id} revision {revision} changed during analysis")


class AnalysisService:
    def __init__(
        self, documents: DocumentRepository, analyses: AnalysisRepository,
        analyzer: MorphologicalAnalyzer, aligner: FuriganaAligner,
        reading_overrides: ReadingOverrideResolver | None = None,
        reading_exceptions: ReadingExceptionResolver | None = None,
    ) -> None:
        self._documents = documents
        self._analyses = analyses
        self._analyzer = analyzer
        self._aligner = aligner
        self._reading_overrides = reading_overrides
        self._reading_exceptions = reading_exceptions

    def analyze(self, document_id: UUID) -> DocumentAnalysis:
        document = self._documents.get(document_id)
        if document is None:
            raise DocumentNotFoundError(document_id)
        if not document.content.strip():
            raise EmptyDocumentError()

        metadata = self._analyzer.metadata
        exception_snapshot = (
            self._reading_exceptions.snapshot()
            if self._reading_exceptions
            else ReadingExceptionSnapshot((), "")
        )
        options = AnalysisOptions(
            split_mode=metadata.split_mode,
            reading_exceptions_version=exception_snapshot.version,
        )
        content_hash = self._content_hash(document.content)
        key = AnalysisCacheKey(document.id, document.revision, content_hash, metadata, options)
        cached = self._analyses.find_compatible(key)
        if cached is not None:
            self._ensure_current(document, content_hash)
            return cached

        override_snapshot = (
            self._reading_overrides.snapshot(document.id, document.revision)
            if self._reading_overrides is not None
            else None
        )
        blocks: list[AnalysisBlock] = []
        diagnostics: list[AnalysisDiagnostic] = []
        offset = 0
        for line in document.content.splitlines(keepends=True):
            tokens: list[AnalyzedToken] = []
            for raw in self._analyzer.analyze(line, base_offset=offset):
                resolved_raw = exception_snapshot.resolve(raw)
                vocabulary_key = VocabularyKey.from_token(resolved_raw)
                resolved = (
                    override_snapshot.resolve(
                        ReadingOverrideKey(
                            document.id,
                            document.revision,
                            raw.start_offset,
                            raw.end_offset,
                        ),
                        resolved_raw.reading,
                    )
                    if override_snapshot is not None
                    else ResolvedReading(resolved_raw.reading, False)
                )
                alignment = self._aligner.align_with_diagnostics(
                    resolved_raw.raw_surface, resolved.reading
                )
                tokens.append(AnalyzedToken(
                    start_offset=resolved_raw.start_offset, end_offset=resolved_raw.end_offset,
                    surface=resolved_raw.raw_surface, lemma=resolved_raw.lemma, reading=resolved.reading,
                    dictionary_reading=resolved_raw.dictionary_reading, part_of_speech=resolved_raw.part_of_speech,
                    is_out_of_vocabulary=resolved_raw.is_out_of_vocabulary,
                    is_lexical=vocabulary_key is not None,
                    vocabulary_key=vocabulary_key.encode() if vocabulary_key is not None else None,
                    furigana_segments=alignment.segments,
                    has_reading_override=resolved.has_override,
                ))
                if not resolved_raw.reading:
                    diagnostics.append(AnalysisDiagnostic("missing_reading", resolved_raw.start_offset, resolved_raw.end_offset))
                if alignment.used_fallback:
                    diagnostics.append(AnalysisDiagnostic("furigana_fallback", resolved_raw.start_offset, resolved_raw.end_offset))
            blocks.append(AnalysisBlock(offset, offset + len(line), tuple(tokens)))
            offset += len(line)

        analysis = DocumentAnalysis(
            document.id, document.revision, content_hash, metadata, options,
            tuple(blocks), tuple(diagnostics),
        )
        self._ensure_current(document, content_hash)
        self._analyses.save(analysis)
        # A persistence adapter may take time to save. Check again before
        # publishing and discard disposable cache if the document changed there.
        try:
            self._ensure_current(document, content_hash)
        except StaleDocumentRevisionError:
            self._analyses.invalidate_document(document.id)
            raise
        return analysis

    @staticmethod
    def _content_hash(content: str) -> str:
        return sha256(content.encode("utf-8")).hexdigest()

    def _ensure_current(self, document: Document, content_hash: str) -> None:
        current = self._documents.get(document.id)
        if (
            current is None
            or current.revision != document.revision
            or self._content_hash(current.content) != content_hash
        ):
            raise StaleDocumentRevisionError(document.id, document.revision)
