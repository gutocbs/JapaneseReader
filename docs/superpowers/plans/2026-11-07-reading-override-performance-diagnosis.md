# Reading-Override Performance Diagnosis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a reproducible, evidence-ranked diagnosis of the latency seen when changing or removing furigana in an already-open reader, without implementing an optimization.

**Architecture:** Build deterministic shared scenarios, measure the real backend API and frontend update path separately, then deepen profiling only in the stage that dominates end-to-end latency. Store raw data under ignored `.dev/performance`, publish a tracked diagnostic report with a third-stage handoff, and repair the broken architectural links in the README.

**Tech Stack:** Python 3.12, FastAPI TestClient, SQLite trace/profile facilities, pytest, React 19, React Profiler, TypeScript, Vitest/jsdom, PowerShell.

**Spec:** `docs/superpowers/specs/2026-11-07-reading-override-performance-diagnosis-design.md`

## Global Constraints

- This plan ends at diagnosis and recommendation; do not implement a product optimization.
- Target set, replace and delete for local and vocabulary-wide reading overrides while the document is open.
- Measure backend and frontend separately before attributing latency.
- Use deterministic fixtures for 10,000, 50,000 and 100,000 Unicode code points and at least three samples per timed scenario.
- Cover cold/warm analysis and zero, typical and high volumes of active exceptions and existing overrides.
- Keep raw JSON, profiles and traces under `.dev/performance/reading-overrides/`; keep them untracked.
- Do not add timing thresholds to CI.
- Do not add a dependency until existing tools have been shown insufficient and the need is documented.
- Preserve canonical content, revision/cache identity, offsets, surfaces, vocabulary keys, local/global scope and affected counts.
- Preserve native text selection/copy and semantic `ruby`/`rt` behavior.
- Any temporary production instrumentation must be removed before completion.
- Browser/jsdom evidence must remain explicitly separated.
- The third implementation stage requires new human approval, specification and plan.

## Review Focus

- A single existing override may switch analysis from the no-override fast path to per-token lookups: query growth must be measured, not inferred; pinned in Task 2.
- Global scope with many repeated tokens may spend time in response generation or React reconciliation rather than SQLite: local/global stages must remain separate; pinned in Tasks 2 and 3.
- A warm cache after changing an override may not be semantically reusable: record invalidation and analysis counts before labeling misses wasteful; pinned in Task 2.
- A jsdom slowdown may not reproduce in a real browser: require an integrated local checkpoint or an explicit limitation; pinned in Task 4.
- Exception volumes may affect snapshot sorting/hash while unrelated lemmas do not affect token resolution: measure 0, 100 and 1,000 active entries without calling the result a bottleneck in advance; pinned in Task 2.

---

### Task 1: Create deterministic shared reading-override scenarios

**Files:**
- Create: `tests/fixtures/reading_override_cases.json`
- Create: `tests/performance/reading_override_scenarios.py`
- Create: `tests/performance/test_reading_override_scenarios.py`

**Interfaces:**
- Consumes: Unicode hashing and corpus conventions from `tests/performance/generate_documents.py` and `tests/fixtures/japanese_cases.json`.
- Produces: `ReadingOverrideScenario`, `load_manifest()`, `build_content(case) -> str`, `content_sha256(content) -> str`, and `count_target_occurrences(content, target) -> int` for backend and frontend benchmark parity.

- [ ] **Step 1: Write the scenario-contract tests**

Define tests with these names and assertions:

- `test_manifest_defines_small_medium_and_large_cases`: sizes are exactly 10,000, 50,000 and 100,000 code points;
- `test_generated_content_matches_manifest_hashes`: every generated UTF-8 SHA-256 equals the tracked manifest;
- `test_each_case_contains_repeated_target_occurrences`: target is `昨日`, reading is `きのう`, replacement is `さくじつ`, and expected occurrence count matches generation;
- `test_generation_is_code_point_exact_with_non_bmp_text`: `len(content)` equals the requested Python code-point count and the seed includes supplementary Japanese and emoji.

