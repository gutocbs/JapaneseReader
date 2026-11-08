from collections.abc import Callable, Iterable, Iterator
from contextlib import contextmanager
from datetime import datetime, timezone
import json
import sqlite3
from threading import Lock, RLock
from uuid import UUID, uuid4

from backend.app.analysis.furigana import FuriganaSegment
from backend.app.analysis.models import (
    AnalysisBlock,
    AnalysisCacheKey,
    AnalysisDiagnostic,
    AnalysisOptions,
    AnalyzedToken,
    AnalyzerMetadata,
    DocumentAnalysis,
)
from backend.app.documents.models import UNSET, CreateDocument, Document, DocumentTag, UpdateDocument
from backend.app.persistence.sqlite.connection import SqliteDatabase
from backend.app.reading_exceptions.models import ReadingException
from backend.app.readings.models import ReadingOverride, ReadingOverrideKey
from backend.app.vocabulary.models import (
    FuriganaVisibility,
    VocabularyDisplayPreference,
    VocabularyKey,
)


ANALYSIS_PAYLOAD_VERSION = 1


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _utc(timestamp: datetime) -> datetime:
    if timestamp.utcoffset() is None:
        raise ValueError("Document clock must return a timezone-aware datetime")
    return timestamp.astimezone(timezone.utc)


def _parse_datetime(value: str | None) -> datetime | None:
    if value is None:
        return None
    return datetime.fromisoformat(value).astimezone(timezone.utc)


def _document(row, tags: tuple[DocumentTag, ...] = ()) -> Document:
    return Document(
        id=UUID(row["id"]),
        title=row["title"],
        content=row["content"],
        revision=row["revision"],
        created_at=_parse_datetime(row["created_at"]),
        updated_at=_parse_datetime(row["updated_at"]),
        last_read_at=_parse_datetime(row["last_read_at"]),
        description=row["description"],
        source=row["source"],
        tags=tags,
    )


def _document_tags(connection, document_id: str) -> tuple[DocumentTag, ...]:
    rows = connection.execute(
        """
        SELECT tags.name, tags.color
        FROM document_tags
        JOIN tags ON tags.name = document_tags.tag_name
        WHERE document_tags.document_id = ?
        ORDER BY document_tags.position
        """,
        (document_id,),
    ).fetchall()
    return tuple(DocumentTag(name=row["name"], color=row["color"]) for row in rows)


