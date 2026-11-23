from dataclasses import dataclass


@dataclass(frozen=True)
class FuriganaExclusion:
    lemma: str
    dictionary_reading: str
