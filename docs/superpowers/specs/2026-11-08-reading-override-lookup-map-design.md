# Reading override lookup-map optimization

## Objective

Reduce the backend latency of a cache-miss analysis after a reading override
changes. The optimization must remove the current pattern of performing one
SQLite exact-key lookup for each resolved token while preserving all observable
reading-override behavior.

This is the first implementation stage. A client-side immediate-update UX is
explicitly deferred to a later, separate stage.

## Evidence and problem statement

The live request logs show that persisting a reading override is comparatively
fast (`125–229 ms` for the observed `PUT` requests), while the immediately
following `POST /analysis` took `2.2–3.1 s`. The mutation invalidates the
derived analysis cache, and the reader then requests a new analysis.

The measured focused 50,000-code-point trace in
`docs/performance/reading-override-latency.md` found one override causing
32,144 `ReadingOverrideRepository.get` calls during one invalidated analysis.
The resolver and repository calls accounted for substantial cumulative time.
The lookup count scales with resolved tokens, not with stored overrides.

## Scope

Included:

- load all reading overrides for one document revision in one repository read;
- resolve both local and vocabulary-wide overrides from that in-memory snapshot;
- preserve cache invalidation after successful override mutation;
- add deterministic correctness and query-bound regression tests;
- record the isolated 50,000-character test duration before retaining that size
  as a normal focused test.

Excluded:

- changes to HTTP routes, OpenAPI, response DTOs, SQLite schema, or migrations;
- asynchronous or optimistic reader updates;
- process-wide override caches;
- changes to document content, analyzer configuration, exception handling, or
  cache-key identity;
- browser UX or rendering optimization.

## Chosen design

### Repository snapshot

`ReadingOverrideRepository` gains an internal bulk-read operation for a
specific `(document_id, document_revision)`. The SQLite adapter implements it
with one query returning every matching persisted override. The result retains
the existing `ReadingOverride` model and is converted into an immutable map
keyed by `ReadingOverrideKey`.

The map is scoped to one cache-miss analysis only. It is not retained in the
application process and is discarded once the analysis returns.

### Resolution flow

On a cache miss, `AnalysisService` obtains a snapshot through
`ReadingOverrideResolver` before token resolution begins. For each token, the
resolver reads the matching key from the snapshot map:

- no key: return the analyzer reading with `has_reading_override = false`;
- matching key: return the stored reading with `has_reading_override = true`.

Vocabulary-wide operations already persist one override per affected token.
Consequently, vocabulary and local operations use the same snapshot and the
same exact `(start_offset, end_offset)` key lookup during analysis. No
vocabulary-key expansion is introduced into the analysis path.

### Cache and consistency behavior

`Document.content` remains canonical. Analysis remains derived cache data.
Existing mutation behavior continues to invalidate all analyses for the
affected document after successful writes or deletes. The snapshot does not
alter analysis cache identity: document revision, content hash,
analyzer/dictionary metadata, analysis options, and reading-exception version
remain part of compatibility exactly as they are today.

The change preserves the current mutation/analysis concurrency semantics; it
does not introduce a new cache epoch or process cache. A future concurrency
guarantee would be a separate design because it changes cache consistency
boundaries rather than the measured lookup mechanism.

## Error handling and compatibility

The bulk operation is internal. Repository failures propagate through the
existing analysis error path. No `application/problem+json` contract changes.

The following behavior must remain identical before and after the change:

- local scope changes only the selected occurrence;
- vocabulary scope changes precisely the matching analyzed occurrences;
- affected counts, offsets, surfaces, readings, dictionary readings, and
  vocabulary keys remain correct;
- `hasReadingOverride`, furigana segments, diagnostics, cache invalidation,
  and stale-revision behavior remain correct;
- native text selection/copy and `ruby`/`rt` output remain untouched.

## Test and measurement strategy

### RED test

Before optimization code, add a deterministic test using the shared fixture
with a 50,000-character document and one direct local override. It must:

1. fail against the current implementation because exact-key repository reads
   grow with resolved tokens;
2. preserve the complete expected token readings, offsets, and override flags;
3. assert that exact-key reads after snapshot construction are bounded by the
   number of distinct loaded override keys, rather than the token count.

### Duration gate

Measure the isolated 50,000-character test once when it is introduced. Retain
that size in the focused suite only if it completes in at most two minutes. If
it exceeds two minutes, select the smallest fixture size that still reproduces
the per-token lookup behavior and record the measured reason for reducing it.

### Verification after implementation

- run the new focused test and existing reading-override scenarios;
- run backend tests and the relevant frontend dialog/reader tests;
- rerun the affected backend benchmark or focused SQL trace, retaining raw
  samples rather than adding machine-dependent CI thresholds;
- verify no regression in a zero-override analysis;
- keep browser UX as a separately reported manual checkpoint.

## Acceptance criteria

1. A cache-miss analysis loads persisted overrides in a bounded bulk read.
2. It performs no per-token SQLite exact-key override lookup.
3. Local and vocabulary reading behavior remains equivalent to the baseline.
4. Cache invalidation and cache compatibility behavior remains unchanged.
5. The RED test is observed failing before the optimization and passing after it.
6. The retained focused test satisfies the two-minute duration gate, or a
   smaller evidenced fixture replaces it.
7. Post-change measurements show a reproducible improvement in the affected
   invalidated-analysis case without materially worsening the zero-override
   baseline.

## Rollback criteria

Revert the optimization if it changes readings, offsets, affected counts, cache
identity, or invalidation behavior; if the query bound cannot be achieved
without an external-contract change; or if repeated measurement fails to show a
reproducible benefit or materially regresses the no-override case.

