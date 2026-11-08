# Latency diagnosis for reading overrides

## Scope and evidence status

This diagnosis covers the already-open reader flow for setting, replacing, and deleting document-local and vocabulary-wide reading overrides. It publishes measurements only; it changes no production behavior, HTTP/OpenAPI contract, persisted schema, or cache contract.

The raw, machine-readable evidence is ignored under `.dev/performance/reading-overrides/`. This report transcribes every executed raw timing sample and median. The raw artifacts remain the source for span trees, profiler data, and reproducibility metadata.

**Evidence boundary:** backend HTTP and frontend jsdom measurements were executed separately. A real-browser integrated checkpoint was **not executed**. The frontend result must therefore not be read as browser latency or as an end-to-end total.

## Environment, fixture, and method

| Item | Recorded value |
|---|---|
| Measurement commit | `0cd369e3cc3b7ff332a343139fe2952024037d64` (`codex/reading-override-diagnosis`) |
| Worktree | `F:\Japanese.IO\.worktrees\reading-override-diagnosis` |
| Operating system | Microsoft Windows NT `10.0.22631.0` |
| CPU / memory | `Intel64 Family 6 Model 158 Stepping 13, GenuineIntel`; 31.94 GiB visible to .NET GC. Exact CPU model/core count and physical-memory WMI details were denied by the managed environment. |
| Runtime tools | launcher Python 3.14.6; benchmark venv Python 3.12.10; uv 0.12.19; Node v26.5.0; npm 11.17.0 |
| Relevant backend dependencies | FastAPI 0.115.14; Pydantic 2.13.5; SudachiPy 0.6.11; SudachiDict-core 20250825; httpx 0.28.1; pytest 9.1.1 |
| Relevant frontend dependencies | React/React DOM 19.3.0; Vitest 5.0.2; jsdom 30.1.1; Testing Library React 16.3.3 |
| Locks | `uv.lock` SHA-256 `37984E0DB587CE06945F7A31AC5D9536E4BEFD55A669CC5CEDE10A945933A325`; `frontend/package-lock.json` SHA-256 `3CAF8DA9C2C738C18EFE9E2A0F0010A271EF12CE1745B130FFFFEA618A63C254` |
| Fixture | Deterministic [shared manifest](../../tests/fixtures/reading_override_cases.json): 10,000 / 50,000 / 100,000 Unicode code points, respectively 357 / 1,786 / 3,571 target `昨日` occurrences; fixed hashes in the manifest. |
| Runs | Three samples for each executed size/scope/operation combination. |
| Machine conditions | User applications were active (notably GenshinImpact ~3.8 GiB working set, qBittorrent ~588 MiB, Opera, Discord, Docker, and desktop processes). They were not closed. Results are directional under a non-quiet baseline, not portable absolute timing targets. |

### Commands and separation

Backend API matrix (real FastAPI test client, SQLite, analysis/cache; command defined by [the benchmark harness](../../tests/performance/benchmark_reading_overrides.py)):
```powershell
uv run python tests/performance/benchmark_reading_overrides.py --runs 3 --sizes 10000,50000,100000 --output .dev/performance/reading-overrides/backend-results.json
```

Frontend UI measurement (real reader components with an immediately resolved mocked `DocumentClient`, React Profiler, and jsdom; test at [reading-override.performance.test.tsx](../../frontend/src/features/reader/reading-override.performance.test.tsx)):
```powershell
npm --prefix frontend test -- --run src/features/reader/reading-override.performance.test.tsx | Tee-Object .dev/performance/reading-overrides/frontend-results.txt
```

The frontend command passed: one test file, three tests, 178.35 s, exactly one `READING_OVERRIDE_PERFORMANCE` JSON line. The backend final artifact is schema `1`, benchmark `reading-override-backend-v1`, and has 18 results × 3 samples. Its 11,646,619-byte final JSON had SHA-256 `33D75D9B04B1008D27E6A55FE81769D9800E481B3FA2C32B6F8CBC4D57AE64CC` when inspected. A managed-shell cache permission failure occurred before the first backend measurement; subsequent parent waits timed out while children continued. The final content was post-write validated against the measurement commit and schema, but no retained PID/hash-per-attempt timeline identifies a particular writer. That provenance limitation applies to absolute timing attribution, not to the structural contents transcribed below.

Focused correctness gates after measurement passed:
```powershell
uv run pytest tests/performance/test_benchmark_reading_overrides.py tests/performance/test_reading_override_scenarios.py
# PASS: 18 tests in 17.81 s (one upstream Starlette deprecation warning)
C:\Program Files\nodejs\npm.cmd --prefix frontend test -- --run src/features/reader/ReadingOverrideDialog.test.tsx
# PASS: 1 test file, 8 tests, 1.88 s
```

