from backend.app.persistence.sqlite.connection import SqliteDatabase
from backend.app.persistence.sqlite.repositories import SqliteFuriganaExclusionRepository
from backend.app.furigana_exclusions.models import FuriganaExclusion


def test_sqlite_exclusions_are_idempotent_and_primary_key_is_indexed(tmp_path):
    database = SqliteDatabase(tmp_path / "exclusions.db")
    repository = SqliteFuriganaExclusionRepository(database)
    sei = FuriganaExclusion("生", "せい")
    shou = FuriganaExclusion("生", "しょう")

    repository.add(sei)
    repository.add(sei)
    repository.add(shou)

    assert repository.list() == tuple(sorted((sei, shou), key=lambda item: (item.lemma, item.dictionary_reading)))
    with database.unit_of_work() as connection:
        indexes = connection.execute("PRAGMA index_list('furigana_exclusions')").fetchall()
        primary_key = next(index for index in indexes if index[3] == "pk")
        columns = connection.execute(f"PRAGMA index_info({primary_key[1]})").fetchall()
    assert [column[2] for column in columns] == ["lemma", "dictionary_reading"]

