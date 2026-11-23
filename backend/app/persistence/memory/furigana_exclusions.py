from collections.abc import Iterable

from backend.app.furigana_exclusions.models import FuriganaExclusion


class InMemoryFuriganaExclusionRepository:
    def __init__(self, exclusions: Iterable[FuriganaExclusion] = ()) -> None:
        self._exclusions = set(exclusions)

    def list(self) -> tuple[FuriganaExclusion, ...]:
        return tuple(sorted(self._exclusions, key=lambda item: (item.lemma, item.dictionary_reading)))

    def add(self, exclusion: FuriganaExclusion) -> None:
        self._exclusions.add(exclusion)

    def remove(self, exclusion: FuriganaExclusion) -> None:
        self._exclusions.discard(exclusion)
