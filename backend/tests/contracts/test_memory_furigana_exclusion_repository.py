import pytest

from backend.app.persistence.memory.furigana_exclusions import InMemoryFuriganaExclusionRepository
from backend.app.furigana_exclusions.models import FuriganaExclusion


def test_exclusions_are_idempotent_and_keep_readings_distinct():
    repository = InMemoryFuriganaExclusionRepository()
    sei = FuriganaExclusion("生", "せい")
    shou = FuriganaExclusion("生", "しょう")

    repository.add(sei)
    repository.add(sei)
    repository.add(shou)

    assert repository.list() == tuple(sorted((sei, shou), key=lambda item: (item.lemma, item.dictionary_reading)))
    repository.remove(sei)
    repository.remove(sei)
    assert repository.list() == (shou,)

