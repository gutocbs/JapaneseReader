from threading import Lock
from uuid import UUID

from backend.app.readings.models import ReadingOverride, ReadingOverrideKey


class InMemoryReadingOverrideRepository:
    def __init__(self) -> None:
        self._overrides: dict[ReadingOverrideKey, ReadingOverride] = {}
        self._lock = Lock()

    def has_document(self, document_id: UUID) -> bool:
        with self._lock:
            return any(key.document_id == document_id for key in self._overrides)

    def list_for_document_revision(
        self, document_id: UUID, document_revision: int
    ) -> tuple[ReadingOverride, ...]:
        with self._lock:
            return tuple(
                sorted(
                    (
                        override
                        for key, override in self._overrides.items()
                        if key.document_id == document_id
                        and key.document_revision == document_revision
                    ),
                    key=lambda override: (
                        override.key.start_offset,
                        override.key.end_offset,
                    ),
                )
            )

    def get(self, key: ReadingOverrideKey) -> ReadingOverride | None:
        with self._lock:
            return self._overrides.get(key)

    def upsert(self, override: ReadingOverride) -> None:
        with self._lock:
            self._overrides[override.key] = override

    def delete(self, key: ReadingOverrideKey) -> bool:
        with self._lock:
            return self._overrides.pop(key, None) is not None

    def delete_document(self, document_id: UUID) -> None:
        with self._lock:
            self._overrides = {
                key: override
                for key, override in self._overrides.items()
                if key.document_id != document_id
            }