### Executed matrix and deliberate gaps

All 18 backend rows are **warm**. The executed metadata covers `exceptionVolume` 0/100/1,000 and `overrideVolume` 0/100/1,000 where the document has enough occurrences (the 10k delete rows use override volume 100). In this run, those volumes are coupled to operation—set uses 0/0, replace 100/100, and delete 1,000/1,000 except for that 10k capacity limit—so the matrix is not a factorial experiment and cannot independently attribute an operation difference to volume. Each operation validates its mutation and subsequent invalidated analysis. The Task 2 harness rejects cold temperatures, so cold cache remains unexecuted. The isolated frontend matrix has no backend cache, exception, or override-volume temperature; it measures only mocked-client UI work.

## Backend HTTP and internal-stage decomposition

`analysis` and `analysis_repository` are inclusive/nested spans. Their shares are shown independently and **must not be added**. `residual` is `http_total - override_service`, a diagnostic bucket rather than proven serialization time. `R/W/E/K` is the median of classified SQLite reads/writes/exception-snapshot reads/exact-key override lookups.

| Code points | Scope | Op | Cache | Exceptions | Overrides | HTTP median ms | Override service median ms (share) | Analysis median ms (share) | Analysis repo median ms (share) | Override repo median ms (share) | Residual median ms (share) | Median R/W/E/K |
|---:|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 10000 | local | delete | warm | 1000 | 100 | 89.462 | 86.703 (96.9%) | 75.077 (83.9%) | 68.446 (76.5%) | 0.726 (0.8%) | 1.806 (2.0%) | 1/1/1/0 |
| 10000 | local | replace | warm | 100 | 100 | 117.284 | 115.126 (98.2%) | 67.958 (57.9%) | 68.516 (58.4%) | 0.739 (0.6%) | 1.709 (1.5%) | 1/1/1/0 |
| 10000 | local | set | warm | 0 | 0 | 130.363 | 121.934 (93.5%) | 95.879 (73.5%) | 97.508 (74.8%) | 0.471 (0.4%) | 2.179 (1.7%) | 1/1/1/0 |
| 10000 | vocabulary | delete | warm | 1000 | 100 | 129.308 | 127.523 (98.6%) | 110.195 (85.2%) | 103.948 (80.4%) | 4.373 (3.4%) | 1.785 (1.4%) | 1/1/1/0 |
| 10000 | vocabulary | replace | warm | 100 | 100 | 207.096 | 203.676 (98.3%) | 66.839 (32.3%) | 67.629 (32.7%) | 6.950 (3.4%) | 3.421 (1.7%) | 1/1/1/0 |
| 10000 | vocabulary | set | warm | 0 | 0 | 90.483 | 87.047 (96.2%) | 67.283 (74.4%) | 68.625 (75.8%) | 6.639 (7.3%) | 3.331 (3.7%) | 1/1/1/0 |
| 50000 | local | delete | warm | 1000 | 1000 | 601.028 | 599.167 (99.7%) | 566.857 (94.3%) | 561.504 (93.4%) | 0.503 (0.1%) | 2.152 (0.4%) | 1/1/1/0 |
| 50000 | local | replace | warm | 100 | 100 | 584.169 | 582.489 (99.7%) | 555.510 (95.1%) | 560.662 (96.0%) | 0.751 (0.1%) | 1.984 (0.3%) | 1/1/1/0 |
| 50000 | local | set | warm | 0 | 0 | 602.837 | 601.062 (99.7%) | 568.154 (94.2%) | 575.362 (95.4%) | 0.767 (0.1%) | 1.775 (0.3%) | 1/1/1/0 |
| 50000 | vocabulary | delete | warm | 1000 | 1000 | 652.135 | 650.435 (99.7%) | 590.538 (90.6%) | 588.094 (90.2%) | 21.412 (3.3%) | 1.700 (0.3%) | 1/1/1/0 |
| 50000 | vocabulary | replace | warm | 100 | 100 | 639.569 | 629.129 (98.4%) | 559.694 (87.5%) | 565.484 (88.4%) | 32.120 (5.0%) | 10.968 (1.7%) | 1/1/1/0 |
| 50000 | vocabulary | set | warm | 0 | 0 | 679.266 | 668.150 (98.4%) | 563.133 (82.9%) | 569.328 (83.8%) | 33.644 (5.0%) | 11.117 (1.6%) | 1/1/1/0 |
| 100000 | local | delete | warm | 1000 | 1000 | 1175.824 | 1173.866 (99.8%) | 1120.221 (95.3%) | 1123.512 (95.6%) | 0.801 (0.1%) | 1.859 (0.2%) | 1/1/1/0 |
| 100000 | local | replace | warm | 100 | 100 | 1189.472 | 1187.475 (99.8%) | 1138.971 (95.8%) | 1149.567 (96.6%) | 0.635 (0.1%) | 1.996 (0.2%) | 1/1/1/0 |
| 100000 | local | set | warm | 0 | 0 | 1195.001 | 1193.204 (99.8%) | 1143.270 (95.7%) | 1154.864 (96.6%) | 0.790 (0.1%) | 1.776 (0.1%) | 1/1/1/0 |
| 100000 | vocabulary | delete | warm | 1000 | 1000 | 1174.365 | 1172.443 (99.8%) | 1081.339 (92.1%) | 1050.445 (89.4%) | 36.427 (3.1%) | 1.922 (0.2%) | 1/1/1/0 |
| 100000 | vocabulary | replace | warm | 100 | 100 | 1226.740 | 1206.332 (98.3%) | 1067.248 (87.0%) | 1077.865 (87.9%) | 65.492 (5.3%) | 20.727 (1.7%) | 1/1/1/0 |
| 100000 | vocabulary | set | warm | 0 | 0 | 1195.845 | 1175.983 (98.3%) | 1056.017 (88.3%) | 1067.083 (89.2%) | 63.543 (5.3%) | 19.862 (1.7%) | 1/1/1/0 |

