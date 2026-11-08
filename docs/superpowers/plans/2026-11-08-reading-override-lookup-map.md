# Reading Override Lookup-Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove per-token SQLite override lookups from cache-miss document analysis while preserving local and vocabulary-wide reading behavior.

**Architecture:** A repository bulk-read returns the overrides for one document revision. `ReadingOverrideResolver` converts that result into an immutable per-analysis snapshot, and `AnalysisService` uses the snapshot only after its compatible-cache lookup misses. The persisted format, HTTP contracts, cache identity, and mutation invalidation remain unchanged.

**Tech Stack:** Python 3.12, FastAPI, SQLite, pytest, SudachiPy/SudachiDict.

**Spec:** `docs/superpowers/specs/2026-11-08-reading-override-lookup-map-design.md`

## Global Constraints

- Preserve `Document.content` as canonical and analysis as derived cache data.
- Do not change HTTP routes, OpenAPI, response DTOs, SQLite schema, migrations, or Problem Details responses.
- Preserve document revision, content hash, analyzer/dictionary metadata, analysis options, and reading-exception version in cache compatibility.
- Preserve local-one-occurrence and vocabulary-wide affected-count semantics, offsets, readings, vocabulary keys, `hasReadingOverride`, and furigana output.
- Do not add a process-wide override cache or the deferred optimistic/asynchronous UX behavior.
- Use the shared deterministic fixture `tests/fixtures/reading_override_cases.json`; retain the 50,000-character test only if its isolated execution is at most two minutes.
- Do not add machine-dependent latency thresholds to CI; retain raw measurement output under ignored `.dev/` paths.

## Review Focus

- Empty snapshot: cache-miss analysis must make one bounded bulk read, return analyzer readings, and make no exact-key reads. **Task 3.**
- Revision isolation: an override from the same document’s older revision must not appear in a newer-revision bulk result. **Task 1.**
- Document isolation: an override from another document with identical offsets must not appear in the requested snapshot. **Task 1.**
- Scope equivalence: entries created by vocabulary-wide mutation must resolve exactly like local entries once persisted per occurrence. **Task 3.**
- Cache hit: a compatible analysis must return without requesting a new override snapshot. **Task 3.**

---

## File structure

- `backend/app/readings/repository.py` — extend the internal repository protocol with the revision-scoped bulk read.
- `backend/app/persistence/memory/readings.py` — implement the bulk read for unit/contract adapters.
- `backend/app/persistence/sqlite/repositories.py` — implement the equivalent single SQLite query.
- `backend/app/readings/service.py` — define the immutable resolver snapshot and resolve reads from it.
- `backend/app/analysis/service.py` — acquire one snapshot only after an analysis-cache miss and use it for all tokens.
- `backend/tests/contracts/reading_repository.py` — specify document/revision filtering of the bulk read for both adapters.
- `backend/tests/unit/analysis/test_service.py` — pin cache-hit, empty-snapshot, local, and vocabulary equivalence behavior.
- `tests/performance/test_reading_override_lookup_map.py` — own the deterministic 50,000-character RED/GREEN lookup-bound regression test and its explicit elapsed-time report.
- `docs/performance/reading-override-lookup-map.md` — record the measured focused-test duration and pre/post lookup evidence after implementation.

### Task 1: Revision-scoped override repository read

**Files:**
- Modify: `backend/app/readings/repository.py`
- Modify: `backend/app/persistence/memory/readings.py`
- Modify: `backend/app/persistence/sqlite/repositories.py`
- Modify: `backend/tests/contracts/reading_repository.py`
- Test: `backend/tests/contracts/test_memory_reading_repository.py`
- Test: `backend/tests/contracts/test_sqlite_reading_repository.py`

**Interfaces:**
- Produces: `ReadingOverrideRepository.list_for_document_revision(document_id: UUID, document_revision: int) -> tuple[ReadingOverride, ...]`.
- Consumes: existing `ReadingOverride` and `ReadingOverrideKey` immutable models.
- Preserves: `get`, `has_document`, `upsert`, `delete`, and `delete_document` for their existing callers.

- [ ] **Step 1: Write the failing repository-contract test**

```python
def test_lists_only_overrides_for_the_requested_document_and_revision(self, repository):
    current = ReadingOverrideKey(FIRST_DOCUMENT, 1, 0, 1)
    same_document_old_revision = ReadingOverrideKey(FIRST_DOCUMENT, 2, 0, 1)
    other_document = ReadingOverrideKey(SECOND_DOCUMENT, 1, 0, 1)
    # upsert all three
    assert repository.list_for_document_revision(FIRST_DOCUMENT, 1) == (
        ReadingOverride(current, "せい"),
    )
```

