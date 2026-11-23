# Furigana Exclusion List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent global list that makes matching lemma-and-dictionary-reading furigana start hidden on the next reader load while preserving explicit document controls.

**Architecture:** A new `furigana_exclusions` backend feature owns the global SQLite collection and its idempotent API. The frontend loads an immutable applied snapshot plus mutable current membership, resolves visibility after explicit document preferences, and exposes add/remove without changing the open rendering.

**Tech Stack:** Python 3.12, FastAPI, Pydantic, SQLite, React, TypeScript, Vite, Vitest, Testing Library, generated OpenAPI types.

**Spec:** `docs/superpowers/specs/2026-11-23-furigana-exclusion-list-design.md`

## Global Constraints

- Start with `(lemma, dictionary_reading)`; use lemma alone only if the paired large-reader measurement is at least 100 ms faster at the median.
- The composite SQLite primary key is the required unique lookup index; do not create a duplicate index.
- Apply list changes only on the next open or reload, never to the currently rendered snapshot.
- Precedence is document `show`, document `hide`, applied global exclusion, then general `showFurigana`.
- Only lexical tokens with non-empty lemma and non-empty `dictionaryReading` are eligible.
- Keep `Document.content`, analysis, furigana segments, analysis options, and cache behavior unchanged.
- Regenerate `frontend/openapi.json` and `frontend/src/shared/api/generated.ts`; never edit them manually.
- Preserve `application/problem+json`; report automated, browser, and Docker evidence separately.
- Add no management page, bulk operations, soft delete, timestamps, audit fields, or external synchronization.

## Review Focus

- Same lemma with two readings: excluding one must not affect the other; Tasks 1, 2, and 4 pin this.
- Missing dictionary reading: no match and no menu action; Tasks 4 and 5 pin this.
- List-load failure: show retry instead of silently revealing furigana; Task 5 pins this.
- Repeated clicks and racing writes: no duplicate dispatch or stale membership corruption; Task 5 pins this.
- Routed snapshots and StrictMode races: every load fetches exclusions and older loads cannot win; Task 5 pins this.

---

### Task 1: Persist the exclusion identity and index

**Files:**
- Create: `backend/app/furigana_exclusions/__init__.py`
- Create: `backend/app/furigana_exclusions/models.py`
- Create: `backend/app/furigana_exclusions/repository.py`
- Create: `backend/app/persistence/memory/furigana_exclusions.py`
- Create: `backend/app/persistence/sqlite/migrations/005_furigana_exclusions.sql`
- Modify: `backend/app/persistence/sqlite/repositories.py`
- Create: `backend/tests/contracts/furigana_exclusion_repository.py`
- Create: `backend/tests/contracts/test_memory_furigana_exclusion_repository.py`
- Create: `backend/tests/contracts/test_sqlite_furigana_exclusion_repository.py`
- Modify: `backend/tests/integration/test_sqlite_persistence.py`

**Interfaces:**
- Produces: `FuriganaExclusion(lemma: str, dictionary_reading: str)`.
- Produces: `FuriganaExclusionRepository.list() -> tuple[FuriganaExclusion, ...]`.
- Produces: `add(exclusion: FuriganaExclusion) -> None` and `remove(exclusion: FuriganaExclusion) -> None`.
- Produces: memory and SQLite adapters with identical idempotent behavior.

- [ ] **Step 1: Write the failing shared repository contract**

Add `test_lists_in_lemma_and_dictionary_reading_order`, `test_add_is_idempotent_and_keeps_distinct_readings`, and `test_remove_is_idempotent`. Core assertions:

```python
SEI = FuriganaExclusion("生", "せい")
SHOU = FuriganaExclusion("生", "しょう")
repository.add(SEI)
repository.add(SEI)
repository.add(SHOU)
assert repository.list() == (SEI, SHOU)
repository.remove(SEI)
repository.remove(SEI)
assert repository.list() == (SHOU,)
```

- [ ] **Step 2: Write failing migration and index tests**