### Every backend raw sample (ms)

Each cell is `sample 1 / sample 2 / sample 3`; no outlier is removed. Query-count cells use the same order. `A` = analysis, `AR` = analysis repository, `OR` = override repository, `R` = response/framework residual.

| Code points | Scope | Op | HTTP | Override service | A | AR | OR | R | Cache read | Cache write | Exception snapshot | Exact-key lookup |
|---:|---|---|---:|---:|---:|---:|---:|---:|---|---|---|---|
| 10000 | local | delete | 89.462 / 87.056 / 119.764 | 86.703 / 85.249 / 118.096 | 75.077 / 73.619 / 101.605 | 68.446 / 67.780 / 95.964 | 0.755 / 0.726 / 0.515 | 2.760 / 1.806 / 1.667 | 1 / 1 / 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 |
| 10000 | local | replace | 80.881 / 117.284 / 163.530 | 79.172 / 115.126 / 161.894 | 67.958 / 97.689 / 64.412 | 68.516 / 99.694 / 64.914 | 0.739 / 0.878 / 0.515 | 1.709 / 2.158 / 1.636 | 1 / 1 / 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 |
| 10000 | local | set | 130.363 / 108.814 / 1472.668 | 121.934 / 107.103 / 1470.489 | 101.142 / 95.879 / 72.031 | 103.123 / 97.508 / 73.126 | 0.946 / 0.462 / 0.471 | 8.428 / 1.711 / 2.179 | 1 / 1 / 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 |
| 10000 | vocabulary | delete | 119.293 / 129.308 / 133.682 | 117.642 / 127.523 / 131.002 | 101.913 / 110.195 / 113.647 | 95.975 / 103.948 / 107.160 | 4.179 / 4.373 / 4.897 | 1.651 / 1.785 / 2.680 | 1 / 1 / 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 |
| 10000 | vocabulary | replace | 113.954 / 1480.433 / 207.096 | 110.528 / 1477.099 / 203.676 | 66.839 / 63.370 / 71.930 | 67.629 / 64.048 / 72.798 | 31.095 / 6.950 / 6.738 | 3.426 / 3.334 / 3.421 | 1 / 1 / 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 |
| 10000 | vocabulary | set | 95.234 / 90.483 / 84.814 | 91.903 / 87.047 / 81.493 | 68.135 / 67.283 / 62.489 | 69.402 / 68.625 / 63.494 | 6.550 / 7.195 / 6.639 | 3.331 / 3.436 / 3.321 | 1 / 1 / 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 |
| 50000 | local | delete | 616.390 / 594.472 / 601.028 | 614.238 / 592.137 / 599.167 | 586.469 / 563.382 / 566.857 | 584.036 / 561.504 / 466.772 | 0.456 / 0.598 / 0.503 | 2.152 / 2.334 / 1.860 | 1 / 1 / 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 |
| 50000 | local | replace | 675.128 / 465.154 / 584.169 | 673.144 / 463.137 / 582.489 | 641.904 / 435.643 / 555.510 | 648.172 / 441.481 / 560.662 | 0.964 / 0.477 / 0.751 | 1.984 / 2.018 / 1.680 | 1 / 1 / 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 |
| 50000 | local | set | 607.403 / 602.837 / 472.816 | 605.693 / 601.062 / 470.434 | 576.420 / 568.154 / 441.708 | 582.727 / 575.362 / 447.330 | 0.767 / 0.806 / 0.731 | 1.710 / 1.775 / 2.381 | 1 / 1 / 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 |
| 50000 | vocabulary | delete | 673.942 / 602.182 / 652.135 | 672.243 / 600.143 / 650.435 | 617.998 / 547.168 / 590.538 | 615.190 / 545.163 / 588.094 | 21.412 / 20.521 / 21.785 | 1.699 / 2.039 / 1.700 | 1 / 1 / 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 |
| 50000 | vocabulary | replace | 699.341 / 540.747 / 639.569 | 687.638 / 529.778 / 629.129 | 621.871 / 463.062 / 559.694 | 627.124 / 468.550 / 565.484 | 31.900 / 32.946 / 32.120 | 11.704 / 10.968 / 10.440 | 1 / 1 / 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 |
| 50000 | vocabulary | set | 642.797 / 679.266 / 2673.081 | 631.209 / 668.150 / 2662.102 | 563.133 / 600.333 / 447.807 | 569.328 / 605.867 / 454.039 | 33.083 / 33.644 / 577.401 | 11.588 / 11.117 / 10.979 | 1 / 1 / 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 |
| 100000 | local | delete | 1175.824 / 1496.340 / 1124.708 | 1173.866 / 1494.481 / 1122.860 | 1120.221 / 1439.787 / 1077.995 | 1123.512 / 1442.115 / 1080.718 | 0.716 / 1.287 / 0.801 | 1.958 / 1.859 / 1.848 | 1 / 1 / 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 |
| 100000 | local | replace | 1189.472 / 1247.483 / 1148.416 | 1187.475 / 1244.927 / 1146.768 | 1138.971 / 1183.263 / 1096.157 | 1149.567 / 1200.664 / 1107.380 | 0.733 / 0.635 / 0.434 | 1.996 / 2.556 / 1.648 | 1 / 1 / 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 |
| 100000 | local | set | 1220.219 / 1195.001 / 1185.109 | 1218.443 / 1193.204 / 1183.406 | 1168.249 / 1143.270 / 1130.950 | 1180.039 / 1154.864 / 1142.960 | 0.817 / 0.769 / 0.790 | 1.776 / 1.797 / 1.702 | 1 / 1 / 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 |
| 100000 | vocabulary | delete | 1174.365 / 1143.720 / 1177.095 | 1172.443 / 1141.604 / 1175.403 | 1081.339 / 1047.541 / 1082.666 | 1083.913 / 1050.445 / 1024.110 | 36.424 / 36.427 / 36.950 | 1.922 / 2.116 / 1.692 | 1 / 1 / 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 |
| 100000 | vocabulary | replace | 1226.740 / 1193.330 / 1420.750 | 1206.332 / 1172.603 / 1399.926 | 1067.248 / 1049.575 / 1268.475 | 1077.865 / 1060.374 / 1279.002 | 73.330 / 63.701 / 65.492 | 20.408 / 20.727 / 20.824 | 1 / 1 / 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 |
| 100000 | vocabulary | set | 1210.024 / 1027.011 / 1195.845 | 1187.073 / 1008.441 / 1175.983 | 1057.900 / 884.036 / 1056.017 | 1068.562 / 894.913 / 1067.083 | 64.365 / 63.543 / 61.455 | 22.951 / 18.570 / 19.862 | 1 / 1 / 1 | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 |

