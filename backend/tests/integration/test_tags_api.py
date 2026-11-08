import logging

from fastapi.testclient import TestClient

from backend.app.main import create_app


def test_tag_catalog_is_persisted_and_rename_remove_update_all_documents():
    with TestClient(create_app(":memory:")) as client:
        created = client.post("/api/tags", json={"name": "Grammar", "color": "#0F766E"})
        assert created.status_code == 201
        assert client.get("/api/tags").json() == [{"name": "Grammar", "color": "#0F766E"}]
        document = client.post("/api/documents", json={"title": "A", "content": "文"}).json()
        client.put(f"/api/documents/{document['id']}", json={"tags": [{"name": "Grammar", "color": "#0F766E"}]})
        assert client.put("/api/tags/Grammar", json={"name": "Grammar notes"}).status_code == 204
        assert client.get(f"/api/documents/{document['id']}").json()["tags"] == [{"name": "Grammar notes", "color": "#0F766E"}]
        assert client.delete("/api/tags/Grammar%20notes").status_code == 204
        assert client.get(f"/api/documents/{document['id']}").json()["tags"] == []


def test_tag_api_accepts_custom_hex_colors_and_rejects_malformed_or_blank_colors():
    with TestClient(create_app(":memory:")) as client:
        custom = client.post("/api/tags", json={"name": "Custom", "color": "#123456"})
        assert custom.status_code == 201
        assert custom.json() == {"name": "Custom", "color": "#123456"}

        document = client.post("/api/documents", json={"title": "A", "content": "文"}).json()
        updated = client.put(
            f"/api/documents/{document['id']}",
            json={"tags": [{"name": "Document custom", "color": "#abcdef"}]},
        )
        assert updated.status_code == 200
        assert updated.json()["tags"] == [{"name": "Document custom", "color": "#abcdef"}]

        for color in ("", " ", "#12345", "#1234567", "#GGGGGG", "123456"):
            assert client.post("/api/tags", json={"name": f"Bad {color}", "color": color}).status_code == 422
        client.post("/api/tags", json={"name": "Good", "color": "#0F766E"})
        assert client.put("/api/tags/Good", json={"name": " "}).status_code == 422


def test_duplicate_tag_creation_preserves_the_existing_canonical_color():
    with TestClient(create_app(":memory:")) as client:
        assert client.post("/api/tags", json={"name": "Grammar", "color": "#0F766E"}).status_code == 201
        duplicate = client.post("/api/tags", json={"name": "grammar", "color": "#123456"})

        assert duplicate.status_code == 409
        assert client.get("/api/tags").json() == [{"name": "Grammar", "color": "#0F766E"}]


def test_non_unique_tag_integrity_failure_returns_503_and_logs_safe_route(caplog):
    application = create_app(":memory:")
    with TestClient(application) as client:
        with application.state.database.unit_of_work(write=True) as connection:
            connection.execute(
                """
                CREATE TRIGGER fail_tag_insert
                BEFORE INSERT ON tags
                BEGIN
                    SELECT RAISE(FAIL, 'forced tag failure');
                END
                """
            )

        with caplog.at_level(logging.ERROR, logger="backend.app.api.errors"):
            response = client.post(
                "/api/tags", json={"name": "SECRET-TAG", "color": "#aBc123"}
            )

    error_records = [
        record
        for record in caplog.records
        if record.name == "backend.app.api.errors" and record.levelno == logging.ERROR
    ]
    assert response.status_code == 503
    assert response.headers["content-type"] == "application/problem+json"
    assert response.json()["detail"] == "The local database operation failed; changes were not saved"
    assert len(error_records) == 1
    assert "POST" in error_records[0].getMessage()
    assert "/api/tags" in error_records[0].getMessage()
    assert "SECRET-TAG" not in caplog.text
    assert "#aBc123" not in caplog.text


def test_duplicate_tag_conflict_does_not_log_database_failure(caplog):
    with TestClient(create_app(":memory:")) as client:
        assert client.post(
            "/api/tags", json={"name": "Grammar", "color": "#0F766E"}
        ).status_code == 201

        with caplog.at_level(logging.ERROR, logger="backend.app.api.errors"):
            duplicate = client.post(
                "/api/tags", json={"name": "grammar", "color": "#123456"}
            )

    error_records = [
        record
        for record in caplog.records
        if record.name == "backend.app.api.errors" and record.levelno == logging.ERROR
    ]
    assert duplicate.status_code == 409
    assert error_records == []


def test_duplicate_tag_rename_returns_conflict_for_memory_repository():
    from backend.app.documents.service import DocumentService
    from backend.app.persistence.memory.documents import InMemoryDocumentRepository
    from backend.app.main import app
    previous = app.state.document_service
    app.state.document_service = DocumentService(InMemoryDocumentRepository())
    try:
        from httpx import ASGITransport, AsyncClient
        import asyncio
        async def exercise():
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                await client.post("/api/tags", json={"name": "One", "color": "#0F766E"})
                await client.post("/api/tags", json={"name": "Two", "color": "#1D4ED8"})
                assert (await client.put("/api/tags/One", json={"name": "Two"})).status_code == 409
        asyncio.run(exercise())
    finally:
        app.state.document_service = previous
