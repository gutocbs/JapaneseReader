import pytest

from backend.app.furigana_exclusions.models import FuriganaExclusion
from backend.app.furigana_exclusions.service import (
    FuriganaExclusionService,
    InvalidFuriganaExclusionError,
)
from backend.app.persistence.memory.furigana_exclusions import InMemoryFuriganaExclusionRepository


def test_service_validates_and_manages_distinct_dictionary_readings():
    service = FuriganaExclusionService(InMemoryFuriganaExclusionRepository())

    service.add("生", "せい")
    service.add("生", "しょう")
    service.add("生", "せい")

    assert service.list() == tuple(sorted((
        FuriganaExclusion("生", "せい"),
        FuriganaExclusion("生", "しょう"),
    ), key=lambda item: (item.lemma, item.dictionary_reading)))
    service.remove("生", "せい")
    service.remove("生", "せい")
    assert service.list() == (FuriganaExclusion("生", "しょう"),)


@pytest.mark.parametrize("lemma,dictionary_reading", [(" ", "せい"), ("生", " ")])
def test_service_rejects_blank_identity_parts(lemma, dictionary_reading):
    service = FuriganaExclusionService(InMemoryFuriganaExclusionRepository())

    with pytest.raises(InvalidFuriganaExclusionError):
        service.add(lemma, dictionary_reading)