### Backend observations

- At 50k and 100k, `analysis` is 82.9–95.8% of HTTP median and `analysis_repository` is 83.8–96.6% across all twelve executed rows. At 10k, the low 32.3% vocabulary-replace result shows material noise; no claim depends on that row alone.
- The residual is 0.1–3.9% of HTTP median in every row, so response/framework work is not supported as the leading explanation in this matrix.
- The full matrix includes pre-seeded override volumes but reports zero classified exact-key lookups in every sample. That does not contradict the focused trace below, which intentionally inserts one direct valid local override and forces the relevant invalidated analysis path; the matrix does not isolate that direct-match condition.

### Focused 50k analysis/cache profile

The selected medium (50,000-code-point) trace used the real analyzer, made an invalidated analysis with zero overrides, then made an invalidated analysis with one direct local override. It recorded two invalidations; each traced request had one cache read, one cache write, and one exception-snapshot read.

| Trace case | Override existence checks | Exact-key lookups | Cache reads | Cache writes | Exception snapshot reads |
|---|---:|---:|---:|---:|---:|
| zero overrides | 1 | 0 | 1 | 1 | 1 |
| one local override | 1 | 32,144 | 1 | 1 | 1 |

`cProfile` recorded 10,256,882 calls and 27.428 s internal total. Across three analysis calls, `AnalysisService.analyze` accumulated 25.144 s; resolver `resolve` 16.660 s over 32,144 calls; override repository `get` 16.514 s over 32,144 calls; SQLite `execute` 9.745 s over 128,732 calls; and SQLite `connect` 4.849 s over 32,173 calls. This confirms a per-resolved-token exact-key lookup pattern in this focused 50k forced-cache-miss trace. It does not by itself prove why every full-matrix endpoint time is high, nor that one implementation change will remove every one of those costs.

