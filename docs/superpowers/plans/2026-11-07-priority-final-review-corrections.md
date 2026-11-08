# Priority Final-Review Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the backend release gate, keep API-only startup available without compiled static files, align the color tests with the public contract, and make SQLite failures correctly classified and safely observable.

**Architecture:** Apply narrow changes at the current ownership boundaries: pytest configuration, FastAPI app assembly, the shared tag contract tests, the SQLite tag repository, and the global API error handler. Preserve all HTTP, OpenAPI and persistence contracts; add tests that distinguish expected tag conflicts from operational database failures.

**Tech Stack:** Python 3.12, pytest, FastAPI/Starlette, SQLite, Pydantic, React/Vitest verification, PowerShell, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-11-07-priority-final-review-corrections-design.md`

## Global Constraints

- Keep `Document.content` canonical and analysis data derived and revision-aware.
- Do not change HTTP, OpenAPI or persisted-data contracts.
- Accept tag colors matching `#[0-9A-Fa-f]{6}`; hexadecimal case is not significant.
- Missing or non-directory `STATIC_DIRECTORY` means API-only mode and must not create the path.
- Only `SQLITE_CONSTRAINT_UNIQUE` and `SQLITE_CONSTRAINT_PRIMARYKEY` from tag insertion map to 409.
- Log SQLite failures at `ERROR` with exception type, HTTP method and route template only.
- Never log request bodies, query strings, resolved route values, document content, titles, URLs, credentials, tokens or personal data.
- Preserve the public 503 Problem Details body and the existing 409 duplicate-tag behavior.
- Do not edit generated OpenAPI types by hand.
- Preserve unrelated workspace changes and do not add `docs/FINAL-REVIEW.md` to implementation commits unless separately authorized.

## Review Focus

- `STATIC_DIRECTORY` points to a regular file: start API-only, return frontend 404 and leave the file untouched; pinned in Task 2.
- A mixed-case color such as `#aBc123`: accept it everywhere the shared tag model is used; pinned in Task 3.
- A non-unique SQLite constraint such as a trigger failure: return 503, not 409; pinned in Task 4.
- A duplicate tag differing only by case: keep 409 and emit no database-failure log; pinned in Task 4.
- An exception handler request without a resolved route object: log a neutral route marker and never the raw path; pinned in Task 4.

---

### Task 1: Make the official pytest command collect the full suite

**Files:**
- Modify: `pyproject.toml:18-20`
- Test: `backend/tests/unit/documents/test_service.py`
- Test: `backend/tests/unit/reading_exceptions/test_service.py`

**Interfaces:**
- Consumes: pytest configuration under `[tool.pytest.ini_options]`.
- Produces: `uv run pytest` using importlib mode without callers supplying extra flags.

- [ ] **Step 1: Reproduce the collection failure with the public command**

Run: `uv run pytest --collect-only -q`

Expected: FAIL with `import file mismatch` between the two `test_service.py` modules. If it does not fail, record the environment and confirm both files appear in collection before changing configuration.

- [ ] **Step 2: Configure importlib collection**

Add this exact pytest option in `pyproject.toml`:

```toml
addopts = ["--import-mode=importlib"]
```

Do not rename tests, add package markers or exclude directories.

- [ ] **Step 3: Verify both colliding modules collect**

Run:

```powershell
uv run pytest --collect-only -q backend/tests/unit/documents/test_service.py backend/tests/unit/reading_exceptions/test_service.py
```

Expected: PASS; tests from both paths are listed and there is no import mismatch.

- [ ] **Step 4: Run both service suites**

Run:

```powershell
uv run pytest -q backend/tests/unit/documents/test_service.py backend/tests/unit/reading_exceptions/test_service.py
```

Expected: PASS with zero failures.

- [ ] **Step 5: Commit the collection fix**

```powershell
git add pyproject.toml
git commit -m "test: collect duplicate test module names"
```

---

### Task 2: Degrade missing static assets to API-only mode

**Files:**
- Modify: `backend/app/main.py:99-125`
- Modify: `backend/tests/test_static_app.py:75-83`

**Interfaces:**
- Consumes: `create_app(database_path, static_directory)`.
- Produces: unchanged FastAPI application creation with static routes registered only for an existing directory.

- [ ] **Step 1: Strengthen the missing-directory regression test**

Extend `test_missing_static_directory_keeps_non_api_routes_unavailable` to assert all of the following:

```python
assert request(application, "/api/health").status_code == 200
assert request(application, "/documents/123").status_code == 404
assert not static_directory.exists()
```

Keep `static_directory` in a named local variable so the last assertion is explicit.

- [ ] **Step 2: Add the regular-file edge case**

Add `test_static_file_path_keeps_api_available_without_mounting_frontend`. Create a file at the configured path and assert:

```python
assert request(application, "/api/health").status_code == 200
assert request(application, "/documents/123").status_code == 404
assert static_path.read_text() == "not a directory"
```

