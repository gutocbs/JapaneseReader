import asyncio
from datetime import datetime
from uuid import UUID

import pytest
from httpx import ASGITransport, AsyncClient

from backend.app.documents.service import DocumentService
from backend.app.main import app
from backend.app.persistence.memory.documents import InMemoryDocumentRepository


@pytest.fixture
def client():
    previous_service = app.state.document_service
    app.state.document_service = DocumentService(InMemoryDocumentRepository())
    yield AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    app.state.document_service = previous_service


def test_public_import_preserves_exact_text_and_persists_metadata_and_tags(client):
    async def exercise():
        async with client:
            text = "  𠮷野家\r\n日本語  \n😀  "
            response = await client.post(
                "/api/imports",
                json={
                    "title": "Imported article",
                    "text": text,
                    "description": "Imported by a browser extension",
                    "source": "Yomitan",
                    "tags": [
                        {"name": "Grammar", "color": "#7C3AED"},
                        {"name": "News", "color": "#0F766E"},
                    ],
                },
            )

            assert response.status_code == 201
            document = response.json()
            assert document["title"] == "Imported article"
            assert document["content"] == text
            assert document["description"] == "Imported by a browser extension"
            assert document["source"] == "Yomitan"
            assert document["tags"] == [
                {"name": "Grammar", "color": "#7C3AED"},
                {"name": "News", "color": "#0F766E"},
            ]
            assert document["revision"] == 1
            assert document["lastReadAt"] is None
            UUID(document["id"])
            assert datetime.fromisoformat(document["createdAt"].replace("Z", "+00:00")).utcoffset() is not None
            assert document["updatedAt"] == document["createdAt"]
            assert (await client.get(f"/api/documents/{document['id']}")).json() == document
            assert (await client.get("/api/tags")).json() == [
                {"name": "Grammar", "color": "#7C3AED"},
                {"name": "News", "color": "#0F766E"},
            ]

    asyncio.run(exercise())


def test_ui_document_creation_uses_local_source(client):
    async def exercise():
        async with client:
            response = await client.post(
                "/api/documents", json={"title": "Local note", "content": "本文"}
            )

            assert response.status_code == 201
            assert response.json()["source"] == "Local"

    asyncio.run(exercise())


def test_public_import_accepts_hex_colors_case_insensitively(client):
    async def exercise():
        async with client:
            response = await client.post(
                "/api/imports",
                json={
                    "title": "Title",
                    "text": "text",
                    "description": None,
                    "source": "Plugin",
                    "tags": [
                        {"name": "Lower", "color": "#ffffff"},
                        {"name": "Mixed", "color": "#aBc123"},
                    ],
                },
            )

            assert response.status_code == 201
            assert response.json()["tags"] == [
                {"name": "Lower", "color": "#ffffff"},
                {"name": "Mixed", "color": "#aBc123"},
            ]

    asyncio.run(exercise())


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"title": "Title", "text": "text", "tags": [], "description": None},
        {"title": " ", "text": "text", "tags": [], "description": None, "source": "Plugin"},
        {"title": "Title", "text": "text", "tags": [], "description": None, "source": " "},
        {"title": "Title", "text": None, "tags": [], "description": None, "source": "Plugin"},
        {"title": "Title", "text": "text", "tags": None, "description": None, "source": "Plugin"},
        {
            "title": "Title",
            "text": "text",
            "description": None,
            "source": "Plugin",
            "tags": [
                {"name": "Grammar", "color": "#7C3AED"},
                {"name": "grammar", "color": "#0F766E"},
            ],
        },
        {
            "title": "Title",
            "text": "text",
            "description": None,
            "source": "Plugin",
            "tags": [],
            "id": "00000000-0000-0000-0000-000000000001",
        },
        {
            "title": "Title",
            "text": "text",
            "description": None,
            "source": "Plugin",
            "tags": [],
            "createdAt": "2026-09-30T00:00:00Z",
        },
    ],
)
def test_public_import_rejects_malformed_payloads(payload, client):
    async def exercise():
        async with client:
            response = await client.post("/api/imports", json=payload)
            assert response.status_code == 422
            assert response.headers["content-type"] == "application/problem+json"
            assert response.json()["status"] == 422

    asyncio.run(exercise())


def test_public_import_openapi_contract(client):
    schema = app.openapi()

    operation = schema["paths"]["/api/imports"]["post"]
    assert operation["operationId"] == "importDocument"
    assert operation["requestBody"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/ImportDocumentRequest"
    }
    assert operation["responses"]["201"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/DocumentResponse"
    }
    request = schema["components"]["schemas"]["ImportDocumentRequest"]
    assert set(request["required"]) == {"title", "text", "description", "source", "tags"}
    assert request["additionalProperties"] is False