## Frontend jsdom reconciliation decomposition

This is a separate warm/mocked-client UI benchmark. `client` is submit-to-client-call; `visible` is client-resolution-to-visible-update; `total` is submit-to-visible-update. `React sum` is the median of per-sample sums of all captured React Profiler commits. It is a component-work signal inside the jsdom result, not a separately additive end-to-end segment.

| Code points | Scope | Op | Rendered / changed tokens | Client median ms | Visible median ms | Total median ms | Client share | Visible share | React sum median ms | React share |
|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 10000 | local | delete | 357 / 1 | 211.781 | 112.408 | 322.233 | 65.7% | 34.9% | 72.327 | 22.4% |
| 10000 | local | replace | 357 / 1 | 208.749 | 122.182 | 328.328 | 63.6% | 37.2% | 74.111 | 22.6% |
| 10000 | local | set | 357 / 1 | 212.841 | 128.664 | 341.786 | 62.3% | 37.6% | 73.503 | 21.5% |
| 10000 | vocabulary | delete | 357 / 357 | 213.070 | 115.469 | 328.539 | 64.9% | 35.1% | 72.865 | 22.2% |
| 10000 | vocabulary | replace | 357 / 357 | 212.106 | 128.099 | 340.205 | 62.3% | 37.7% | 75.081 | 22.1% |
| 10000 | vocabulary | set | 357 / 357 | 218.839 | 120.595 | 342.212 | 63.9% | 35.2% | 75.040 | 21.9% |
| 50000 | local | delete | 1786 / 1 | 1018.148 | 493.291 | 1511.440 | 67.4% | 32.6% | 302.091 | 20.0% |
| 50000 | local | replace | 1786 / 1 | 1012.352 | 490.356 | 1521.157 | 66.6% | 32.2% | 316.531 | 20.8% |
| 50000 | local | set | 1786 / 1 | 1026.802 | 487.681 | 1509.886 | 68.0% | 32.3% | 302.499 | 20.0% |
| 50000 | vocabulary | delete | 1786 / 1786 | 1035.578 | 496.122 | 1531.701 | 67.6% | 32.4% | 309.478 | 20.2% |
| 50000 | vocabulary | replace | 1786 / 1786 | 1013.814 | 486.250 | 1522.182 | 66.6% | 31.9% | 302.943 | 19.9% |
| 50000 | vocabulary | set | 1786 / 1786 | 1015.868 | 491.210 | 1501.247 | 67.7% | 32.7% | 301.657 | 20.1% |
| 100000 | local | delete | 3571 / 1 | 2008.536 | 726.331 | 2713.998 | 74.0% | 26.8% | 367.541 | 13.5% |
| 100000 | local | replace | 3571 / 1 | 2116.941 | 696.835 | 2822.746 | 75.0% | 24.7% | 344.833 | 12.2% |
| 100000 | local | set | 3571 / 1 | 2061.505 | 695.447 | 2748.196 | 75.0% | 25.3% | 345.589 | 12.6% |
| 100000 | vocabulary | delete | 3571 / 3571 | 2001.304 | 707.417 | 2708.722 | 73.9% | 26.1% | 351.858 | 13.0% |
| 100000 | vocabulary | replace | 3571 / 3571 | 2029.433 | 725.252 | 2777.637 | 73.1% | 26.1% | 355.900 | 12.8% |
| 100000 | vocabulary | set | 3571 / 3571 | 1999.712 | 771.766 | 2814.964 | 71.0% | 27.4% | 380.557 | 13.5% |

### Every frontend raw sample (ms)

`Profiler commits` gives every commit-duration array for sample 1 / sample 2 / sample 3. Values are captured from the ignored frontend output without filtering.

