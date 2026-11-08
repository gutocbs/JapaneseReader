from uuid import UUID

from backend.app.readings.models import ReadingOverride, ReadingOverrideKey
from backend.app.readings.repository import ReadingOverrideRepository


FIRST_DOCUMENT = UUID("00000000-0000-0000-0000-000000000001")
SECOND_DOCUMENT = UUID("00000000-0000-0000-0000-000000000002")


class ReadingOverrideRepositoryContract:
    """Shared behavior required from memory and later SQLite adapters."""

    def test_upsert_get_and_delete_use_the_complete_occurrence_key(
        self, repository: ReadingOverrideRepository
    ):
        first = ReadingOverrideKey(FIRST_DOCUMENT, 1, 0, 1)
        second_occurrence = ReadingOverrideKey(FIRST_DOCUMENT, 1, 1, 2)
        next_revision = ReadingOverrideKey(FIRST_DOCUMENT, 2, 0, 1)

        assert repository.get(first) is None
        repository.upsert(ReadingOverride(first, "せい"))
        repository.upsert(ReadingOverride(second_occurrence, "しょう"))
        repository.upsert(ReadingOverride(next_revision, "なま"))
        repository.upsert(ReadingOverride(first, "しょう"))

        assert repository.get(first) == ReadingOverride(first, "しょう")
        assert repository.get(second_occurrence) == ReadingOverride(
            second_occurrence, "しょう"
        )
        assert repository.get(next_revision) == ReadingOverride(next_revision, "なま")
        assert repository.delete(first)
        assert repository.get(first) is None
        assert not repository.delete(first)

    def test_delete_document_clears_only_the_target_document(
        self, repository: ReadingOverrideRepository
    ):
        first = ReadingOverrideKey(FIRST_DOCUMENT, 1, 0, 1)
        second = ReadingOverrideKey(SECOND_DOCUMENT, 1, 0, 1)
        repository.upsert(ReadingOverride(first, "せい"))
        repository.upsert(ReadingOverride(second, "しょう"))

        repository.delete_document(FIRST_DOCUMENT)

        assert repository.get(first) is None
        assert repository.get(second) == ReadingOverride(second, "しょう")

    def test_reports_whether_a_document_has_manual_overrides(
        self, repository: ReadingOverrideRepository
    ):
        first = ReadingOverrideKey(FIRST_DOCUMENT, 1, 0, 1)
        second = ReadingOverrideKey(SECOND_DOCUMENT, 1, 0, 1)

        assert not repository.has_document(FIRST_DOCUMENT)
        repository.upsert(ReadingOverride(first, "せい"))
        repository.upsert(ReadingOverride(second, "しょう"))
        assert repository.has_document(FIRST_DOCUMENT)

        repository.delete_document(FIRST_DOCUMENT)
        assert not repository.has_document(FIRST_DOCUMENT)
        assert repository.has_document(SECOND_DOCUMENT)

    def test_lists_only_overrides_for_the_requested_document_and_revision(
        self, repository: ReadingOverrideRepository
    ):
        current = ReadingOverrideKey(FIRST_DOCUMENT, 1, 0, 1)
        same_document_old_revision = ReadingOverrideKey(FIRST_DOCUMENT, 2, 0, 1)
        other_document = ReadingOverrideKey(SECOND_DOCUMENT, 1, 0, 1)

        repository.upsert(ReadingOverride(current, "せい"))
        repository.upsert(ReadingOverride(same_document_old_revision, "しょう"))
        repository.upsert(ReadingOverride(other_document, "なま"))

        assert repository.list_for_document_revision(FIRST_DOCUMENT, 1) == (
            ReadingOverride(current, "せい"),
        )
