import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
import sqlite3
from threading import Barrier
from uuid import UUID

from httpx import ASGITransport, AsyncClient

from backend.app.documents.models import CreateDocument, UpdateDocument
from backend.app.documents.service import DocumentService
from backend.app.main import create_app
from backend.app.persistence.sqlite import migrations as sqlite_migrations
from backend.app.persistence.sqlite.connection import SqliteDatabase
from backend.app.persistence.sqlite.repositories import (
    SqliteAnalysisRepository,
    SqliteDocumentRepository,
    SqliteReadingOverrideRepository,
    SqliteReadingExceptionRepository,
    SqliteVocabularyRepository,
)
from backend.app.reading_exceptions.models import ReadingException
from backend.app.readings.models import ReadingOverride, ReadingOverrideKey
from backend.app.vocabulary.models import FuriganaVisibility, VocabularyKey
from backend.tests.contracts.analysis_repository import analysis_for


def repositories(path: Path):
    database = SqliteDatabase(path)
    return (
        database,
        SqliteDocumentRepository(database),
        SqliteAnalysisRepository(database),
        SqliteVocabularyRepository(database),
        SqliteReadingOverrideRepository(database),
    )


def test_reading_exception_migration_seeds_one_active_row_and_is_idempotent(tmp_path):
    path = tmp_path / "reading-exceptions.db"
    first = SqliteDatabase(path)
    assert SqliteReadingExceptionRepository(first).list_active() == (
        ReadingException("私", "わたし"),
    )

    second = SqliteDatabase(path)
    with second.unit_of_work() as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM reading_exceptions WHERE lemma = '私'"
        ).fetchone()[0] == 1


def test_reopening_the_same_file_preserves_canonical_and_study_data(tmp_path):
    path = tmp_path / "restart.db"
    database, documents, analyses, vocabulary, readings = repositories(path)
    document = documents.create(CreateDocument("原文", "𠮷野家\r\n日本語  😀"))
    key = VocabularyKey("日本語", "にほんご")
    override_key = ReadingOverrideKey(document.id, 1, 0, 1)
    stored_analysis = analysis_for(document.id)

    vocabulary.replace_selections(document.id, [key])
    vocabulary.set_display_preference(document.id, key, FuriganaVisibility.HIDE)
    readings.upsert(ReadingOverride(override_key, "よし"))
    analyses.save(stored_analysis)
    del database, documents, analyses, vocabulary, readings

    _, reopened_documents, reopened_analyses, reopened_vocabulary, reopened_readings = repositories(path)

    assert reopened_documents.get(document.id) == document
    assert reopened_vocabulary.list_selections(document.id) == frozenset({key})
    assert reopened_vocabulary.get_display_preference(document.id, key) is FuriganaVisibility.HIDE
    assert reopened_readings.get(override_key) == ReadingOverride(override_key, "よし")
    assert reopened_analyses.find_compatible(stored_analysis.cache_key) == stored_analysis


def test_reopening_the_same_file_preserves_document_description_and_tags(tmp_path):
    path = tmp_path / "metadata.db"
    application = create_app(path)

    async def save_metadata():
        async with AsyncClient(
            transport=ASGITransport(app=application), base_url="http://test"
        ) as client:
            created = (
                await client.post(
                    "/api/documents", json={"title": "原文", "content": "日本語"}
                )
            ).json()
            response = await client.put(
                f"/api/documents/{created['id']}",
                json={
                    "description": "Persisted notes",
                    "tags": [{"name": "Grammar", "color": "#7C3AED"}],
                },
            )
            return created["id"], response

    document_id, response = asyncio.run(save_metadata())
    assert response.status_code == 200

    reopened = create_app(path)

    async def read_metadata():
        async with AsyncClient(
            transport=ASGITransport(app=reopened), base_url="http://test"
        ) as client:
            return await client.get(f"/api/documents/{document_id}")

    stored = asyncio.run(read_metadata())
    assert stored.status_code == 200
    assert stored.json()["description"] == "Persisted notes"
    assert stored.json()["tags"] == [{"name": "Grammar", "color": "#7C3AED"}]


def test_document_list_serializes_interleaved_tagged_and_untagged_rows(tmp_path):
    application = create_app(tmp_path / "list-serialization.db")
    exact_contents = ["一  ", "二\r\n", "  三"]

    async def exercise():
        async with AsyncClient(
            transport=ASGITransport(app=application), base_url="http://test"
        ) as client:
            created = []
            for index, content in enumerate(exact_contents, start=1):
                response = await client.post(
                    "/api/documents",
                    json={"title": f"Document {index}", "content": content},
                )
                assert response.status_code == 201
                created.append(response.json())

            first = await client.put(
                f"/api/documents/{created[0]['id']}",
                json={
                    "tags": [
                        {"name": "News", "color": "#0F766E"},
                        {"name": "Grammar", "color": "#7C3AED"},
                    ]
                },
            )
            third = await client.put(
                f"/api/documents/{created[2]['id']}",
                json={"tags": [{"name": "Grammar", "color": "#7C3AED"}]},
            )
            assert first.status_code == third.status_code == 200

            return await client.get("/api/documents")

    response = asyncio.run(exercise())

    assert response.status_code == 200
    payload = response.json()
    assert [document["title"] for document in payload] == [
        "Document 1", "Document 2", "Document 3"
    ]
    assert [document["content"] for document in payload] == exact_contents
    assert [document["tags"] for document in payload] == [
        [
            {"name": "News", "color": "#0F766E"},
            {"name": "Grammar", "color": "#7C3AED"},
        ],
        [],
        [{"name": "Grammar", "color": "#7C3AED"}],
    ]