| Code points | Scope | Op | Client (1 / 2 / 3) | Visible (1 / 2 / 3) | Total (1 / 2 / 3) | Profiler commits (sample 1; sample 2; sample 3) |
|---:|---|---|---|---|---|---|
| 10000 | local | delete | 211.781 / 214.605 / 209.825 | 109.886 / 117.715 / 112.408 | 321.667 / 332.320 / 322.233 | [0.601, 73.359, 0.002]; [0.617, 71.415, 0.002]; [0.841, 71.484, 0.002] |
| 10000 | local | replace | 205.322 / 208.749 / 210.962 | 123.003 / 122.182 / 113.045 | 328.328 / 330.931 / 324.008 | [0.617, 73.191, 0.006]; [0.630, 73.478, 0.003]; [0.603, 76.439, 0.002] |
| 10000 | local | set | 212.841 / 205.977 / 305.480 | 128.942 / 128.664 / 117.271 | 341.786 / 334.642 / 422.752 | [0.605, 75.186, 0.004]; [0.715, 71.868, 0.002]; [0.588, 72.913, 0.002] |
| 10000 | vocabulary | delete | 206.836 / 232.720 / 213.070 | 109.984 / 126.245 / 115.469 | 316.821 / 358.966 / 328.539 | [0.598, 72.264, 0.003]; [0.624, 71.232, 0.002]; [0.639, 74.092, 0.002] |
| 10000 | vocabulary | replace | 211.264 / 212.106 / 214.938 | 145.104 / 128.099 / 121.146 | 356.369 / 340.205 / 336.084 | [0.634, 77.704, 0.003]; [0.603, 73.145, 0.002]; [0.629, 74.450, 0.002] |
| 10000 | vocabulary | set | 203.641 / 230.940 / 218.839 | 119.827 / 120.595 / 123.373 | 323.469 / 351.536 / 342.212 | [0.594, 73.186, 0.002]; [0.622, 74.415, 0.003]; [0.561, 74.912, 0.004] |
| 50000 | local | delete | 1018.148 / 1027.085 / 1011.804 | 493.291 / 470.611 / 556.181 | 1511.440 / 1497.696 / 1567.986 | [1.120, 300.969, 0.002]; [1.058, 291.471, 0.002]; [1.132, 326.178, 0.002] |
| 50000 | local | replace | 1012.352 / 1030.800 / 1001.201 | 513.015 / 490.356 / 489.908 | 1525.367 / 1521.157 / 1491.110 | [1.219, 337.119, 0.002]; [1.268, 315.260, 0.003]; [0.973, 314.942, 0.002] |
| 50000 | local | set | 1021.038 / 1036.670 / 1026.802 | 487.681 / 473.216 / 524.374 | 1508.720 / 1509.886 / 1551.177 | [0.984, 298.824, 0.002]; [1.310, 301.187, 0.002]; [1.341, 331.073, 0.002] |
| 50000 | vocabulary | delete | 1065.865 / 1031.089 / 1035.578 | 503.719 / 488.018 / 496.122 | 1569.584 / 1519.107 / 1531.701 | [0.976, 324.089, 0.002]; [1.006, 308.470, 0.002]; [1.132, 301.492, 0.003] |
| 50000 | vocabulary | replace | 1012.329 / 1038.708 / 1013.814 | 517.058 / 483.474 / 486.250 | 1529.389 / 1522.182 / 1500.064 | [1.114, 321.003, 0.003]; [1.012, 301.766, 0.002]; [1.210, 301.731, 0.002] |
| 50000 | vocabulary | set | 1034.524 / 1015.868 / 1010.036 | 498.451 / 484.983 / 491.210 | 1532.977 / 1500.851 / 1501.247 | [1.448, 293.642, 0.002]; [0.941, 307.098, 0.002]; [1.003, 300.652, 0.002] |
| 100000 | local | delete | 1987.667 / 2008.536 / 2387.016 | 726.331 / 685.857 / 898.722 | 2713.998 / 2694.393 / 3285.739 | [1.676, 365.863, 0.002]; [1.878, 332.603, 0.003]; [1.849, 465.133, 0.003] |
| 100000 | local | replace | 2116.941 / 2076.698 / 2346.932 | 705.804 / 681.750 / 696.835 | 2822.746 / 2758.449 / 3043.768 | [2.073, 342.757, 0.003]; [1.673, 339.450, 0.002]; [2.072, 350.315, 0.002] |
| 100000 | local | set | 2216.219 / 2052.339 / 2061.505 | 699.512 / 695.447 / 686.690 | 2915.733 / 2747.787 / 2748.196 | [1.766, 352.244, 0.003]; [1.966, 343.621, 0.002]; [1.702, 341.173, 0.003] |
| 100000 | vocabulary | delete | 2054.530 / 1982.726 / 2001.304 | 735.293 / 678.543 / 707.417 | 2789.824 / 2661.271 / 2708.722 | [1.570, 355.667, 0.002]; [1.764, 328.739, 0.003]; [1.620, 350.236, 0.002] |
| 100000 | vocabulary | replace | 2123.383 / 2029.433 / 2025.460 | 724.744 / 748.203 / 725.252 | 2848.129 / 2777.637 / 2750.713 | [1.432, 354.466, 0.002]; [3.030, 348.188, 0.003]; [1.742, 358.032, 0.002] |
| 100000 | vocabulary | set | 2043.196 / 1999.712 / 1980.670 | 771.766 / 836.970 / 701.812 | 2814.964 / 2836.683 / 2682.483 | [1.470, 379.085, 0.002]; [1.880, 404.649, 0.002]; [1.459, 339.632, 0.002] |

