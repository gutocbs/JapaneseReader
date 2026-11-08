from contextlib import asynccontextmanager
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.app.analysis.furigana import FuriganaAligner
from backend.app.analysis.morphology import SudachiMorphologicalAnalyzer
from backend.app.analysis.service import AnalysisService
from backend.app.api.errors import install_error_handlers
from backend.app.api.http_observability import HttpObservabilityMiddleware
from backend.app.api.router import router
from backend.app.documents.service import DocumentService
from backend.app.persistence.sqlite.connection import SqliteDatabase
from backend.app.persistence.sqlite.repositories import (
    SqliteAnalysisRepository,
    SqliteDocumentRepository,
    SqliteReadingOverrideRepository,
    SqliteReadingExceptionRepository,
    SqliteVocabularyRepository,
)
from backend.app.readings.service import ReadingOverrideResolver, ReadingOverrideService
from backend.app.reading_exceptions.service import (
    ReadingExceptionResolver,
    ReadingExceptionService,
)
from backend.app.vocabulary.service import VocabularySelectionService


@asynccontextmanager
async def lifespan(application: FastAPI):
    analyzer = SudachiMorphologicalAnalyzer()
    application.state.morphological_analyzer = analyzer
    try:
        application.state.analysis_service = AnalysisService(
            application.state.document_repository,
            application.state.analysis_repository,
            analyzer,
            FuriganaAligner(),
            ReadingOverrideResolver(application.state.reading_override_repository),
            ReadingExceptionResolver(application.state.reading_exception_repository),
        )
        application.state.reading_override_service = ReadingOverrideService(
            application.state.document_repository,
            application.state.reading_override_repository,
            application.state.analysis_service,
            application.state.analysis_repository,
        )
        application.state.vocabulary_service = VocabularySelectionService(
            application.state.document_repository,
            application.state.vocabulary_repository,
            application.state.analysis_service,
            application.state.vocabulary_repository,
        )
        yield
    finally:
        analyzer.close()
        del application.state.morphological_analyzer
        del application.state.analysis_service
        del application.state.reading_override_service
        del application.state.reading_exception_service
        del application.state.vocabulary_service
        application.state.database.close()


def create_app(
    database_path: str | Path | None = None,
    static_directory: str | Path | None = None,
) -> FastAPI:
    configured_path = database_path or os.environ.get(
        "DATABASE_PATH", "./data/japanese-reader.db"
    )
    database = SqliteDatabase(configured_path)
    documents = SqliteDocumentRepository(database)
    analyses = SqliteAnalysisRepository(database)
    reading_overrides = SqliteReadingOverrideRepository(database)
    reading_exceptions = SqliteReadingExceptionRepository(database)
    vocabulary = SqliteVocabularyRepository(database)

    application = FastAPI(title="Japanese Reader", lifespan=lifespan)
    application.add_middleware(HttpObservabilityMiddleware)
    application.state.database = database
    application.state.document_repository = documents
    application.state.analysis_repository = analyses
    application.state.reading_override_repository = reading_overrides
    application.state.reading_exception_repository = reading_exceptions
    application.state.reading_exception_service = ReadingExceptionService(reading_exceptions)
    application.state.vocabulary_repository = vocabulary
    application.state.document_service = DocumentService(
        documents, analyses, reading_overrides
    )
    install_error_handlers(application)
    application.include_router(router)

    @application.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    configured_static_directory = static_directory or os.environ.get(
        "STATIC_DIRECTORY"
    )
    if configured_static_directory:
        frontend_directory = Path(configured_static_directory)
        if frontend_directory.is_dir():
            index_file = frontend_directory / "index.html"
            assets_directory = frontend_directory / "assets"

            if assets_directory.is_dir():
                application.mount(
                    "/assets", StaticFiles(directory=assets_directory), name="assets"
                )

            for root_file in frontend_directory.iterdir():
                if root_file.is_file() and root_file.name != "index.html":

                    @application.get(f"/{root_file.name}", include_in_schema=False)
                    def frontend_root_file(path: Path = root_file) -> FileResponse:
                        return FileResponse(path)

            if index_file.is_file():

                @application.get("/{frontend_path:path}", include_in_schema=False)
                def frontend(frontend_path: str) -> FileResponse:
                    if frontend_path == "api" or frontend_path.startswith("api/"):
                        raise HTTPException(status_code=404, detail="Not Found")
                    return FileResponse(index_file)

    return application


app = create_app()