class SqliteDocumentRepository:
    def __init__(
        self,
        database: SqliteDatabase,
        *,
        clock: Callable[[], datetime] = utc_now,
        uuid_factory: Callable[[], UUID] = uuid4,
    ) -> None:
        self._database = database
        self._clock = clock
        self._uuid_factory = uuid_factory
        self._revision_locks_guard = Lock()
        self._revision_locks: dict[UUID, RLock] = {}

    def create(self, data: CreateDocument) -> Document:
        timestamp = _utc(self._clock())
        document = Document(
            id=self._uuid_factory(),
            title=data.title,
            content=data.content,
            revision=1,
            created_at=timestamp,
            updated_at=timestamp,
            description=data.description,
            source=data.source,
            tags=data.tags,
        )
        with self._database.unit_of_work(write=True) as connection:
            connection.execute(
                """
                INSERT INTO documents(
                    id, title, content, description, source, revision,
                    created_at, updated_at, last_read_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(document.id), document.title, document.content,
                    document.description, document.source, document.revision,
                    document.created_at.isoformat(),
                    document.updated_at.isoformat(), None,
                ),
            )
            for position, tag in enumerate(data.tags):
                connection.execute(
                    "INSERT INTO tags(name, color) VALUES (?, ?) "
                    "ON CONFLICT(name) DO NOTHING",
                    (tag.name, tag.color),
                )
                connection.execute(
                    """
                    INSERT INTO document_tags(document_id, tag_name, position)
                    VALUES (?, ?, ?)
                    """,
                    (str(document.id), tag.name, position),
                )
            row = connection.execute(
                "SELECT * FROM documents WHERE id = ?", (str(document.id),)
            ).fetchone()
            tags = _document_tags(connection, str(document.id))
        return _document(row, tags)

    def get(self, document_id: UUID) -> Document | None:
        with self._database.unit_of_work() as connection:
            row = connection.execute(
                "SELECT * FROM documents WHERE id = ?", (str(document_id),)
            ).fetchone()
            if row is None:
                return None
            tags = _document_tags(connection, row["id"])
        return _document(row, tags)

    def list(self) -> tuple[Document, ...]:
        with self._database.unit_of_work() as connection:
            rows = connection.execute(
                """
                SELECT documents.*, tags.name AS tag_name, tags.color AS tag_color
                FROM documents
                LEFT JOIN document_tags
                  ON document_tags.document_id = documents.id
                LEFT JOIN tags ON tags.name = document_tags.tag_name
                ORDER BY documents.rowid, document_tags.position
                """
            ).fetchall()

        documents: list[Document] = []
        document_row = None
        tags: list[DocumentTag] = []
        for row in rows:
            if document_row is not None and row["id"] != document_row["id"]:
                documents.append(_document(document_row, tuple(tags)))
                tags = []
            document_row = row
            if row["tag_name"] is not None:
                tags.append(DocumentTag(name=row["tag_name"], color=row["tag_color"]))
        if document_row is not None:
            documents.append(_document(document_row, tuple(tags)))
        return tuple(documents)

    def list_tags(self) -> tuple[DocumentTag, ...]:
        with self._database.unit_of_work() as connection:
            rows = connection.execute("SELECT name, color FROM tags ORDER BY name COLLATE NOCASE").fetchall()
        return tuple(DocumentTag(name=row["name"], color=row["color"]) for row in rows)

    def create_tag(self, tag: DocumentTag) -> DocumentTag:
        with self._database.unit_of_work(write=True) as connection:
            try:
                connection.execute(
                    "INSERT INTO tags(name, color) VALUES (?, ?)",
                    (tag.name, tag.color),
                )
            except sqlite3.IntegrityError as error:
                if error.sqlite_errorcode in {
                    sqlite3.SQLITE_CONSTRAINT_UNIQUE,
                    sqlite3.SQLITE_CONSTRAINT_PRIMARYKEY,
                }:
                    raise ValueError("Tag already exists") from error
                raise
        return tag

    def rename_tag(self, name: str, replacement: str) -> bool:
        with self._database.unit_of_work(write=True) as connection:
            row = connection.execute("SELECT color FROM tags WHERE name = ?", (name,)).fetchone()
            if row is None: return False
            if name.casefold() == replacement.casefold():
                connection.execute("UPDATE tags SET name = ? WHERE name = ?", (replacement, name))
                return True
            if name.casefold() != replacement.casefold() and connection.execute("SELECT 1 FROM tags WHERE name = ?", (replacement,)).fetchone(): raise ValueError("Tag already exists")
            connection.execute("INSERT INTO tags(name, color) VALUES (?, ?)", (replacement, row["color"]))
            connection.execute("UPDATE document_tags SET tag_name = ? WHERE tag_name = ?", (replacement, name))
            connection.execute("DELETE FROM tags WHERE name = ?", (name,))
        return True

    def delete_tag(self, name: str) -> bool:
        with self._database.unit_of_work(write=True) as connection:
            row = connection.execute("SELECT 1 FROM tags WHERE name = ?", (name,)).fetchone()
            if row is None: return False
            connection.execute("DELETE FROM document_tags WHERE tag_name = ?", (name,))
            connection.execute("DELETE FROM tags WHERE name = ?", (name,))
        return True

    @contextmanager
    def revision_guard(self, document_id: UUID) -> Iterator[None]:
        with self._revision_locks_guard:
            lock = self._revision_locks.setdefault(document_id, RLock())
        with lock, self._database.unit_of_work(write=True):
            yield

    def update(self, document_id: UUID, data: UpdateDocument) -> Document | None:
        with self._database.unit_of_work(write=True) as connection:
            current = connection.execute(
                "SELECT * FROM documents WHERE id = ?", (str(document_id),)
            ).fetchone()
            if current is None:
                return None
            content = current["content"] if data.content is None else data.content
            connection.execute(
                """
                UPDATE documents
                SET title = ?, content = ?, description = ?, revision = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    current["title"] if data.title is None else data.title,
                    content,
                    current["description"] if data.description is UNSET else data.description,
                    current["revision"] + (content != current["content"]),
                    _utc(self._clock()).isoformat(),
                    str(document_id),
                ),
            )
            if data.tags is not UNSET:
                connection.execute(
                    "DELETE FROM document_tags WHERE document_id = ?", (str(document_id),)
                )
                for position, tag in enumerate(data.tags):
                    connection.execute(
                        "INSERT INTO tags(name, color) VALUES (?, ?) "
                        "ON CONFLICT(name) DO NOTHING",
                        (tag.name, tag.color),
                    )
                    connection.execute(
                        """
                        INSERT INTO document_tags(document_id, tag_name, position)
                        VALUES (?, ?, ?)
                        """,
                        (str(document_id), tag.name, position),
                    )
            updated = connection.execute(
                "SELECT * FROM documents WHERE id = ?", (str(document_id),)
            ).fetchone()
            tags = _document_tags(connection, str(document_id))
        return _document(updated, tags)

    def mark_read(self, document_id: UUID, read_at: datetime) -> Document | None:
        with self._database.unit_of_work(write=True) as connection:
            cursor = connection.execute(
                "UPDATE documents SET last_read_at = ? WHERE id = ?",
                (_utc(read_at).isoformat(), str(document_id)),
            )
            if cursor.rowcount == 0:
                return None
            row = connection.execute(
                "SELECT * FROM documents WHERE id = ?", (str(document_id),)
            ).fetchone()
            tags = _document_tags(connection, str(document_id))
        return _document(row, tags)

    def delete(self, document_id: UUID) -> bool:
        with self._database.unit_of_work(write=True) as connection:
            cursor = connection.execute(
                "DELETE FROM documents WHERE id = ?", (str(document_id),)
            )
            return cursor.rowcount > 0