- [ ] **Step 3: Run the focused tests and verify the current implementation fails**

Run:

```powershell
uv run pytest -q backend/tests/test_static_app.py -k "missing_static_directory or static_file_path"
```

Expected: FAIL from `Path.iterdir()` for the missing path and/or regular file.

- [ ] **Step 4: Guard all static route assembly behind the directory check**

In `create_app()`, keep the existing environment/argument resolution and set `frontend_directory = Path(configured_static_directory)`. Register assets, root files and the SPA fallback only when `frontend_directory.is_dir()` is true. Do not call `mkdir`, do not raise for a missing path and do not change the valid-directory route bodies.

- [ ] **Step 5: Run the complete static application suite**

Run: `uv run pytest -q backend/tests/test_static_app.py`

Expected: PASS for assets, root files, SPA fallback, API precedence, missing directory and regular-file path.

- [ ] **Step 6: Commit the API-only fallback**

```powershell
git add backend/app/main.py backend/tests/test_static_app.py
git commit -m "fix: keep API available without static assets"
```

---

### Task 3: Align import color tests and documentation with the shared contract

**Files:**
- Modify: `backend/tests/integration/test_public_import_api.py:76-128`
- Modify: `userscript/note-import/README.md:31-39,55-59`
- Verify only: `backend/app/documents/api.py` (`DocumentTagModel`)
- Verify only: `frontend/openapi.json`

**Interfaces:**
- Consumes: shared `DocumentTagModel` pattern `#[0-9A-Fa-f]{6}`.
- Produces: tests and documentation that treat uppercase, lowercase and mixed-case hexadecimal as valid.

- [ ] **Step 1: Reproduce the contradictory test**

Run:

```powershell
uv run pytest -q backend/tests/integration/test_public_import_api.py::test_public_import_rejects_malformed_payloads
```

Expected: FAIL only for the `#ffffff` case because the API returns 201.

- [ ] **Step 2: Remove only the valid color from the malformed table**

Delete the parameter containing `{"name": "Grammar", "color": "#ffffff"}`. Preserve every other malformed payload and its 422 assertions.

- [ ] **Step 3: Add an explicit case-insensitive acceptance test**

Add `test_public_import_accepts_hex_colors_case_insensitively`, using two tags with distinct names and colors `#ffffff` and `#aBc123`. Assert:

```python
assert response.status_code == 201
assert response.json()["tags"] == [
    {"name": "Lower", "color": "#ffffff"},
    {"name": "Mixed", "color": "#aBc123"},
]
```

The API must preserve the submitted color spelling; do not normalize case.

- [ ] **Step 4: Remove the obsolete known-failure statement from the userscript guide**

Update the validation section to state that the public import suite must pass. Clarify that `#RRGGBB` denotes six hexadecimal digits and accepts uppercase, lowercase or mixed case. Do not change the userscript payload.

- [ ] **Step 5: Run import and tag contract tests**

Run:

```powershell
uv run pytest -q backend/tests/integration/test_public_import_api.py backend/tests/integration/test_tags_api.py
```

Expected: PASS, including all malformed formats and lowercase/mixed-case acceptance.

- [ ] **Step 6: Prove the schema did not change**

Generate OpenAPI and TypeScript in an isolated temporary directory or compare `app.openapi()` and isolated `openapi-typescript` output with the tracked files.

Expected: no diff in `frontend/openapi.json` or `frontend/src/shared/api/generated.ts`.

- [ ] **Step 7: Commit the contract-test correction**

```powershell
git add backend/tests/integration/test_public_import_api.py userscript/note-import/README.md
git commit -m "test: align import colors with tag contract"
```

---

### Task 4: Distinguish tag conflicts from database failures and log safely

**Files:**
- Modify: `backend/app/persistence/sqlite/repositories.py:1-6,180-184`
- Modify: `backend/app/api/errors.py:1-8,52-57`
- Modify: `backend/tests/integration/test_tags_api.py`
- Create: `backend/tests/unit/api/test_errors.py`

**Interfaces:**
- Consumes: `SqliteDocumentRepository.create_tag(tag: DocumentTag) -> DocumentTag` and FastAPI's `Request.scope`.
- Produces: `_safe_route_template(request: Request) -> str`; duplicate names still raise `ValueError("Tag already exists")`; other SQLite errors propagate to the 503 handler.

- [ ] **Step 1: Add an integration test for a non-unique constraint failure**

Add `test_non_unique_tag_integrity_failure_returns_503_and_logs_safe_route`. Build an in-memory application, create a SQLite `BEFORE INSERT ON tags` trigger that executes `RAISE(FAIL, 'forced tag failure')`, and issue:

```python
client.post("/api/tags", json={"name": "SECRET-TAG", "color": "#aBc123"})
```

With `caplog` restricted to `backend.app.api.errors` at `ERROR`, assert:

```python
assert response.status_code == 503
assert response.headers["content-type"] == "application/problem+json"
assert response.json()["detail"] == "The local database operation failed; changes were not saved"
assert len(error_records) == 1
assert "POST" in error_records[0].getMessage()
assert "/api/tags" in error_records[0].getMessage()
assert "SECRET-TAG" not in caplog.text
assert "#aBc123" not in caplog.text
```

- [ ] **Step 2: Add a no-noise test for expected duplicates**

Add `test_duplicate_tag_conflict_does_not_log_database_failure`. Create `Grammar`, then post `grammar`. Assert 409 and zero `ERROR` records from `backend.app.api.errors`.

- [ ] **Step 3: Add unit tests for safe route template extraction**

In `backend/tests/unit/api/test_errors.py`, add:

- `test_safe_route_template_uses_route_pattern`, with a scope route whose `path` is `/api/tags/{name}`;
- `test_safe_route_template_does_not_fall_back_to_raw_path`, with raw path `/api/tags/SECRET-TAG` and no route object.

Assert the first returns `/api/tags/{name}` and the second returns `<unmatched>` without containing `SECRET-TAG`.

- [ ] **Step 4: Run the new tests and verify they fail for the intended reasons**

Run:

```powershell
uv run pytest -q backend/tests/integration/test_tags_api.py -k "non_unique or duplicate_tag_conflict_does_not_log"
uv run pytest -q backend/tests/unit/api/test_errors.py
```

Expected: FAIL because the trigger error is currently converted to 409, no safe log exists, and `_safe_route_template` is undefined.

- [ ] **Step 5: Narrow `create_tag` exception translation**

Import `sqlite3` as a module if necessary. Catch only `sqlite3.IntegrityError`. Read `error.sqlite_errorcode` and convert only `sqlite3.SQLITE_CONSTRAINT_UNIQUE` or `sqlite3.SQLITE_CONSTRAINT_PRIMARYKEY` to the existing `ValueError`. Re-raise every other integrity failure unchanged. Do not catch `Exception`.

- [ ] **Step 6: Implement safe route-template logging**

In `backend/app/api/errors.py`:

- define `LOGGER = logging.getLogger(__name__)`;
- add `_safe_route_template(request: Request) -> str`;
- return `route.path` only when it is a string;
- otherwise return `<unmatched>`;
- call `LOGGER.exception("SQLite operation failed for %s %s", request.method, _safe_route_template(request))` once in the SQLite handler;
- preserve the exact 503 response body.

- [ ] **Step 7: Run the focused repository, API and logging tests**

Run:

```powershell
uv run pytest -q backend/tests/integration/test_tags_api.py backend/tests/unit/api/test_errors.py backend/tests/integration/test_sqlite_persistence.py
```

Expected: PASS. Confirm the forced trigger returns 503, duplicate case variants return 409, and logs contain no sentinels.

- [ ] **Step 8: Commit the classification and observability change**

```powershell
git add backend/app/persistence/sqlite/repositories.py backend/app/api/errors.py backend/tests/integration/test_tags_api.py backend/tests/unit/api/test_errors.py
git commit -m "fix: classify and log SQLite tag failures"
```

---

### Task 5: Run complete release evidence and stop

**Files:**
- Verify only: all changed files from Tasks 1-4
- Verify only: `frontend/openapi.json`
- Verify only: `frontend/src/shared/api/generated.ts`
- Verify only: `userscript/note-import/note-import.user.js`

**Interfaces:**
- Consumes: the four independently committed deliverables.
- Produces: auditable pass/fail evidence; no additional product change.

- [ ] **Step 1: Run the official backend gate without collection workarounds**

Run: `uv run pytest`

Expected: PASS with all collected tests and only explicitly reported skips. Do not add `--import-mode` on the command line.

- [ ] **Step 2: Run the frontend suite from its package directory**

Run: `npm --prefix frontend test -- --run`

Expected: PASS with zero failed files or tests. Record performance JSON separately from correctness.

- [ ] **Step 3: Run the userscript gates**

Run:

```powershell
node .\frontend\node_modules\vitest\vitest.mjs run userscript\note-import --reporter=dot
node --check userscript/note-import/note-import.user.js
```

Expected: 35/35 or the current expanded count passes; syntax check exits 0.

- [ ] **Step 4: Run build and Compose validation**

Run:

```powershell
npm run build
docker compose config --quiet
```

Expected: both exit 0. Classify Docker configuration-access warnings as environmental if config validation succeeds.

- [ ] **Step 5: Verify generated-artifact parity in isolation**

Regenerate OpenAPI, `generated.ts` and the userscript bundle outside tracked paths and compare hashes with tracked artifacts.

Expected: byte-for-byte equality; do not overwrite tracked generated files merely to test parity.

- [ ] **Step 6: Check patch hygiene and workspace scope**

Run:

```powershell
git diff --check
git status --short
git log -5 --oneline
```

Expected: no whitespace errors; only authorized pre-existing files remain untracked/modified; four implementation commits are visible. Stop and report rather than fixing unrelated state.
