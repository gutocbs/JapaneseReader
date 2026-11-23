from fastapi import APIRouter

from backend.app.analysis.api import router as analysis_router
from backend.app.furigana_exclusions.api import router as furigana_exclusions_router
from backend.app.documents.api import router as documents_router
from backend.app.imports_api import router as imports_router
from backend.app.reading_exceptions.api import router as reading_exceptions_router
from backend.app.readings.api import router as readings_router
from backend.app.vocabulary.api import router as vocabulary_router
from backend.app.tags_api import router as tags_router

router = APIRouter(prefix="/api")
router.include_router(furigana_exclusions_router)
router.include_router(documents_router)
router.include_router(imports_router)
router.include_router(analysis_router)
router.include_router(vocabulary_router)
router.include_router(readings_router)
router.include_router(reading_exceptions_router)
router.include_router(tags_router)

