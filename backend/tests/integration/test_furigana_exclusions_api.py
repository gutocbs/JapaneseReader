import sqlite3

import pytest
from fastapi.testclient import TestClient

from backend.app.main import create_app
from backend.app.furigana_exclusions.service import FuriganaExclusionService


@pytest.fixture
def client():
    with TestClient(create_app(":memory:")) as test_client:
        yield test_client


def test_exclusion_api_is_idempotent_and_preserves_distinct_readings(client):
    sei = {"lemma": "生", "dictionaryReading": "せい"}
    shou = {"lemma": "生", "dictionaryReading": "しょう"}

    assert client.get("/api/furigana-exclusions").json() == []
    assert client.put("/api/furigana-exclusions", json=sei).status_code == 204
    assert client.put("/api/furigana-exclusions", json=sei).status_code == 204
    assert client.put("/api/furigana-exclusions", json=shou).status_code == 204
    assert client.get("/api/furigana-exclusions").json() == sorted([sei, shou], key=lambda item: item["dictionaryReading"])
    assert client.request("DELETE", "/api/furigana-exclusions", json=sei).status_code == 204
    assert client.request("DELETE", "/api/furigana-exclusions", json=sei).status_code == 204
    assert client.get("/api/furigana-exclusions").json() == [shou]


@pytest.mark.parametrize("payload", [{"lemma": " ", "dictionaryReading": "せい"}, {"lemma": "生", "dictionaryReading": " "}])
def test_exclusion_api_rejects_blank_identity_parts_as_problem_details(client, payload):
    response = client.put("/api/furigana-exclusions", json=payload)

    assert response.status_code == 422
    assert response.headers["content-type"] == "application/problem+json"


def test_exclusion_api_documents_operations(client):
    paths = create_app(":memory:").openapi()["paths"]["/api/furigana-exclusions"]

    assert paths["get"]["operationId"] == "listFuriganaExclusions"
    assert paths["put"]["operationId"] == "addFuriganaExclusion"
    assert paths["delete"]["operationId"] == "removeFuriganaExclusion"


def test_exclusion_api_maps_sqlite_error_to_problem_details(client):
    class FailingRepository:
        def list(self):
            raise sqlite3.OperationalError("database is locked")

        def add(self, exclusion):
            raise sqlite3.OperationalError("database is locked")

        def remove(self, exclusion):
            raise sqlite3.OperationalError("database is locked")

    client.app.state.furigana_exclusion_service = FuriganaExclusionService(FailingRepository())
    response = client.get("/api/furigana-exclusions")

    assert response.status_code == 503
    assert response.headers["content-type"] == "application/problem+json"