- [ ] **Step 2: Run the scenario tests and verify missing interfaces fail**

Run: `uv run pytest -q tests/performance/test_reading_override_scenarios.py`

Expected: FAIL because the fixture and scenario module do not exist.

- [ ] **Step 3: Add the compact shared manifest**

Create `tests/fixtures/reading_override_cases.json` with:

- one fixed Japanese seed paragraph containing repeated `昨日`, supplementary Japanese, emoji, punctuation and newline;
- target surface `昨日`;
- dictionary reading `きのう`;
- replacement reading `さくじつ`;
- cases named `small`, `medium`, `large` at 10k/50k/100k;
- expected UTF-8 SHA-256 and target occurrence count for each case.

Track only seed and metadata, not expanded documents.

- [ ] **Step 4: Implement the Python scenario loader and generator**

Use immutable dataclasses and `pathlib.Path`. Repeat the seed and truncate by Python Unicode code points. Validate the manifest's size, hash and occurrence count when building a scenario; raise `ValueError` with the case name on mismatch.

- [ ] **Step 5: Run the scenario tests**

Run: `uv run pytest -q tests/performance/test_reading_override_scenarios.py`

Expected: PASS with deterministic hashes and counts.

- [ ] **Step 6: Commit the shared scenarios**

```powershell
git add tests/fixtures/reading_override_cases.json tests/performance/reading_override_scenarios.py tests/performance/test_reading_override_scenarios.py
git commit -m "test: add reading override performance scenarios"
```

---

### Task 2: Measure and decompose the backend override path

**Files:**
- Create: `tests/performance/benchmark_reading_overrides.py`
- Create: `tests/performance/test_benchmark_reading_overrides.py`
- Reuse: `tests/performance/reading_override_scenarios.py`
- Reuse: `backend/app/main.py`
- Reuse: `backend/app/readings/service.py`
- Reuse: `backend/app/persistence/sqlite/repositories.py`

**Interfaces:**
- Consumes: Task 1's `load_manifest()` and `build_content(case)`.
- Produces: `TimingSample`, `StageRecorder`, `run_scenario(...) -> dict`, `summarize_samples(samples) -> dict`, `validate_operation(...) -> None`, and a CLI writing versioned JSON results.

- [ ] **Step 1: Write tests for result shape and semantic validation**

Add tests that assert:

- fewer than three runs is rejected;
- summaries retain every sample and compute the median;
- result metadata includes commit, Python version, dependency versions, case hash, scope, operation, cache temperature, exception volume and override volume;
- local set/replace/delete validates exactly one occurrence;
- vocabulary set/replace/delete validates the reported affected count and all matching tokens;
- a mismatched revision, surface, reading or affected count raises `AssertionError` before timing is accepted.

- [ ] **Step 2: Write a query-classification test for the suspected fast-path transition**

Using an in-memory real application, trace SQL for one warm analysis with zero overrides and one warm analysis after inserting a single valid local override. Assert the result records separate counts for:

```text
reading_overrides existence checks
reading_overrides exact-key lookups
analysis cache reads/writes
reading exception snapshot reads
```

Do not assert which count is faster or label growth a defect; assert only that the classifier counts the statements deterministically.

- [ ] **Step 3: Run the benchmark unit tests and verify they fail**

Run: `uv run pytest -q tests/performance/test_benchmark_reading_overrides.py`

Expected: FAIL because the benchmark interfaces are missing.

- [ ] **Step 4: Implement the timing and SQL recorders outside production code**

`StageRecorder` must use `time.perf_counter_ns()` and store named, nested durations. Wrap the real service/repository methods in the benchmark process and restore them after each sample. Record inclusive spans and derive exclusive parent time by subtracting each direct child once; do not add overlapping spans as if they were independent. Use SQLite trace callbacks to classify statements without logging bound values. Required stages:

```text
http_total
override_service
analysis
override_repository
analysis_repository
response_and_framework_residual
```

Calculate `response_and_framework_residual` as `http_total - override_service`; never subtract the nested analysis/repository spans from the HTTP total a second time. Treat the residual only as a diagnostic bucket, never as pure JSON serialization without deeper proof.