Expect schema versions `[1, 2, 3, 4, 5]` and table `furigana_exclusions`. Add `test_furigana_exclusion_primary_key_creates_the_expected_unique_index`, using `PRAGMA index_list` and `PRAGMA index_info` to assert one primary-key unique index ordered as `lemma`, `dictionary_reading`.

- [ ] **Step 3: Run focused tests and observe RED**

```powershell
uv run pytest backend/tests/contracts/test_memory_furigana_exclusion_repository.py backend/tests/contracts/test_sqlite_furigana_exclusion_repository.py backend/tests/integration/test_sqlite_persistence.py -q
```

Expected: FAIL because the model, adapters, migration, and version 5 do not exist.

- [ ] **Step 4: Implement the minimum persistence slice**

Use a frozen dataclass, the protocol above, `INSERT OR IGNORE`, exact two-column `DELETE`, and `ORDER BY lemma, dictionary_reading`. Migration 005 creates both non-null columns with `PRIMARY KEY (lemma, dictionary_reading)` and no second index.

- [ ] **Step 5: Rerun Step 3 and verify GREEN**

Expected: all selected tests PASS, including index metadata.

- [ ] **Step 6: Commit**

```powershell
git add backend/app/furigana_exclusions backend/app/persistence/memory/furigana_exclusions.py backend/app/persistence/sqlite/migrations/005_furigana_exclusions.sql backend/app/persistence/sqlite/repositories.py backend/tests/contracts/furigana_exclusion_repository.py backend/tests/contracts/test_memory_furigana_exclusion_repository.py backend/tests/contracts/test_sqlite_furigana_exclusion_repository.py backend/tests/integration/test_sqlite_persistence.py
git commit -m "feat: persist furigana exclusions"
```

### Task 2: Expose service and idempotent HTTP operations

**Files:**
- Create: `backend/app/furigana_exclusions/service.py`
- Create: `backend/app/furigana_exclusions/api.py`
- Modify: `backend/app/furigana_exclusions/__init__.py`
- Modify: `backend/app/api/errors.py`
- Modify: `backend/app/api/router.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/unit/furigana_exclusions/test_service.py`
- Create: `backend/tests/integration/test_furigana_exclusions_api.py`

**Interfaces:**
- Consumes: Task 1 repository.
- Produces: `InvalidFuriganaExclusionError(ValueError)`.
- Produces: `FuriganaExclusionService.list()`, `add(lemma, dictionary_reading) -> None`, and `remove(lemma, dictionary_reading) -> None`.
- Produces: `GET`, `PUT`, and `DELETE /api/furigana-exclusions`, using `lemma` and `dictionaryReading`.

- [ ] **Step 1: Write failing service tests**

Test ordered delegation, idempotent mutations, and whitespace rejection:

```python
with pytest.raises(InvalidFuriganaExclusionError):
    service.add(" ", "せい")
with pytest.raises(InvalidFuriganaExclusionError):
    service.add("生", " ")
```

- [ ] **Step 2: Write failing API tests**

Cover empty `GET`, two readings of `生`, repeated `PUT`, repeated `DELETE`, Japanese preservation, `204` mutations, `422 application/problem+json` for blank fields, `503` for SQLite failure, and operation IDs `listFuriganaExclusions`, `addFuriganaExclusion`, `removeFuriganaExclusion`.

- [ ] **Step 3: Run focused tests and observe RED**

```powershell
uv run pytest backend/tests/unit/furigana_exclusions/test_service.py backend/tests/integration/test_furigana_exclusions_api.py -q
```

Expected: FAIL because service, routes, state wiring, and error mapping are absent.

- [ ] **Step 4: Implement service, API, and composition**

Use one `FuriganaExclusionModel` with camel-case aliases and `extra="forbid"`. `GET` returns a list; `PUT` and `DELETE` accept the model body and return `204`. Map the domain validation error to the existing 422 problem handler, instantiate the SQLite repository/service in `create_app`, clean service state in lifespan, and include the router.

- [ ] **Step 5: Rerun Step 3 and verify GREEN**

