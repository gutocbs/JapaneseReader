from backend.app.furigana_exclusions.models import FuriganaExclusion
from backend.app.furigana_exclusions.repository import FuriganaExclusionRepository


class InvalidFuriganaExclusionError(ValueError):
    def __init__(self, lemma: str, dictionary_reading: str) -> None:
        super().__init__("Furigana exclusion requires a non-empty lemma and dictionary reading")


class FuriganaExclusionService:
    def __init__(self, repository: FuriganaExclusionRepository) -> None:
        self._repository = repository

    def list(self) -> tuple[FuriganaExclusion, ...]:
        return self._repository.list()

    def add(self, lemma: str, dictionary_reading: str) -> None:
        self._validate(lemma, dictionary_reading)
        self._repository.add(FuriganaExclusion(lemma, dictionary_reading))

    def remove(self, lemma: str, dictionary_reading: str) -> None:
        self._validate(lemma, dictionary_reading)
        self._repository.remove(FuriganaExclusion(lemma, dictionary_reading))

    @staticmethod
    def _validate(lemma: str, dictionary_reading: str) -> None:
        if not lemma.strip() or not dictionary_reading.strip():
            raise InvalidFuriganaExclusionError(lemma, dictionary_reading)