- [ ] **Step 2: Run the contract tests to verify RED**

Run:
```powershell
uv run pytest backend/tests/contracts/test_memory_reading_repository.py backend/tests/contracts/test_sqlite_reading_repository.py -q
```

Expected: FAIL because `list_for_document_revision` does not exist.

- [ ] **Step 3: Add `list_for_document_revision` to the protocol and both adapters**

Use a tuple ordered deterministically by stored occurrence key. The SQLite adapter must use one `SELECT` filtered by `document_id` and `document_revision`; construct `ReadingOverride` values from its rows. The memory adapter must apply the same two filters while holding its existing lock.

- [ ] **Step 4: Run the same contract tests to verify GREEN**

Run:
```powershell
uv run pytest backend/tests/contracts/test_memory_reading_repository.py backend/tests/contracts/test_sqlite_reading_repository.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit the repository slice**

```powershell
git add backend/app/readings/repository.py backend/app/persistence/memory/readings.py backend/app/persistence/sqlite/repositories.py backend/tests/contracts/reading_repository.py backend/tests/contracts/test_memory_reading_repository.py backend/tests/contracts/test_sqlite_reading_repository.py
git commit -m "feat: load reading overrides by document revision"
```

### Task 2: Add the deterministic 50k lookup-bound regression test

**Files:**
- Create: `tests/performance/test_reading_override_lookup_map.py`
- Reuse: `tests/performance/reading_override_scenarios.py`
- Reuse: `tests/fixtures/reading_override_cases.json`

**Interfaces:**
- Consumes: `ReadingOverrideRepository.list_for_document_revision(document_id, document_revision)` from Task 1.
- Produces: the executable regression proof that current per-token `get` calls are unacceptable.
- Does not change production code in this task.

- [ ] **Step 1: Write the failing 50k test and the test-local counting adapter**

Create a `CountingReadingOverrideRepository` wrapping or subclassing the in-memory adapter. Count `list_for_document_revision` as `bulk_read_calls` and `get` as `exact_key_get_calls`. Build the `medium` case from the shared manifest, persist one valid local override for the first target occurrence, force a cache miss, and assert:

```python
assert bulk_read_calls == 1
assert exact_key_get_calls == 0
assert overridden_token.reading == scenario.replacement_reading
assert overridden_token.has_reading_override is True
```

Also compare the flattened `(start_offset, end_offset, surface, reading, has_reading_override)` sequence with the expected baseline plus only that target occurrence changed. Use the real Sudachi analyzer and close it through a fixture.

- [ ] **Step 2: Measure and run the test to verify RED**

Run and retain the console elapsed time:
```powershell
Measure-Command { uv run pytest tests/performance/test_reading_override_lookup_map.py -q }
```

Expected: FAIL on `exact_key_get_calls == 0` under the current resolver. Record the isolated duration. If it exceeds two minutes, stop before implementation, select the smallest manifest case that still produces repeated target tokens and the same failing lookup assertion, then record the measured justification in the task output and update this test’s fixture choice.

- [ ] **Step 3: Commit the observed RED regression test**

```powershell
git add tests/performance/test_reading_override_lookup_map.py
git commit -m "test: expose per-token reading override lookups"
```

### Task 3: Resolve analysis tokens from one immutable snapshot

**Files:**
- Modify: `backend/app/readings/service.py`
- Modify: `backend/app/analysis/service.py`
- Modify: `backend/tests/unit/analysis/test_service.py`
- Test: `tests/performance/test_reading_override_lookup_map.py`

**Interfaces:**
- Consumes: `ReadingOverrideRepository.list_for_document_revision(document_id: UUID, document_revision: int) -> tuple[ReadingOverride, ...]`.
- Produces: `ReadingOverrideResolver.snapshot(document_id: UUID, document_revision: int) -> ReadingOverrideSnapshot` and `ReadingOverrideSnapshot.resolve(key: ReadingOverrideKey, analyzer_reading: str | None) -> ResolvedReading`.
- Preserves: `ReadingOverrideResolver.resolve` only if existing non-analysis callers require it; otherwise replace its internal use with the snapshot API without changing external HTTP behavior.

- [ ] **Step 1: Add focused failing unit tests for snapshot semantics**

Add tests that prove:

```python
# empty snapshot on cache miss
assert overrides.bulk_read_calls == 1
assert overrides.get_calls == 0
assert all(not token.has_reading_override for token in analysis_tokens)

