from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, ConfigDict

from backend.app.api.errors import PROBLEM_RESPONSES
from backend.app.furigana_exclusions.models import FuriganaExclusion
from backend.app.furigana_exclusions.service import FuriganaExclusionService


class FuriganaExclusionModel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lemma: str
    dictionaryReading: str

    @classmethod
    def from_exclusion(cls, exclusion: FuriganaExclusion) -> "FuriganaExclusionModel":
        return cls(lemma=exclusion.lemma, dictionaryReading=exclusion.dictionary_reading)


def get_furigana_exclusion_service(request: Request) -> FuriganaExclusionService:
    return request.app.state.furigana_exclusion_service


FuriganaExclusionServiceDependency = Annotated[FuriganaExclusionService, Depends(get_furigana_exclusion_service)]
router = APIRouter(prefix="/furigana-exclusions", tags=["furigana-exclusions"], responses=PROBLEM_RESPONSES)


@router.get("", response_model=list[FuriganaExclusionModel], operation_id="listFuriganaExclusions")
def list_furigana_exclusions(service: FuriganaExclusionServiceDependency) -> list[FuriganaExclusionModel]:
    return [FuriganaExclusionModel.from_exclusion(item) for item in service.list()]


@router.put("", status_code=204, operation_id="addFuriganaExclusion")
def add_furigana_exclusion(data: FuriganaExclusionModel, service: FuriganaExclusionServiceDependency) -> Response:
    service.add(data.lemma, data.dictionaryReading)
    return Response(status_code=204)


@router.delete("", status_code=204, operation_id="removeFuriganaExclusion")
def remove_furigana_exclusion(data: FuriganaExclusionModel, service: FuriganaExclusionServiceDependency) -> Response:
    service.remove(data.lemma, data.dictionaryReading)
    return Response(status_code=204)