def _analysis_options_json(options: AnalysisOptions) -> str:
    return json.dumps(
        {
            "furiganaAlgorithmVersion": options.furigana_algorithm_version,
            "readingExceptionsVersion": options.reading_exceptions_version,
            "splitMode": options.split_mode,
        },
        ensure_ascii=False, separators=(",", ":"),
        sort_keys=True,
    )


def _analysis_payload(analysis: DocumentAnalysis) -> str:
    payload = {
        "documentId": str(analysis.document_id),
        "documentRevision": analysis.document_revision,
        "contentHash": analysis.content_hash,
        "metadata": {
            "analyzerName": analysis.metadata.analyzer_name,
            "analyzerVersion": analysis.metadata.analyzer_version,
            "dictionaryName": analysis.metadata.dictionary_name,
            "dictionaryVersion": analysis.metadata.dictionary_version,
            "splitMode": analysis.metadata.split_mode,
        },
        "analysisOptions": {
            "furiganaAlgorithmVersion": analysis.analysis_options.furigana_algorithm_version,
            "readingExceptionsVersion": analysis.analysis_options.reading_exceptions_version,
            "splitMode": analysis.analysis_options.split_mode,
        },
        "blocks": [
            {
                "startOffset": block.start_offset,
                "endOffset": block.end_offset,
                "tokens": [
                    {
                        "startOffset": token.start_offset,
                        "endOffset": token.end_offset,
                        "surface": token.surface,
                        "lemma": token.lemma,
                        "reading": token.reading,
                        "dictionaryReading": token.dictionary_reading,
                        "partOfSpeech": list(token.part_of_speech),
                        "isOutOfVocabulary": token.is_out_of_vocabulary,
                        "isLexical": token.is_lexical,
                        "vocabularyKey": token.vocabulary_key,
                        "furiganaSegments": [
                            {"text": segment.text, "reading": segment.reading}
                            for segment in token.furigana_segments
                        ],
                        "hasReadingOverride": token.has_reading_override,
                    }
                    for token in block.tokens
                ],
            }
            for block in analysis.blocks
        ],
        "diagnostics": [
            {
                "code": diagnostic.code,
                "startOffset": diagnostic.start_offset,
                "endOffset": diagnostic.end_offset,
            }
            for diagnostic in analysis.diagnostics
        ],
    }
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def _decode_analysis(payload: str) -> DocumentAnalysis:
    data = json.loads(payload)
    metadata = data["metadata"]
    options = data["analysisOptions"]
    return DocumentAnalysis(
        document_id=UUID(data["documentId"]),
        document_revision=data["documentRevision"],
        content_hash=data["contentHash"],
        metadata=AnalyzerMetadata(
            analyzer_name=metadata["analyzerName"],
            analyzer_version=metadata["analyzerVersion"],
            dictionary_name=metadata["dictionaryName"],
            dictionary_version=metadata["dictionaryVersion"],
            split_mode=metadata["splitMode"],
        ),
        analysis_options=AnalysisOptions(
            split_mode=options["splitMode"],
            furigana_algorithm_version=options.get("furiganaAlgorithmVersion", 1),
            reading_exceptions_version=options.get("readingExceptionsVersion", ""),
        ),
        blocks=tuple(
            AnalysisBlock(
                start_offset=block["startOffset"],
                end_offset=block["endOffset"],
                tokens=tuple(
                    AnalyzedToken(
                        start_offset=token["startOffset"],
                        end_offset=token["endOffset"],
                        surface=token["surface"],
                        lemma=token["lemma"],
                        reading=token["reading"],
                        dictionary_reading=token["dictionaryReading"],
                        part_of_speech=tuple(token["partOfSpeech"]),
                        is_out_of_vocabulary=token["isOutOfVocabulary"],
                        is_lexical=token["isLexical"],
                        vocabulary_key=token["vocabularyKey"],
                        furigana_segments=tuple(
                            FuriganaSegment(segment["text"], segment["reading"])
                            for segment in token["furiganaSegments"]
                        ),
                        has_reading_override=token.get("hasReadingOverride", False),
                    )
                    for token in block["tokens"]
                ),
            )
            for block in data["blocks"]
        ),
        diagnostics=tuple(
            AnalysisDiagnostic(
                diagnostic["code"],
                diagnostic["startOffset"],
                diagnostic["endOffset"],
            )
            for diagnostic in data["diagnostics"]
        ),
    )


