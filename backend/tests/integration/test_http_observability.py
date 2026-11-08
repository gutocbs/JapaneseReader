import json
import logging
from datetime import datetime, timezone

from fastapi.testclient import TestClient

from backend.app.main import create_app


LOGGER_NAME = "uvicorn.error"


def _http_log_records(caplog) -> list[dict]:
    records = []
    for record in caplog.records:
        if record.name != LOGGER_NAME:
            continue
        try:
            payload = json.loads(record.getMessage())
        except json.JSONDecodeError:
            continue
        if payload.get("event") == "http_request_completed":
            records.append(payload)
    return records


def _truncated(value: str) -> dict[str, object]:
    return {
        "preview": value[:30],
        "truncated": True,
        "originalLength": len(value),
    }


def test_document_log_has_utc_start_duration_and_truncated_request_and_response(caplog):
    long_content = "国境の長いトンネルを抜けると雪国であった。これは長い本文です。"
    long_description = "Documento usado para validar o truncamento da descrição nos logs."

    with TestClient(create_app(":memory:")) as client:
        document = client.post(
            "/api/documents", json={"title": "Inicial", "content": "短い本文"}
        ).json()
        caplog.clear()

        with caplog.at_level(logging.INFO, logger=LOGGER_NAME):
            response = client.put(
                f"/api/documents/{document['id']}?origin=editor",
                json={
                    "title": "雪国",
                    "content": long_content,
                    "description": long_description,
                },
            )

    assert response.status_code == 200
    assert response.json()["content"] == long_content
    assert response.json()["description"] == long_description

    records = _http_log_records(caplog)
    assert len(records) == 1
    record = records[0]
    assert record["method"] == "PUT"
    assert record["path"] == f"/api/documents/{document['id']}"
    assert record["query"] == "origin=editor"
    assert record["status"] == 200
    assert isinstance(record["durationMs"], float)
    assert record["durationMs"] >= 0
    started_at = datetime.fromisoformat(record["requestStartedAt"].replace("Z", "+00:00"))
    assert started_at.utcoffset() == timezone.utc.utcoffset(started_at)
    assert record["request"] == {
        "title": "雪国",
        "content": _truncated(long_content),
        "description": _truncated(long_description),
    }
    assert record["response"]["id"] == document["id"]
    assert record["response"]["title"] == "雪国"
    assert record["response"]["content"] == _truncated(long_content)
    assert record["response"]["description"] == _truncated(long_description)


def test_import_log_truncates_text_description_and_returned_content(caplog):
    imported_text = (
        "春はあけぼの。やうやう白くなりゆく山ぎは、少し明りて、"
        "紫だちたる雲の細くたなびきたる。"
    )
    description = "Imported from note.com with enough characters to require truncation."

    with TestClient(create_app(":memory:")) as client:
        caplog.clear()
        with caplog.at_level(logging.INFO, logger=LOGGER_NAME):
            response = client.post(
                "/api/imports",
                json={
                    "title": "枕草子",
                    "text": imported_text,
                    "description": description,
                    "source": "note.com",
                    "tags": [{"name": "Clássico", "color": "#7C3AED"}],
                },
            )

    assert response.status_code == 201
    assert response.json()["content"] == imported_text
    assert response.json()["description"] == description

    records = _http_log_records(caplog)
    assert len(records) == 1
    record = records[0]
    assert record["request"] == {
        "title": "枕草子",
        "text": _truncated(imported_text),
        "description": _truncated(description),
        "source": "note.com",
        "tags": [{"name": "Clássico", "color": "#7C3AED"}],
    }
    assert record["response"]["content"] == _truncated(imported_text)
    assert record["response"]["description"] == _truncated(description)


def test_other_api_payloads_and_problem_responses_are_logged_in_full(caplog):
    with TestClient(create_app(":memory:")) as client:
        caplog.clear()
        with caplog.at_level(logging.INFO, logger=LOGGER_NAME):
            created = client.post(
                "/api/tags", json={"name": "Descrição", "color": "#0F766E"}
            )
            invalid = client.post(
                "/api/tags", json={"name": "Inválida", "color": "not-a-color"}
            )

    assert created.status_code == 201
    assert invalid.status_code == 422

    records = _http_log_records(caplog)
    assert len(records) == 2
    assert records[0]["request"] == {"name": "Descrição", "color": "#0F766E"}
    assert records[0]["response"] == {"name": "Descrição", "color": "#0F766E"}
    assert records[1]["request"] == {"name": "Inválida", "color": "not-a-color"}
    assert records[1]["status"] == 422
    assert records[1]["response"] == invalid.json()


def test_empty_api_response_is_logged_without_a_payload(caplog):
    with TestClient(create_app(":memory:")) as client:
        client.post("/api/tags", json={"name": "Temporária", "color": "#123456"})
        caplog.clear()
        with caplog.at_level(logging.INFO, logger=LOGGER_NAME):
            response = client.delete("/api/tags/Tempor%C3%A1ria")

    assert response.status_code == 204
    records = _http_log_records(caplog)
    assert len(records) == 1
    assert records[0]["request"] is None
    assert records[0]["response"] is None


def test_analysis_log_omits_blocks_without_changing_the_http_response(caplog):
    with TestClient(create_app(":memory:")) as client:
        document = client.post(
            "/api/documents",
            json={"title": "Análise", "content": "日本語の文章を解析します。"},
        ).json()
        caplog.clear()

        with caplog.at_level(logging.INFO, logger=LOGGER_NAME):
            response = client.post(f"/api/documents/{document['id']}/analysis")

    assert response.status_code == 200
    assert response.json()["blocks"]

    records = _http_log_records(caplog)
    assert len(records) == 1
    logged_response = records[0]["response"]
    assert "blocks" not in logged_response
    assert logged_response["documentId"] == document["id"]
    assert logged_response["documentRevision"] == 1
    assert logged_response["contentHash"] == response.json()["contentHash"]
    assert logged_response["metadata"] == response.json()["metadata"]
    assert logged_response["analysisOptions"] == response.json()["analysisOptions"]
    assert logged_response["diagnostics"] == response.json()["diagnostics"]


def test_health_endpoint_does_not_emit_an_observability_log(caplog):
    with TestClient(create_app(":memory:")) as client:
        caplog.clear()
        with caplog.at_level(logging.INFO, logger=LOGGER_NAME):
            response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert _http_log_records(caplog) == []