- [ ] **Step 6: Commit**

```powershell
git add backend/app/furigana_exclusions backend/app/api/errors.py backend/app/api/router.py backend/app/main.py backend/tests/unit/furigana_exclusions/test_service.py backend/tests/integration/test_furigana_exclusions_api.py
git commit -m "feat: expose furigana exclusion api"
```

### Task 3: Regenerate and consume the typed contract

**Files:**
- Modify by generator: `frontend/openapi.json`
- Modify by generator: `frontend/src/shared/api/generated.ts`
- Modify: `frontend/src/shared/api/client.ts`
- Modify: `frontend/src/shared/api/client.test.ts`

**Interfaces:**
- Consumes: Task 2 OpenAPI.
- Produces: `FuriganaExclusion = components['schemas']['FuriganaExclusionModel']`.
- Produces: `listFuriganaExclusions()`, `addFuriganaExclusion(exclusion)`, and `removeFuriganaExclusion(exclusion)`.

- [ ] **Step 1: Regenerate artifacts**

```powershell
npm.cmd run api:generate
```

Expected: generated schema and TypeScript contain all three operation IDs.

- [ ] **Step 2: Write the failing client transport test**

With `{ lemma: '生', dictionaryReading: 'せい' }`, expect `GET`, `PUT`, and `DELETE` at `/api/furigana-exclusions`, exact JSON bodies for mutations, and `undefined` from both `204` responses.

- [ ] **Step 3: Run the client test and observe RED**

```powershell
npm.cmd --prefix frontend test -- --run src/shared/api/client.test.ts
```

- [ ] **Step 4: Implement the generated alias and client methods**

Add the methods to `OptionalClientMethods` so unrelated page-test fixtures remain source-compatible; `ReaderPage` must explicitly reject an unavailable list method.

- [ ] **Step 5: Verify client and generator stability**

```powershell
npm.cmd --prefix frontend test -- --run src/shared/api/client.test.ts
$before = Get-FileHash frontend/openapi.json,frontend/src/shared/api/generated.ts
npm.cmd run api:generate
$after = Get-FileHash frontend/openapi.json,frontend/src/shared/api/generated.ts
if (Compare-Object $before.Hash $after.Hash) { throw 'OpenAPI generation is not stable' }
```

Expected: test PASS and second generation adds no diff.

- [ ] **Step 6: Commit generated files and client together**

```powershell
git add frontend/openapi.json frontend/src/shared/api/generated.ts frontend/src/shared/api/client.ts frontend/src/shared/api/client.test.ts
git commit -m "feat: add furigana exclusion client"
```

### Task 4: Resolve exclusion visibility without changing analysis

**Files:**
- Create: `frontend/src/features/reader/furiganaExclusions.ts`
- Create: `frontend/src/features/reader/furiganaExclusions.test.ts`
- Modify: `frontend/src/features/reader/preferences.ts`
- Modify: `frontend/src/features/reader/preferences.test.ts`
- Modify: `frontend/src/features/reader/DocumentText.tsx`
- Modify: `frontend/src/features/reader/DocumentText.test.tsx`
- Modify: `frontend/src/features/reader/Token.tsx`
- Modify: `frontend/src/features/reader/Token.test.tsx`

**Interfaces:**
- Consumes: Task 3 `FuriganaExclusion`.
- Produces: `furiganaExclusionFromToken(token: AnalyzedToken) -> FuriganaExclusion | null`.
- Produces: `encodeFuriganaExclusion(exclusion) -> string` as compact JSON `[lemma,dictionaryReading]`.
- Changes: `resolveFuriganaVisibility(visibility, showFurigana, excludedByDefault = false) -> boolean`.
- Produces: `DocumentText` props `appliedFuriganaExclusionKeys`, `currentFuriganaExclusionKeys`, and `pendingFuriganaExclusionKeys`, each `ReadonlySet<string>`.
- Produces: `DocumentText`/`Token` callback `onSetFuriganaExcluded(exclusion: FuriganaExclusion, excluded: boolean) -> Promise<void>`.