class SqliteAnalysisRepository:
    def __init__(self, database: SqliteDatabase) -> None:
        self._database = database

    def find_compatible(self, key: AnalysisCacheKey) -> DocumentAnalysis | None:
        with self._database.unit_of_work() as connection:
            row = connection.execute(
                """
                SELECT payload_version, analysis_json
                FROM document_analyses
                WHERE document_id = ? AND document_revision = ? AND content_hash = ?
                  AND analyzer_name = ? AND analyzer_version = ?
                  AND dictionary_name = ? AND dictionary_version = ?
                  AND metadata_split_mode = ? AND analysis_options_json = ?
                """,
                (
                    str(key.document_id), key.document_revision, key.content_hash,
                    key.metadata.analyzer_name, key.metadata.analyzer_version,
                    key.metadata.dictionary_name, key.metadata.dictionary_version,
                    key.metadata.split_mode, _analysis_options_json(key.analysis_options),
                ),
            ).fetchone()
        if row is None or row["payload_version"] != ANALYSIS_PAYLOAD_VERSION:
            return None

        analysis = _decode_analysis(row["analysis_json"])
        return analysis if analysis.cache_key == key else None

    def save(self, analysis: DocumentAnalysis) -> None:
        key = analysis.cache_key
        with self._database.unit_of_work(write=True) as connection:
            connection.execute(
                """
                INSERT INTO document_analyses(
                    document_id, document_revision, content_hash,
                    analyzer_name, analyzer_version, dictionary_name,
                    dictionary_version, metadata_split_mode, analysis_options_json,
                    payload_version, analysis_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT DO UPDATE SET
                    payload_version = excluded.payload_version,
                    analysis_json = excluded.analysis_json
                """,
                (
                    str(key.document_id), key.document_revision, key.content_hash,
                    key.metadata.analyzer_name, key.metadata.analyzer_version,
                    key.metadata.dictionary_name, key.metadata.dictionary_version,
                    key.metadata.split_mode, _analysis_options_json(key.analysis_options),
                    ANALYSIS_PAYLOAD_VERSION, _analysis_payload(analysis),
                ),
            )

    def invalidate_document(self, document_id: UUID) -> None:
        with self._database.unit_of_work(write=True) as connection:
            connection.execute(
                "DELETE FROM document_analyses WHERE document_id = ?",
                (str(document_id),),
            )


def _key_parts(key: VocabularyKey) -> tuple[str, str, int, str]:
    return key.lemma, key.reading or "", int(key.reading is None), key.encode()