- [ ] **Step 5: Implement real API scenario setup and operations**

For each isolated SQLite database:

1. create the document through the public API;
2. obtain the target token and revision from public analysis;
3. seed active reading exceptions at volumes 0, 100 and 1,000, accounting explicitly for the migration's seeded row;
4. seed existing valid overrides at volumes 0, 100 and 1,000 only when the document has enough token occurrences;
5. execute local or vocabulary `PUT`/`DELETE` through `/api/documents/{id}/reading-overrides`;
6. validate the response and post-operation analysis before accepting the sample.

Use fresh state for destructive operations; do not let one timed sample mutate the next sample's preconditions.

- [ ] **Step 6: Implement the CLI and JSON schema**

Support:

```powershell
uv run python tests/performance/benchmark_reading_overrides.py --runs 3 --sizes 10000,50000,100000 --output .dev/performance/reading-overrides/backend-results.json
```

Reject fewer than three runs. Write JSON only after all validations pass. Include raw nanosecond samples and rounded millisecond medians; never discard outliers silently.

- [ ] **Step 7: Run benchmark tests and a small smoke measurement**

Run:

```powershell
uv run pytest -q tests/performance/test_benchmark_reading_overrides.py
uv run python tests/performance/benchmark_reading_overrides.py --runs 3 --sizes 10000 --output .dev/performance/reading-overrides/backend-smoke.json
```

Expected: tests PASS; smoke JSON exists, validates all operations and contains classified query counts without bound values.

- [ ] **Step 8: Commit the backend diagnostic harness**

```powershell
git add tests/performance/benchmark_reading_overrides.py tests/performance/test_benchmark_reading_overrides.py
git commit -m "test: measure reading override backend latency"
```

---

### Task 3: Measure frontend submission and reconciliation separately

**Files:**
- Create: `frontend/src/features/reader/reading-override.performance.test.tsx`
- Reuse: `tests/fixtures/reading_override_cases.json`
- Reuse: `frontend/src/features/reader/ReaderPage.tsx`
- Reuse: `frontend/src/features/reader/ReadingOverrideDialog.tsx`
- Reuse: `frontend/src/features/reader/DocumentText.tsx`

**Interfaces:**
- Consumes: Task 1 manifest, existing `DocumentClient`, `ReaderPage` and React `Profiler`.
- Produces: deterministic `READING_OVERRIDE_PERFORMANCE` JSON on stdout with raw samples, medians, React commit durations, rendered-token counts, scope and operation.

- [ ] **Step 1: Add deterministic frontend fixture tests**

Import the shared JSON manifest. Generate the same code-point content in TypeScript with `Array.from()` so supplementary characters count as one Unicode code point, then assert SHA-256, size and target occurrence count for 10k/50k/100k before rendering.

- [ ] **Step 2: Add local and global correctness scenarios around the real reader UI**

For set, replace and delete:

- open the real reading-override dialog from a target token;
- submit local and vocabulary scope through a mocked `DocumentClient`;
- return a deterministic updated analysis;
- assert pending state, call payload, affected count, dialog completion and exact tokens whose reading changes;
- assert canonical rendered text remains identical after removing `rt` nodes.

- [ ] **Step 3: Add measurements without pass/fail timing thresholds**

For at least three runs per size and scope, record:

```text
submit_to_client_call_ms
client_resolution_to_visible_update_ms
submit_to_visible_update_ms
React Profiler commit durations
rendered token count
changed token count
```

Use an immediately resolved client for frontend cost. Do not simulate backend time in these medians. Print one `READING_OVERRIDE_PERFORMANCE` JSON line after all correctness assertions pass.

- [ ] **Step 4: Run the focused test and verify any missing behavior fails**

Run:

```powershell
npm --prefix frontend test -- --run src/features/reader/reading-override.performance.test.tsx
```

Expected before completion: FAIL until the harness supplies all required client responses and assertions. Do not change production behavior to make the benchmark easier.