- [ ] **Step 1: Write failing identity and eligibility tests**

Assert `生/せい` and `生/しょう` encode differently. Non-lexical, blank-lemma, null-reading, and blank-reading tokens return `null`.

- [ ] **Step 2: Write failing precedence tests**

```typescript
expect(resolveFuriganaVisibility('show', false, true)).toBe(true);
expect(resolveFuriganaVisibility('hide', true, false)).toBe(false);
expect(resolveFuriganaVisibility('inherit', true, true)).toBe(false);
expect(resolveFuriganaVisibility('inherit', true, false)).toBe(true);
expect(resolveFuriganaVisibility('inherit', false, false)).toBe(false);
```

In `DocumentText.test.tsx`, an applied `生/せい` exclusion hides both matching occurrences, leaves `生/しょう` visible, and explicit document `show` reveals the excluded reading. In `Token.test.tsx`, a token without dictionary reading receives no exclusion action.

- [ ] **Step 3: Run focused tests and observe RED**

```powershell
npm.cmd --prefix frontend test -- --run src/features/reader/furiganaExclusions.test.ts src/features/reader/preferences.test.ts src/features/reader/DocumentText.test.tsx src/features/reader/Token.test.tsx
```

- [ ] **Step 4: Implement minimal identity and visibility plumbing**

Derive the key only from lemma and `dictionaryReading`. Use applied membership only for visibility and current/pending membership only for the menu. Do not mutate analysis DTOs, segments, or vocabulary keys.

- [ ] **Step 5: Rerun Step 3 and verify GREEN**

- [ ] **Step 6: Commit**

```powershell
git add frontend/src/features/reader/furiganaExclusions.ts frontend/src/features/reader/furiganaExclusions.test.ts frontend/src/features/reader/preferences.ts frontend/src/features/reader/preferences.test.ts frontend/src/features/reader/DocumentText.tsx frontend/src/features/reader/DocumentText.test.tsx frontend/src/features/reader/Token.tsx frontend/src/features/reader/Token.test.tsx
git commit -m "feat: resolve default furigana exclusions"
```

### Task 5: Load, mutate, and present the list in ReaderPage

**Files:**
- Modify: `frontend/src/features/reader/TokenContextMenu.tsx`
- Modify: `frontend/src/features/reader/Token.test.tsx`
- Modify: `frontend/src/features/reader/ReaderPage.tsx`
- Modify: `frontend/src/app/App.test.tsx`
- Modify: `frontend/src/features/reader/reading-override.performance.test.tsx`

**Interfaces:**
- Consumes: Tasks 3 and 4.
- Produces menu props: `furiganaExcluded`, `furiganaExclusionPending`, `onSetFuriganaExcluded(excluded: boolean)`.
- Produces ReaderPage applied, current, and pending exclusion-key sets.

- [ ] **Step 1: Write failing menu tests**

Assert “Adicionar leitura à lista de exclusão” when absent, “Remover leitura da lista de exclusão” when present, disabled action while pending, correct boolean callback, no vocabulary toggle, and no action without dictionary reading.

- [ ] **Step 2: Write failing load and snapshot tests**

Update the App test client factory. Prove initial exclusion hides; explicit `show` wins; successful add/remove changes the next menu action but not current `<rt>` visibility; reopening or retry applies the persisted current list.

- [ ] **Step 3: Write failing error and race tests**

Prove list rejection renders “Não foi possível preparar a leitura.” and retry succeeds; mutation rejection renders “Não foi possível atualizar a lista de exclusão de furigana.”; one pending key cannot dispatch twice; a routed snapshot still lists exclusions; an older deferred list result cannot overwrite a newer load.

- [ ] **Step 4: Run focused tests and observe RED**

```powershell
npm.cmd --prefix frontend test -- --run src/features/reader/Token.test.tsx src/app/App.test.tsx
```

- [ ] **Step 5: Implement snapshot and mutation state**