# compatible cache hit
service.analyze(document.id)
service.analyze(document.id)
assert overrides.bulk_read_calls == 1
```

Add a persisted multi-occurrence/vocabulary-equivalent case: insert overrides for every matching occurrence, then assert each matching token has the replacement reading and override flag while unrelated tokens do not.

- [ ] **Step 2: Run the new unit and 50k tests to verify RED**

Run:
```powershell
uv run pytest backend/tests/unit/analysis/test_service.py tests/performance/test_reading_override_lookup_map.py -q
```

Expected: the snapshot/count assertions fail because analysis still calls `has_document` and `get` per token.

- [ ] **Step 3: Implement `ReadingOverrideSnapshot` and cache-miss acquisition**

In `backend/app/readings/service.py`, add an immutable snapshot object backed by a `Mapping[ReadingOverrideKey, ReadingOverride]`; construct it once from the new repository method. Its `resolve` method must return the analyzer reading/`False` for a missing key and stored reading/`True` for a matching key.

In `backend/app/analysis/service.py`, create the snapshot after `find_compatible` returns `None` and before the token loops. Use that snapshot for every token. Do not load an override snapshot on a compatible cache hit. Do not alter exception resolution, alignment, diagnostics, or cache-key construction.

- [ ] **Step 4: Run focused tests to verify GREEN**

Run:
```powershell
uv run pytest backend/tests/unit/analysis/test_service.py tests/performance/test_reading_override_lookup_map.py backend/tests/integration/test_reading_overrides_api.py -q
```

Expected: PASS; the 50k test reports one snapshot load and zero exact-key repository reads.

- [ ] **Step 5: Commit the resolver/analysis slice**

```powershell
git add backend/app/readings/service.py backend/app/analysis/service.py backend/tests/unit/analysis/test_service.py tests/performance/test_reading_override_lookup_map.py
git commit -m "perf: resolve reading overrides from analysis snapshot"
```

### Task 4: Measure the affected path and publish the evidence

**Files:**
- Create: `docs/performance/reading-override-lookup-map.md`
- Output only: `.dev/performance/reading-overrides/`

**Interfaces:**
- Consumes: the passing lookup-bound test and existing `tests/performance/benchmark_reading_overrides.py` output schema.
- Produces: a tracked summary of the test-duration gate, lookup counts, command versions, raw artifact location, and before/after comparison.

- [ ] **Step 1: Execute the focused test and record the duration gate result**

Run:
```powershell
Measure-Command { uv run pytest tests/performance/test_reading_override_lookup_map.py -q }
```

Record the exact elapsed time, fixture size, pass/fail result, snapshot count, and exact-key lookup count. If it is over two minutes, apply the Task 2 fixture decision before continuing.

- [ ] **Step 2: Run the affected benchmark or SQL trace without adding CI thresholds**

Run:
```powershell
uv run python tests/performance/benchmark_reading_overrides.py --runs 3 --sizes 50000 --output .dev/performance/reading-overrides/lookup-map-results.json
```

Retain all raw samples. Compare the affected local-one-override invalidated-analysis case and a zero-override baseline to the diagnosis; report only measured differences and environment limitations.

- [ ] **Step 3: Write `docs/performance/reading-override-lookup-map.md`**

Include commands, commit, hardware/load caveats, 50k duration-gate outcome, query counts, raw-artifact path, before/after samples, functional regression commands, and the browser/manual-evidence boundary. Do not claim browser improvement from backend-only evidence.

- [ ] **Step 4: Run the relevant automated verification suite**

Run:
```powershell
uv run pytest backend/tests tests/performance/test_reading_override_scenarios.py tests/performance/test_reading_override_lookup_map.py -q
npm --prefix frontend test -- --run src/features/reader/ReadingOverrideDialog.test.tsx
npm --prefix frontend run build
git diff --check
```

Expected: all executed tests/builds pass; report separately any environmental blocker, Docker result, userscript result, or unexecuted browser checkpoint.

- [ ] **Step 5: Commit evidence and documentation**

```powershell
git add -f docs/performance/reading-override-lookup-map.md
git commit -m "docs: record reading override lookup optimization evidence"
```

## Plan self-review

- Spec coverage: Tasks 1–3 implement the bulk snapshot and preserve behavior; Task 2 supplies RED evidence and duration gate; Task 4 records the required performance evidence and broad verification.
- Type consistency: Task 1 defines `list_for_document_revision`; Task 3 consumes exactly that signature and exposes `ReadingOverrideSnapshot`.
- Review focus coverage: empty snapshot, revision/document isolation, scope equivalence, and cache-hit behavior each have explicit owning tests.
- Proportion: tasks specify interfaces, behavioral assertions, and verification commands without transcribing production implementation.