- [ ] **Step 5: Complete the harness and run it in isolation**

Run the same command.

Expected: PASS; one parseable performance line includes all sizes, scopes, operations, raw samples and medians.

- [ ] **Step 6: Run the existing reader interaction suites**

Run:

```powershell
npm --prefix frontend test -- --run src/features/reader/ReadingOverrideDialog.test.tsx src/features/reader/reader.interactions.performance.test.tsx src/features/reader/reader.performance.test.tsx
```

Expected: PASS; existing semantic and performance-reporting guarantees remain intact.

- [ ] **Step 7: Commit the frontend diagnostic harness**

```powershell
git add frontend/src/features/reader/reading-override.performance.test.tsx
git commit -m "test: measure reading override UI latency"
```

---

### Task 4: Execute the measurement funnel and deepen only the dominant stage

**Files:**
- Create ignored outputs: `.dev/performance/reading-overrides/backend-results.json`
- Create ignored outputs: `.dev/performance/reading-overrides/frontend-results.txt`
- Create ignored outputs conditionally: `.dev/performance/reading-overrides/profiles/*`
- Do not retain production-code instrumentation.

**Interfaces:**
- Consumes: Task 2 CLI and Task 3 Vitest performance line.
- Produces: validated raw evidence and a written classification of confirmed, rejected and uncertain hypotheses for Task 5.

- [ ] **Step 1: Record a quiet baseline environment**

Record commit, branch, dirty state, OS, CPU, visible memory, Python, Node, uv, npm and locked dependency versions. Confirm no unrelated benchmark or build process is consuming significant CPU. Do not close user applications without explicit approval.

- [ ] **Step 2: Run the full backend matrix**

Run:

```powershell
uv run python tests/performance/benchmark_reading_overrides.py --runs 3 --sizes 10000,50000,100000 --output .dev/performance/reading-overrides/backend-results.json
```

Expected: exit 0 with all semantic validations passing. Preserve every sample and query count.

- [ ] **Step 3: Run the frontend benchmark in isolation**

Run:

```powershell
npm --prefix frontend test -- --run src/features/reader/reading-override.performance.test.tsx | Tee-Object .dev/performance/reading-overrides/frontend-results.txt
```

Expected: PASS and exactly one parseable performance JSON line.

- [ ] **Step 4: Compare stage shares before profiling**

For each size/scope/operation, calculate the median share of total backend and frontend latency. Mark a stage as a candidate only when it dominates consistently or explains most variation. Record local/global and cold/warm results separately.

- [ ] **Step 5: Apply the matching focused profiler**

Choose only the branch supported by Step 4:

- SQLite/override lookup dominates: run a 50k representative case under SQL trace and `cProfile`; report exact-key lookup growth versus token count.
- analysis/cache dominates: profile `AnalysisService.analyze`, resolver calls, cache hits/misses and invalidation counts.
- response/framework residual dominates: measure encoded response bytes and profile response-model conversion/JSON separately before naming serialization.
- frontend reconciliation dominates: use React Profiler commits and rendered/changed token counts to locate the component subtree.
- no stage dominates: repeat the noisiest representative scenario under quieter conditions; if still diffuse, declare the result inconclusive.

Store profiles below the ignored profile directory. Do not modify product behavior.

- [ ] **Step 6: Obtain one integrated local checkpoint**

Start the app with a disposable database under `.dev/performance/reading-overrides/`, load the deterministic medium document, and exercise local and global set/delete in a real available browser while recording network duration and visible-update duration.

If browser automation or a compatible browser is unavailable, stop this step, record it as not executed and request a manual user checkpoint. Do not substitute jsdom evidence.

- [ ] **Step 7: Remove temporary instrumentation and confirm behavior**

If any temporary production probe was unavoidable, remove it. Run focused backend and frontend correctness tests and inspect `git diff` to prove only durable benchmark harness changes remain.

---

### Task 5: Publish the diagnosis, third-stage handoff and documentation repair

**Files:**
- Create: `docs/performance/reading-override-latency.md`
- Modify: `README.md:100-103`
- Consume ignored: `.dev/performance/reading-overrides/*`

