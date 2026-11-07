from http import HTTPStatus
import logging
import sqlite3

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException

from backend.app.analysis.service import EmptyDocumentError, StaleDocumentRevisionError
from backend.app.documents.service import (
    DocumentNotFoundError,
    ReadingOverridesConfirmationRequiredError,
)
from backend.app.readings.service import (
    InvalidReadingError,
    InvalidReadingOverrideTargetError,
    InvalidReadingOverrideVocabularyKeyError,
    StaleReadingOverrideRevisionError,
)
from backend.app.reading_exceptions.service import (
    InvalidReadingExceptionError,
    ReadingExceptionNotFoundError,
)


LOGGER = logging.getLogger(__name__)


class ProblemDetails(BaseModel):
    type: str
    title: str
    status: int
    detail: str


class ProblemResponse(JSONResponse):
    media_type = "application/problem+json"


READING_OVERRIDES_CONFIRMATION_REQUIRED_TYPE = (
    "urn:japanese-reader:reading-overrides-confirmation-required"
)


def problem_response(
    status: int, detail: str, *, problem_type: str = "about:blank"
) -> ProblemResponse:
    problem = ProblemDetails(
        type=problem_type, title=HTTPStatus(status).phrase, status=status, detail=detail
    )
    return ProblemResponse(status_code=status, content=problem.model_dump())


def _safe_route_template(request: Request) -> str:
    route = request.scope.get("route")
    path = getattr(route, "path", None)
    return path if isinstance(path, str) else "<unmatched>"


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(sqlite3.Error)
    async def sqlite_error(request: Request, error: sqlite3.Error):
        LOGGER.exception(
            "SQLite operation failed for %s %s",
            request.method,
            _safe_route_template(request),
        )
        return problem_response(
            503, "The local database operation failed; changes were not saved"
        )

    @app.exception_handler(EmptyDocumentError)
    async def empty_document(request: Request, error: EmptyDocumentError):
        return problem_response(422, str(error))

    @app.exception_handler(StaleDocumentRevisionError)
    async def stale_revision(request: Request, error: StaleDocumentRevisionError):
        return problem_response(409, str(error))

    @app.exception_handler(ReadingOverridesConfirmationRequiredError)
    async def reading_overrides_confirmation_required(
        request: Request, error: ReadingOverridesConfirmationRequiredError
    ):
        return problem_response(
            409,
            str(error),
            problem_type=READING_OVERRIDES_CONFIRMATION_REQUIRED_TYPE,
        )

    @app.exception_handler(StaleReadingOverrideRevisionError)
    async def stale_override_revision(
        request: Request, error: StaleReadingOverrideRevisionError
    ):
        return problem_response(409, str(error))

    @app.exception_handler(InvalidReadingError)
    @app.exception_handler(InvalidReadingExceptionError)
    @app.exception_handler(InvalidReadingOverrideTargetError)
    @app.exception_handler(InvalidReadingOverrideVocabularyKeyError)
    async def invalid_reading_override(request: Request, error: ValueError):
        return problem_response(422, str(error))

    @app.exception_handler(DocumentNotFoundError)
    @app.exception_handler(ReadingExceptionNotFoundError)
    async def document_not_found(request: Request, error: DocumentNotFoundError):
        return problem_response(404, str(error))

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request: Request, error: RequestValidationError):
        return problem_response(422, str(error))

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, error: HTTPException):
        response = problem_response(error.status_code, str(error.detail))
        if error.headers:
            response.headers.update(error.headers)
        return response


PROBLEM_RESPONSES = {
    status: {
        "description": HTTPStatus(status).phrase,
        "content": {"application/problem+json": {"schema": ProblemDetails.model_json_schema()}},
    }
    for status in (404, 422, 503)
}