def test_reopening_the_same_file_preserves_public_import_source_text_and_tags(tmp_path):
    path = tmp_path / "public-import.db"
    application = create_app(path)
    exact_text = "  𠮷野家\r\n日本語  \n😀  "

    async def import_document():
        async with AsyncClient(
            transport=ASGITransport(app=application), base_url="http://test"
        ) as client:
            return await client.post(
                "/api/imports",
                json={
                    "title": "Imported",
                    "text": exact_text,
                    "description": "Persisted import",
                    "source": "Browser plugin",
                    "tags": [{"name": "Grammar", "color": "#7C3AED"}],
                },
            )

    response = asyncio.run(import_document())
    assert response.status_code == 201
    document_id = response.json()["id"]

    reopened = create_app(path)

    async def read_document():
        async with AsyncClient(
            transport=ASGITransport(app=reopened), base_url="http://test"
        ) as client:
            return await client.get(f"/api/documents/{document_id}")

    stored = asyncio.run(read_document())
    assert stored.status_code == 200
    assert stored.json()["content"] == exact_text
    assert stored.json()["description"] == "Persisted import"
    assert stored.json()["source"] == "Browser plugin"
    assert stored.json()["tags"] == [{"name": "Grammar", "color": "#7C3AED"}]


def test_migration_reads_documents_created_before_metadata_fields(tmp_path):
    path = tmp_path / "legacy.db"
    migration = (
        Path(__file__).parents[2]
        / "app"
        / "persistence"
        / "sqlite"
        / "migrations"
        / "001_initial.sql"
    )
    document_id = "00000000-0000-0000-0000-000000000010"
    timestamp = datetime(2026, 9, 26, tzinfo=timezone.utc).isoformat()
    with sqlite3.connect(path) as connection:
        connection.executescript(migration.read_text(encoding="utf-8"))
        connection.execute(
            "INSERT INTO schema_migrations(version, name) VALUES (?, ?)",
            (1, migration.name),
        )
        connection.execute(
            """
            INSERT INTO documents(
                id, title, content, revision, created_at, updated_at, last_read_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (document_id, "Legacy", "以前の本文", 1, timestamp, timestamp, None),
        )

    application = create_app(path)

    async def read_legacy_document():
        async with AsyncClient(
            transport=ASGITransport(app=application), base_url="http://test"
        ) as client:
            return await client.get(f"/api/documents/{document_id}")

    response = asyncio.run(read_legacy_document())
    assert response.status_code == 200
    assert response.json()["description"] is None
    assert response.json()["tags"] == []


def test_failed_post_update_cache_write_rolls_back_and_returns_problem(tmp_path):
    path = tmp_path / "rollback.db"
    database, documents, analyses, _, readings = repositories(path)
    document = documents.create(CreateDocument("原文", "猫"))
    cached = analysis_for(document.id)
    analyses.save(cached)
    with database.unit_of_work(write=True) as connection:
        connection.execute(
            """
            CREATE TRIGGER reject_analysis_invalidation
            BEFORE DELETE ON document_analyses
            BEGIN
                SELECT RAISE(ABORT, 'forced cache failure');
            END
            """
        )

    application = create_app(path)
    application.state.document_service = DocumentService(documents, analyses, readings)

    async def request_update():
        async with AsyncClient(
            transport=ASGITransport(app=application, raise_app_exceptions=False),
            base_url="http://test",
        ) as client:
            return await client.put(
                f"/api/documents/{document.id}", json={"content": "犬"}
            )

    response = asyncio.run(request_update())

    assert response.status_code == 503
    assert response.headers["content-type"] == "application/problem+json"
    assert response.json()["detail"] == "The local database operation failed; changes were not saved"
    assert documents.get(document.id) == document
    assert analyses.find_compatible(cached.cache_key) == cached


def test_database_configuration_uses_environment_and_versioned_migrations(tmp_path, monkeypatch):
    configured = tmp_path / "configured" / "reader.db"
    monkeypatch.setenv("DATABASE_PATH", str(configured))

    application = create_app()

    assert application.state.database.path == configured
    assert configured.is_file()
    with application.state.database.unit_of_work() as connection:
        assert connection.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        assert connection.execute("PRAGMA busy_timeout").fetchone()[0] == 5000
        assert [
            row[0]
            for row in connection.execute(
                "SELECT version FROM schema_migrations ORDER BY version"
            )
        ] == [1, 2, 3, 4, 5]
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
    assert {
        "documents",
        "document_analyses",
        "vocabulary_selections",
        "vocabulary_display_preferences",
        "reading_overrides",
        "reading_exceptions",
        "furigana_exclusions",
        "schema_migrations",
    } <= tables


def test_concurrent_database_initialization_applies_each_migration_once(
    tmp_path, monkeypatch
):
    path = tmp_path / "concurrent-startup.db"
    workers = 4
    start = Barrier(workers)
    discovery = Barrier(workers)
    real_directory = sqlite_migrations.MIGRATIONS_DIRECTORY

    class SynchronizedMigrationDirectory:
        def glob(self, pattern):
            files = tuple(real_directory.glob(pattern))
            discovery.wait(timeout=5)
            return files

    monkeypatch.setattr(
        sqlite_migrations,
        "MIGRATIONS_DIRECTORY",
        SynchronizedMigrationDirectory(),
    )

    def initialize():
        start.wait(timeout=5)
        database = SqliteDatabase(path)
        with database.unit_of_work() as connection:
            return [
                row[0]
                for row in connection.execute(
                    "SELECT version FROM schema_migrations ORDER BY version"
                )
            ]

    with ThreadPoolExecutor(max_workers=workers) as executor:
        versions = list(executor.map(lambda _: initialize(), range(workers)))

    assert versions == [[1, 2, 3, 4, 5]] * workers