def _key_from_row(row) -> VocabularyKey:
    return VocabularyKey(
        row["lemma"], None if row["reading_is_null"] else row["reading_value"]
    )


class SqliteVocabularyRepository:
    def __init__(self, database: SqliteDatabase) -> None:
        self._database = database

    def list_selections(self, document_id: UUID) -> frozenset[VocabularyKey]:
        with self._database.unit_of_work() as connection:
            rows = connection.execute(
                """
                SELECT lemma, reading_value, reading_is_null
                FROM vocabulary_selections WHERE document_id = ?
                """,
                (str(document_id),),
            ).fetchall()
        return frozenset(_key_from_row(row) for row in rows)

    def replace_selections(
        self, document_id: UUID, keys: Iterable[VocabularyKey]
    ) -> None:
        replacement = frozenset(keys)
        with self._database.unit_of_work(write=True) as connection:
            connection.execute(
                "DELETE FROM vocabulary_selections WHERE document_id = ?",
                (str(document_id),),
            )
            connection.executemany(
                """
                INSERT INTO vocabulary_selections(
                    document_id, lemma, reading_value, reading_is_null, vocabulary_key
                ) VALUES (?, ?, ?, ?, ?)
                """,
                ((str(document_id), *_key_parts(key)) for key in replacement),
            )

    def list_display_preferences(
        self, document_id: UUID
    ) -> tuple[VocabularyDisplayPreference, ...]:
        with self._database.unit_of_work() as connection:
            rows = connection.execute(
                """
                SELECT lemma, reading_value, reading_is_null, visibility
                FROM vocabulary_display_preferences
                WHERE document_id = ? ORDER BY vocabulary_key
                """,
                (str(document_id),),
            ).fetchall()
        return tuple(
            VocabularyDisplayPreference(
                _key_from_row(row), FuriganaVisibility(row["visibility"])
            )
            for row in rows
        )

    def get_display_preference(
        self, document_id: UUID, key: VocabularyKey
    ) -> FuriganaVisibility:
        lemma, reading, reading_is_null, _ = _key_parts(key)
        with self._database.unit_of_work() as connection:
            row = connection.execute(
                """
                SELECT visibility FROM vocabulary_display_preferences
                WHERE document_id = ? AND lemma = ?
                  AND reading_value = ? AND reading_is_null = ?
                """,
                (str(document_id), lemma, reading, reading_is_null),
            ).fetchone()
        return (
            FuriganaVisibility.INHERIT
            if row is None
            else FuriganaVisibility(row["visibility"])
        )

    def set_display_preference(
        self,
        document_id: UUID,
        key: VocabularyKey,
        visibility: FuriganaVisibility,
    ) -> None:
        with self._database.unit_of_work(write=True) as connection:
            connection.execute(
                """
                INSERT INTO vocabulary_display_preferences(
                    document_id, lemma, reading_value, reading_is_null,
                    vocabulary_key, visibility
                ) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(document_id, lemma, reading_value, reading_is_null)
                DO UPDATE SET vocabulary_key = excluded.vocabulary_key,
                              visibility = excluded.visibility
                """,
                (str(document_id), *_key_parts(key), visibility.value),
            )