### Frontend observations

- In jsdom, client-preparation time is 62.3–75.3% of the median total and grows with rendered-token count; visible-update time is 24.7–37.7%.
- React Profiler commit-sum share is 12.2–22.7% of this benchmark. That rules out React commit time as the sole majority of this jsdom split, but it does not establish browser behavior or identify the work inside the pre-client segment.
- At a fixed corpus, local and vocabulary operations are similar in the mocked-client measurement despite changing 1 versus every rendered target token. This is correlation within jsdom, not a causal explanation of a real browser interaction.

## Real-browser integrated checkpoint

**Not executed.** Chrome and Edge were installed, but this worktree had no Playwright/Puppeteer package or compatible browser automation harness. No jsdom value is presented as a browser PASS. Before treating either frontend split as a live interaction diagnosis, run a disposable-database manual checkpoint at the deterministic 50k case for local and vocabulary set/delete, recording browser/version, network duration, and submit-to-visible-update duration.

## Hypothesis classification

### Confirmed bottlenecks

#### Backend analysis/cache is the dominant measured backend stage

- **Evidence:** at 50k/100k, analysis is 82.9–95.8% and analysis repository is 83.8–96.6% of each HTTP median across local and vocabulary set/replace/delete. The focused profile records 25.144 s cumulative in `AnalysisService.analyze`.
- **Scaling:** HTTP medians generally rise from roughly 0.58–0.68 s at 50k to 1.17–1.23 s at 100k; the analysis share remains high. The noisy 10k vocabulary-replace row is excluded from the consistency claim.
- **Maximum theoretical gain:** a hypothetical removal of all work in the inclusive analysis stage is bounded by its observed 82.9–95.8% share at 50k/100k; this is an upper bound, not an implementation forecast, because analysis includes necessary work and nested stages.
- **Causal boundary:** these results show sustained dominance and select the branch for further work. They do not establish that cache design, SQLite, morphology, or any one line is the sole cause of total request latency.

#### Per-token exact-key override resolution is confirmed in the focused one-override trace

- **Evidence:** changing the focused 50k trace from zero overrides to one local override changes exact-key lookups from 0 to 32,144. The profile records 32,144 `resolve` calls (16.660 s cumulative) and 32,144 repository `get` calls (16.514 s cumulative).
- **Scaling:** in that representative invalidated analysis, lookup count grows with resolved tokens rather than staying bounded by the number of stored override keys. The trace does not measure every exception/override volume or prove the same cost in all matrix rows.
- **Maximum theoretical gain:** removing only the profiled repository-`get` cumulative work is bounded by `16.514 / 27.428 = 60.2%` of this profile’s internal total; it is not a 60.2% endpoint promise, since the profile spans multiple analysis calls and may include overlapping work.
- **Causal boundary:** the trace identifies the mechanism and motivates a data-access candidate; it does not prove that prefetching is safe, sufficient, or dominant when no prior override exists.

### Rejected hypotheses

- **Response/framework residual dominates the backend request — rejected for the executed matrix.** The residual is 0.1–3.9% of the HTTP median. It is a bucket rather than a serialization proof, but it is too small here to lead the diagnosis.
- **React reconciliation alone dominates the frontend result — rejected for this jsdom split.** Profiler commit sums are 12.2–22.7% of total. This rejection does not generalize to a real browser.

### Unresolved questions

- **Live browser behavior:** no browser checkpoint exists; network, layout, paint, browser scheduling, and live transport are unmeasured.
- **Cold cache and independent volume sensitivity:** cold cache was not executed. Warm volume values 0/100/1,000 are present, but they are coupled to set/replace/delete (and 10k delete has only 100 overrides), so this matrix cannot independently identify a volume effect.
- **Full endpoint relation to the one-override lookup trace:** the matrix varies pre-seeded override volumes yet has zero classified exact-key lookups in every sample; the separate direct-one-override trace confirms a mechanism but does not quantify its endpoint contribution across an operation/volume-independent matrix.
- **Noisy environment and backend artifact writer:** concurrent user activity and timed-out parent shells limit cross-run comparability and precise writer attribution. The final artifact was structurally/commit validated after its last observed write.