**Interfaces:**
- Consumes: Task 4's validated measurements and classifications.
- Produces: auditable diagnosis and ranked candidates; no optimization implementation.

- [ ] **Step 1: Write the report environment and method**

Document exact commit, tools, fixtures, run count, machine conditions, backend/frontend separation and any missing integrated-browser evidence. Link the shared manifest and benchmark commands.

- [ ] **Step 2: Add complete results and stage decomposition**

Include tables for every executed size, scope, operation, cache temperature, exception volume and override volume. Show medians and every raw sample directly in the tracked report; ignored raw files remain the machine-readable source. Separate backend HTTP, internal stages, frontend reconciliation and real-browser checkpoint.

- [ ] **Step 3: Classify hypotheses**

Use three sections: confirmed bottlenecks, rejected hypotheses and unresolved questions. For each confirmed item state evidence, share of total latency, scaling behavior and maximum theoretical gain. Do not convert correlation into causation.

- [ ] **Step 4: Write the third-stage handoff**

For every candidate include:

1. evidence;
2. maximum theoretical gain;
3. preserved behavior/contracts;
4. regression risk;
5. the test that must fail before implementation;
6. measurable success criterion;
7. rollback criterion.

Recommend one first candidate only if evidence satisfies the spec. End with an explicit gate requiring a new optimization spec and plan.

- [ ] **Step 5: Repair README architecture links without rewriting history**

Replace links to the absent 2026-09-26 design and MVP plan. Link `AGENTS.md` as the current tracked architectural overview and link the existing reading-feature specifications directory or specific tracked designs as historical feature detail. Do not claim they are the original MVP plan.

- [ ] **Step 6: Check all tracked Markdown links**

Run a local link scan over tracked `*.md` files. Resolve links relative to each document.

Expected: no missing local link targets. Ignore external reachability unless network verification is explicitly authorized.

- [ ] **Step 7: Commit the diagnosis and documentation repair**

```powershell
git add docs/performance/reading-override-latency.md README.md
git commit -m "docs: diagnose reading override latency"
```

Do not add `.dev/performance` outputs.

---

### Task 6: Run final diagnostic-work gates and stop before optimization

**Files:**
- Verify only: benchmark harnesses, report and README from Tasks 1-5
- Verify only: all production source files remain behaviorally unchanged by this plan

**Interfaces:**
- Consumes: all diagnostic deliverables.
- Produces: final evidence and a clean handoff; no optimization commit.

- [ ] **Step 1: Run diagnostic harness tests**

Run:

```powershell
uv run pytest -q tests/performance/test_reading_override_scenarios.py tests/performance/test_benchmark_reading_overrides.py
npm --prefix frontend test -- --run src/features/reader/reading-override.performance.test.tsx
```

Expected: PASS with no timing thresholds.

- [ ] **Step 2: Run complete backend, frontend and userscript suites**

Run:

```powershell
uv run pytest
npm --prefix frontend test -- --run
node .\frontend\node_modules\vitest\vitest.mjs run userscript\note-import --reporter=dot
node --check userscript/note-import/note-import.user.js
```

Expected: all correctness suites pass; skips and environment limitations are reported explicitly.

- [ ] **Step 3: Run build and configuration gates**

Run:

```powershell
npm run build
docker compose config --quiet
git diff --check
```

Expected: all commands exit 0, aside from separately classified environmental warnings.

- [ ] **Step 4: Prove no optimization or temporary production probe remains**

Inspect the diff since the plan's starting commit. Expected durable changes are limited to:

- deterministic fixture metadata;
- Python benchmark/test modules;
- frontend performance test;
- tracked performance report;
- README link repair.

Any production source change must be removed or explicitly explained as pre-existing. Raw `.dev/performance` files remain ignored.

- [ ] **Step 5: Present the third-stage gate**

Report the ranked diagnosis and ask for explicit authorization to brainstorm the first optimization candidate. Do not invoke an implementation skill or change product behavior in this task.