class SqliteReadingOverrideRepository:
    def __init__(self, database: SqliteDatabase) -> None:
        self._database = database

    def has_document(self, document_id: UUID) -> bool:
        with self._database.unit_of_work() as connection:
            row = connection.execute(
                "SELECT 1 FROM reading_overrides WHERE document_id = ? LIMIT 1",
                (str(document_id),),
            ).fetchone()
        return row is not None

    def list_for_document_revision(
        self, document_id: UUID, document_revision: int
    ) -> tuple[ReadingOverride, ...]:
        with self._database.unit_of_work() as connection:
            rows = connection.execute(
                """
                SELECT start_offset, end_offset, reading FROM reading_overrides
                WHERE document_id = ? AND document_revision = ?
                ORDER BY start_offset, end_offset
                """,
                (str(document_id), document_revision),
            ).fetchall()
        return tuple(
            ReadingOverride(
                ReadingOverrideKey(
                    document_id,
                    document_revision,
                    row["start_offset"],
                    row["end_offset"],
                ),
                row["reading"],
            )
            for row in rows
        )

    def get(self, key: ReadingOverrideKey) -> ReadingOverride | None:
        with self._database.unit_of_work() as connection:
            row = connection.execute(
                """
                SELECT reading FROM reading_overrides
                WHERE document_id = ? AND document_revision = ?
                  AND start_offset = ? AND end_offset = ?
                """,
                (
                    str(key.document_id), key.document_revision,
                    key.start_offset, key.end_offset,
                ),
            ).fetchone()
        return None if row is None else ReadingOverride(key, row["reading"])

    def upsert(self, override: ReadingOverride) -> None:
        key = override.key
        with self._database.unit_of_work(write=True) as connection:
            connection.execute(
                """
                INSERT INTO reading_overrides(
                    document_id, document_revision, start_offset, end_offset, reading
                ) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(document_id, document_revision, start_offset, end_offset)
                DO UPDATE SET reading = excluded.reading
                """,
                (
                    str(key.document_id), key.document_revision,
                    key.start_offset, key.end_offset, override.reading,
                ),
            )

    def delete(self, key: ReadingOverrideKey) -> bool:
        with self._database.unit_of_work(write=True) as connection:
            cursor = connection.execute(
                """
                DELETE FROM reading_overrides
                WHERE document_id = ? AND document_revision = ?
                  AND start_offset = ? AND end_offset = ?
                """,
                (
                    str(key.document_id), key.document_revision,
                    key.start_offset, key.end_offset,
                ),
            )
            return cursor.rowcount > 0

    def delete_document(self, document_id: UUID) -> None:
        with self._database.unit_of_work(write=True) as connection:
            connection.execute(
                "DELETE FROM reading_overrides WHERE document_id = ?",
                (str(document_id),),
            )


class SqliteReadingExceptionRepository:
    def __init__(
        self,
        database: SqliteDatabase,
        *,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._database = database
        self._clock = clock

    def list(self, *, include_deleted: bool = False) -> tuple[ReadingException, ...]:
        where_clause = "" if include_deleted else "WHERE deleted_at IS NULL"
        with self._database.unit_of_work() as connection:
            rows = connection.execute(
                f"""
                SELECT lemma, reading, deleted_at
                FROM reading_exceptions
                {where_clause}
                ORDER BY lemma
                """
            ).fetchall()
        return tuple(
            ReadingException(
                row["lemma"], row["reading"], _parse_datetime(row["deleted_at"])
            )
            for row in rows
        )

    def list_active(self) -> tuple[ReadingException, ...]:
        return self.list()

    def put(self, lemma: str, reading: str) -> tuple[ReadingException, bool]:
        with self._database.unit_of_work(write=True) as connection:
            existing = connection.execute(
                "SELECT 1 FROM reading_exceptions WHERE lemma = ?", (lemma,)
            ).fetchone()
            if existing is None:
                connection.execute(
                    "INSERT INTO reading_exceptions(lemma, reading, deleted_at) VALUES (?, ?, NULL)",
                    (lemma, reading),
                )
                return ReadingException(lemma, reading), True
            connection.execute(
                "UPDATE reading_exceptions SET reading = ?, deleted_at = NULL WHERE lemma = ?",
                (reading, lemma),
            )
        return ReadingException(lemma, reading), False

    def soft_delete(self, lemma: str) -> ReadingException | None:
        timestamp = _utc(self._clock())
        with self._database.unit_of_work(write=True) as connection:
            row = connection.execute(
                "SELECT reading FROM reading_exceptions WHERE lemma = ? AND deleted_at IS NULL",
                (lemma,),
            ).fetchone()
            if row is None:
                return None
            connection.execute(
                "UPDATE reading_exceptions SET deleted_at = ? WHERE lemma = ?",
                (timestamp.isoformat(), lemma),
            )
        return ReadingException(lemma, row["reading"], timestamp)

    def restore(self, lemma: str) -> ReadingException | None:
        with self._database.unit_of_work(write=True) as connection:
            row = connection.execute(
                "SELECT reading, deleted_at FROM reading_exceptions WHERE lemma = ?", (lemma,)
            ).fetchone()
            if row is None:
                return None
            if row["deleted_at"] is not None:
                connection.execute(
                    "UPDATE reading_exceptions SET deleted_at = NULL WHERE lemma = ?", (lemma,)
                )
        return ReadingException(lemma, row["reading"])