Load exclusions in the existing `Promise.all`; fail if the optional list method is unavailable. Successful load replaces both applied and current sets. Mutations add pending, call the matching client method, update only current membership on success, preserve applied visibility, clear pending in `finally`, and publish the approved alert on failure. Retain `requestGeneration` stale-result protection.

- [ ] **Step 6: Keep explicit performance clients compiling**

Add resolved exclusion mocks to the `DocumentClient` fixture in `reading-override.performance.test.tsx` without changing its measurements.

- [ ] **Step 7: Verify focused interactions**

```powershell
npm.cmd --prefix frontend test -- --run src/features/reader/Token.test.tsx src/app/App.test.tsx src/features/reader/reading-override.performance.test.tsx
```

Expected: all selected tests PASS.

- [ ] **Step 8: Commit**

```powershell
git add frontend/src/features/reader/TokenContextMenu.tsx frontend/src/features/reader/Token.test.tsx frontend/src/features/reader/ReaderPage.tsx frontend/src/app/App.test.tsx frontend/src/features/reader/reading-override.performance.test.tsx
git commit -m "feat: manage furigana exclusions from reader"
```

### Task 6: Run the performance gate and complete verification

**Files:**
- Modify: `frontend/src/features/reader/reader.performance.test.tsx`
- Create: `docs/performance/furigana-exclusion-identity.md`
- Conditional if lemma-only wins: coherently modify all feature files and both design documents before final verification.

**Interfaces:**
- Consumes: Task 4 encoders and `DocumentText`.
- Produces: paired raw samples, medians, delta, environment, and final identity decision.

- [ ] **Step 1: Add paired measurement without a CI time assertion**

Reuse the deterministic corpus and every size completing inside the existing timeout. Warm both strategies, collect at least five interleaved samples, and time key construction, set lookup, visibility-input creation, and `DocumentText` render/unmount. Print one `FURIGANA_EXCLUSION_IDENTITY_PERFORMANCE` JSON record.

- [ ] **Step 2: Run the isolated measurement**

```powershell
npm.cmd --prefix frontend test -- --run src/features/reader/reader.performance.test.tsx
```

Expected: PASS with parseable raw samples and medians.

- [ ] **Step 3: Apply the 100 ms rule**

Keep the composite identity when `combinedMedianMs - lemmaMedianMs < 100`. If the delta is at least 100, convert schema, models, API, client, helpers, tests, spec, and plan to lemma-only, then rerun all focused commands from Tasks 1–5. Never retain mixed identities.

- [ ] **Step 4: Record evidence**

Write `docs/performance/furigana-exclusion-identity.md` with date, command, corpus sizes, run count, raw samples, medians, delta, selected identity, and the limitation that jsdom timing is not browser evidence.

- [ ] **Step 5: Run complete verification**

```powershell
uv run pytest -q
npm.cmd --prefix frontend test -- --run
npm.cmd --prefix frontend run build
$before = Get-FileHash frontend/openapi.json,frontend/src/shared/api/generated.ts
npm.cmd run api:generate
$after = Get-FileHash frontend/openapi.json,frontend/src/shared/api/generated.ts
if (Compare-Object $before.Hash $after.Hash) { throw 'OpenAPI generation is not stable' }
git diff --check
git status --short
```

Expected: backend and frontend PASS; build succeeds; generation is stable; diff check is empty; only intended files remain.

- [ ] **Step 6: Review acceptance boundaries**

Confirm the open rendering stays unchanged after mutation, reload applies persisted state, explicit document preferences win, the chosen identity is consistent, the primary-key index is verified, and analysis/cache code is untouched. Report browser, Docker, and real-runtime validation separately rather than inferring them.

- [ ] **Step 7: Commit measurement and any coherent reconciliation**

```powershell
git add frontend/src/features/reader/reader.performance.test.tsx docs/performance/furigana-exclusion-identity.md
git commit -m "test: compare furigana exclusion identities"
```

If lemma-only was selected, stage every coherently updated feature and design file in this same commit. If final verification required another in-scope fix, commit that correction separately.
