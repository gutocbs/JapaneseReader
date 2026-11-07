from types import SimpleNamespace

from fastapi import Request

from backend.app.api.errors import _safe_route_template


def test_safe_route_template_uses_route_pattern():
    request = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/api/tags/Grammar",
            "headers": [],
            "route": SimpleNamespace(path="/api/tags/{name}"),
        }
    )

    assert _safe_route_template(request) == "/api/tags/{name}"


def test_safe_route_template_does_not_fall_back_to_raw_path():
    request = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/api/tags/SECRET-TAG",
            "headers": [],
        }
    )

    result = _safe_route_template(request)

    assert result == "<unmatched>"
    assert "SECRET-TAG" not in result