## Third-stage handoff (ranked candidates)

### 1. Prefetch document override keys into a per-analysis lookup map — recommended first candidate

| Handoff item | Requirement |
|---|---|
| Evidence | The focused 50k forced-cache-miss trace moves from 0 to 32,144 exact-key queries after one local override, with 16.514 s cumulative in repository `get`; analysis/cache also dominates 50k/100k HTTP medians. |
| Maximum theoretical gain | At most 60.2% of the focused profile internal total for repository-`get` cumulative time, and no more than the 82.9–95.8% inclusive analysis share of the representative backend HTTP medians. Neither bound is a promised endpoint reduction. |
| Preserve | `Document.content` canonicality; revision/cache identity including analyzer/dictionary version, exceptions, and options; local-one-occurrence and vocabulary-wide affected-count semantics; offsets, surface, reading, vocabulary key, Problem Details, reconciled client state, native selection/copy, and `ruby`/`rt`. No external HTTP/OpenAPI/persistence contract change. |
| Regression risk | Incorrect key normalization or scope filtering could apply the wrong reading; stale snapshot/cache identity could leak changes; a large map could increase memory or regress no-override cases; ordering/exception precedence may change. |
| Required RED test before implementation | Add a deterministic 50k one-local-override analysis test that asserts exact-key repository lookups are bounded by the number of distinct override keys (rather than resolved tokens) while the returned tokens/offsets/readings remain identical. It must fail against the current 32,144-lookup behavior before any optimization code is added. |
| Measurable success | The new correctness test passes; focused SQL trace no longer grows exact-key lookups per token for the one-override case; all existing override scenarios pass; rerun the full warm matrix and show a material, reproducible reduction in the affected one-override API case without worsening zero-override rows. Record raw samples, not CI time thresholds. |
| Rollback criterion | Roll back if any reading/offset/affected-count/cache-identity regression occurs, if the query bound cannot be met without a contract compromise, or if repeated reruns show no reproducible benefit or regress the zero-override baseline materially. |

**Why this is first:** it is the only implementation candidate with both sustained backend stage dominance and a focused, countable mechanism. Its endpoint impact is still an upper-bound estimate; implementation must validate it rather than assume causation.

### 2. Frontend pre-client/reconciliation optimization — not recommended until browser evidence exists

| Handoff item | Requirement |
|---|---|
| Evidence | In jsdom, submit-to-client-call is 62.3–75.3% of total while React commit sums are 12.2–22.7%; behavior rises with rendered token count. |
| Maximum theoretical gain | Bounded by the 62.3–75.3% jsdom pre-client share only. There is no valid browser/end-to-end gain bound. |
| Preserve | Dialog pending/completion states, request payloads, local/global changed-token semantics, canonical visible text, native selection/copy, `ruby`/`rt`, and client error reconciliation. |
| Regression risk | Reducing renders/state work may leave stale readings, lose dialog feedback, break selection semantics, or shift work to a browser-only path. |
| Required RED test before implementation | First add a real-browser, disposable-database measurement/checkpoint that demonstrates the same large-document pre-client or visible-update behavior; any proposed DOM/state optimization must then add a semantic regression test that fails before the change (not a fragile CI time threshold). |
| Measurable success | After browser confirmation, preserve the focused UI semantics and demonstrate a repeatable reduction in the specifically confirmed browser stage across local and vocabulary operations, with raw browser timings retained outside CI. |
| Rollback criterion | Roll back if browser evidence does not reproduce the signal, if semantics/accessibility/native text behavior regress, or if the chosen stage does not improve reproducibly. |

### Required gate

**Stop here.** A human must approve a new optimization specification and implementation plan before any candidate is implemented. The next plan must include the RED test, repeat the affected measurements under a quieter/provenanced run, retain the manual/automated browser checkpoint boundary, and explicitly decide whether the missing cold/volume dimensions must be covered first.

## Reproduction and source links

- Scenario fixture: [reading_override_cases.json](../../tests/fixtures/reading_override_cases.json)
- Backend benchmark: [benchmark_reading_overrides.py](../../tests/performance/benchmark_reading_overrides.py)
- Backend scenario tests: [test_reading_override_scenarios.py](../../tests/performance/test_reading_override_scenarios.py)
- Frontend benchmark: [reading-override.performance.test.tsx](../../frontend/src/features/reader/reading-override.performance.test.tsx)
- Diagnosis specification: [2026-11-07 design](../superpowers/specs/2026-11-07-reading-override-performance-diagnosis-design.md)
- Diagnosis plan: [2026-11-07 plan](../superpowers/plans/2026-11-07-reading-override-performance-diagnosis.md)
