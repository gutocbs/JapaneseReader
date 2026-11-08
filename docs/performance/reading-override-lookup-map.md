# Reading-override lookup-map evidence

## Scope and environment

This record covers commit `1f59fc7646ba0d1a0828bfe0e0de40901476d9dd` (`perf: resolve reading overrides from analysis snapshot`). It measures the backend FastAPI/TestClient and SQLite path only; it is not a browser benchmark.

- Host: Windows 11 (reported by the existing environment); Intel Core i5-9600K @ 3.70 GHz, 6 logical processors, 31.94 GiB RAM.
- Tooling: `uv 0.12.19`, Python 3.12.10, Node v26.5.0, npm 11.17.0.
- Benchmark dependencies: FastAPI 0.115.14, Pydantic 2.13.5, SudachiPy 0.6.11, SudachiDict-core 20250825.
- Load caveat: timings are wall-clock samples on a shared desktop and include analyzer, FastAPI/TestClient, and temporary SQLite work. They are descriptive, not a CI threshold or a throughput/SLA claim.

The retained raw benchmark is deliberately untracked at `.dev/performance/reading-overrides/lookup-map-results.json` (schema version 1).

## 50k duration gate and lookup contract

Command:

```powershell
Measure-Command { uv run pytest tests/performance/test_reading_override_lookup_map.py -q }
```

Result: passed (exit code 0) in `3.1625322` seconds including `uv`/pytest startup, below the two-minute gate. The fixture is the `medium` scenario: 50,000 code points and 1,786 declared `昨日` occurrences. No smaller fixture was substituted.

The test's counted cold-analysis result was one immutable override snapshot read and zero exact-key reads for the 50k document. It also checked the selected token's replacement reading/flag and the complete flattened token sequence against the no-override baseline.

## Measured SQL/query evidence

Benchmark command:

```powershell
uv run python tests/performance/benchmark_reading_overrides.py --runs 3 --sizes 50000 --output .dev/performance/reading-overrides/lookup-map-results.json
```

It completed successfully in 377.8 seconds and wrote six scenarios, each with three samples. The median timed-request counts were the same in every scenario: 0 reading-override existence checks, 0 reading-override exact-key lookups, 1 analysis-cache read, 1 analysis-cache write, and 1 reading-exception snapshot read.

The affected local paths were:

| Path | Background overrides | Exceptions | Median HTTP total |
| --- | ---: | ---: | ---: |
| local set | 0 | 0 | 1216.647 ms |
| local replace | 100 | 100 | 613.457 ms |
| local delete | 1,000 | 1,000 | 585.964 ms |

The timing spread (notably local set) confirms that these three wall-clock samples must not be read as a stable latency comparison.

For the requested invalidated-analysis comparison, a complementary SQL trace executed the real analyzer-warm 50k analysis twice: zero overrides and one local override. Both recorded `0` exact-key lookups and `0` override-existence checks; both recorded one analysis-cache read, one analysis-cache write, and one reading-exception snapshot read. The counted test above is the evidence for the single bulk snapshot because this trace schema classifies only existence and exact-key reading-override SQL, not bulk snapshot SQL.

## Before/after conclusion

The diagnosis/RED evidence at `ce655db` measured `32,144` per-token exact-key reads for this same 50k cold-analysis regression case. The post-change duration-gate test measures `0` exact-key reads and `1` bulk snapshot read, while retaining the expected token result. The trace separately shows that the invalidated zero-override and one-local-override cases both have zero exact-key SQL lookups. This is evidence of removal of the diagnosed per-token lookup pattern; it is not a measured browser-performance improvement, and no percentage latency improvement is claimed because no comparable pre-change wall-clock benchmark sample was retained.

## Functional verification

Executed successfully:

```powershell
uv run pytest backend/tests tests/performance/test_reading_override_scenarios.py tests/performance/test_reading_override_lookup_map.py -q
```

Result: `361 passed, 1 skipped, 1 warning in 11.38s`. The warning is the existing Starlette `BlockingPortal` deprecation warning.

`git diff --check` completed with no diff errors.

## Limits and unexecuted evidence

- No browser/manual checkpoint was executed. Backend TestClient, unit, and SQL evidence cannot establish reader-dialog responsiveness, rendering, or live-browser behavior.
- Docker and userscript suites were not run; they are outside this backend lookup-map measurement.
- The exact requested `npm` commands could not start because the local PowerShell npm shim emitted a parser error around `caveman.CMD shrink`. Retrying with `npm.cmd` reached the package scripts but failed because frontend dependencies are absent: `vitest` and `tsc` were not recognized. This is an environment/dependency blocker, not backend functional evidence.
