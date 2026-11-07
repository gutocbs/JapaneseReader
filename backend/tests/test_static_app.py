import asyncio

from httpx import ASGITransport, AsyncClient

from backend.app.main import create_app


def request(application, path: str):
    async def send_request():
        async with AsyncClient(
            transport=ASGITransport(app=application), base_url="http://test"
        ) as client:
            return await client.get(path)

    return asyncio.run(send_request())


def test_compiled_asset_is_served_from_static_directory(tmp_path):
    static_directory = tmp_path / "frontend"
    assets_directory = static_directory / "assets"
    assets_directory.mkdir(parents=True)
    (assets_directory / "reader.js").write_text("console.log('reader');")
    application = create_app(
        database_path=tmp_path / "reader.db", static_directory=static_directory
    )

    response = request(application, "/assets/reader.js")

    assert response.status_code == 200
    assert response.text == "console.log('reader');"


def test_root_static_file_is_served_from_static_directory(tmp_path):
    static_directory = tmp_path / "frontend"
    static_directory.mkdir()
    (static_directory / "icon128.png").write_bytes(b"png-content")
    application = create_app(
        database_path=tmp_path / "reader.db", static_directory=static_directory
    )

    response = request(application, "/icon128.png")

    assert response.status_code == 200
    assert response.content == b"png-content"


def test_non_api_deep_link_serves_compiled_index(tmp_path):
    static_directory = tmp_path / "frontend"
    static_directory.mkdir()
    (static_directory / "index.html").write_text("<main>Japanese Reader</main>")
    application = create_app(
        database_path=tmp_path / "reader.db", static_directory=static_directory
    )

    response = request(application, "/documents/123")

    assert response.status_code == 200
    assert response.text == "<main>Japanese Reader</main>"


def test_health_api_remains_json_when_static_directory_exists(tmp_path):
    static_directory = tmp_path / "frontend"
    static_directory.mkdir()
    (static_directory / "index.html").write_text("<main>Japanese Reader</main>")
    application = create_app(
        database_path=tmp_path / "reader.db", static_directory=static_directory
    )

    response = request(application, "/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_missing_static_directory_keeps_non_api_routes_unavailable(tmp_path):
    static_directory = tmp_path / "missing-frontend"
    application = create_app(
        database_path=tmp_path / "reader.db",
        static_directory=static_directory,
    )

    assert request(application, "/api/health").status_code == 200
    assert request(application, "/documents/123").status_code == 404
    assert not static_directory.exists()


def test_static_file_path_keeps_api_available_without_mounting_frontend(tmp_path):
    static_path = tmp_path / "not-a-frontend-directory"
    static_path.write_text("not a directory")
    application = create_app(
        database_path=tmp_path / "reader.db", static_directory=static_path
    )

    assert request(application, "/api/health").status_code == 200
    assert request(application, "/documents/123").status_code == 404
    assert static_path.read_text() == "not a directory"
