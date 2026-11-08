from collections.abc import Iterable
from datetime import datetime, timezone
import json
import logging
from time import perf_counter
from typing import Any

from starlette.types import ASGIApp, Message, Receive, Scope, Send


LOGGER = logging.getLogger("uvicorn.error")
PREVIEW_LENGTH = 30


class HttpObservabilityMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not _should_log_path(scope["path"]):
            await self.app(scope, receive, send)
            return

        request_started_at = datetime.now(timezone.utc)
        started = perf_counter()
        request_body = bytearray()
        response_body = bytearray()
        response_status = 500
        response_headers: Iterable[tuple[bytes, bytes]] = ()

        async def capture_request(message_receive: Receive = receive) -> Message:
            message = await message_receive()
            if message["type"] == "http.request":
                request_body.extend(message.get("body", b""))
            return message

        async def capture_response(
            message: Message, message_send: Send = send
        ) -> None:
            nonlocal response_headers, response_status
            if message["type"] == "http.response.start":
                response_status = message["status"]
                response_headers = message.get("headers", ())
            elif message["type"] == "http.response.body":
                response_body.extend(message.get("body", b""))
            await message_send(message)

        try:
            await self.app(scope, capture_request, capture_response)
        finally:
            duration_ms = round((perf_counter() - started) * 1000, 3)
            path = scope["path"]
            record = {
                "event": "http_request_completed",
                "requestStartedAt": request_started_at.isoformat(
                    timespec="milliseconds"
                ).replace("+00:00", "Z"),
                "method": scope["method"],
                "path": path,
                "query": scope.get("query_string", b"").decode(
                    "utf-8", errors="replace"
                ),
                "status": response_status,
                "durationMs": duration_ms,
                "request": _sanitize_payload(
                    path,
                    _decode_body(bytes(request_body), scope.get("headers", ())),
                ),
                "response": _sanitize_response_payload(
                    path,
                    _decode_body(bytes(response_body), response_headers),
                ),
            }
            LOGGER.info(
                json.dumps(record, ensure_ascii=False, separators=(",", ":"))
            )


def _should_log_path(path: str) -> bool:
    return path != "/api/health" and (path == "/api" or path.startswith("/api/"))


def _decode_body(body: bytes, headers: Iterable[tuple[bytes, bytes]]) -> Any:
    if not body:
        return None

    text = body.decode("utf-8", errors="replace")
    if _content_type(headers).partition(";")[0].strip().endswith("json"):
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass
    return text


def _content_type(headers: Iterable[tuple[bytes, bytes]]) -> str:
    for name, value in headers:
        if name.lower() == b"content-type":
            return value.decode("latin-1")
    return ""


def _sanitize_payload(path: str, payload: Any) -> Any:
    fields = _truncated_fields(path)
    if not fields:
        return payload
    return _truncate_fields(payload, fields)


def _sanitize_response_payload(path: str, payload: Any) -> Any:
    sanitized = _sanitize_payload(path, payload)
    if _is_document_analysis_path(path) and isinstance(sanitized, dict):
        return {key: value for key, value in sanitized.items() if key != "blocks"}
    return sanitized


def _is_document_analysis_path(path: str) -> bool:
    segments = path.split("/")
    return (
        len(segments) == 5
        and segments[1:3] == ["api", "documents"]
        and bool(segments[3])
        and segments[4] == "analysis"
    )


def _truncated_fields(path: str) -> frozenset[str]:
    if path == "/api/documents" or path.startswith("/api/documents/"):
        return frozenset({"content", "description"})
    if path == "/api/imports" or path.startswith("/api/imports/"):
        return frozenset({"text", "content", "description"})
    return frozenset()


def _truncate_fields(payload: Any, fields: frozenset[str]) -> Any:
    if isinstance(payload, list):
        return [_truncate_fields(item, fields) for item in payload]
    if not isinstance(payload, dict):
        return payload

    return {
        key: (
            _truncated_value(value)
            if key in fields and isinstance(value, str)
            else _truncate_fields(value, fields)
        )
        for key, value in payload.items()
    }


def _truncated_value(value: str) -> str | dict[str, object]:
    if len(value) <= PREVIEW_LENGTH:
        return value
    return {
        "preview": value[:PREVIEW_LENGTH],
        "truncated": True,
        "originalLength": len(value),
    }
