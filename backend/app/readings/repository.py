from typing import Protocol
from uuid import UUID

from backend.app.readings.models import ReadingOverride, ReadingOverrideKey


class ReadingOverrideRepository(Protocol):
    def has_document(self, document_id: UUID) -> bool: ...

    def list_for_document_revision(
        self, document_id: UUID, document_revision: int
    ) -> tuple[ReadingOverride, ...]: ...

    def get(self, key: ReadingOverrideKey) -> ReadingOverride | None: ...

    def upsert(self, override: ReadingOverride) -> None: ...

    def delete(self, key: ReadingOverrideKey) -> bool: ...

    def delete_document(self, document_id: UUID) -> None: ...
