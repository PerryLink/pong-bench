# PongBench leaderboard

The latest full run per model and track, on the current suites, with the plain top answer, the official stay tolerance and under 1% failed calls.
Score = mean of decision accuracy (macro) and rally rate; both are speed-independent.
Latency depends on the machine and network it was measured on.

| # | model | track | score | decisions (macro) | up | down | stay | rally rate | misses / 100 returns | probabilities | p50 latency | run |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Custom JavaScript player | standard | **100** | 100% | 100% | 100% | 100% | 100% | 0 | model | 0 ms | [20261010-013640_custom-module_standard](20261010-013640_custom-module_standard/scorecard.md) |
| 2 | Rule oracle (baseline) | standard | **100** | 100% | 100% | 100% | 100% | 100% | 0 | model | 0 ms | [20261010-013640_mock-oracle_standard](20261010-013640_mock-oracle_standard/scorecard.md) |
| 3 | Jev (TypeSafe) | compact | **99.8** | 99.67% | 100% | 100% | 99% | 100% | 0 | model | 330.1 ms | [20261010-013929_typesafe-jev_compact](20261010-013929_typesafe-jev_compact/scorecard.md) |
| 4 | Jev (TypeSafe) | minimal | **98.9** | 97.78% | 100% | 100% | 93.3% | 100% | 0 | model | 330.2 ms | [20261010-014437_typesafe-jev_minimal](20261010-014437_typesafe-jev_minimal/scorecard.md) |
| 5 | Jev (TypeSafe) | standard | **98.6** | 97.22% | 99.3% | 92.7% | 99.7% | 100% | 0 | model | 330 ms | [20261010-013710_typesafe-jev_standard](20261010-013710_typesafe-jev_standard/scorecard.md) |
| 6 | H2O-Lightning-4B (local GPU) | compact | **95.8** | 91.67% | 81.3% | 94.7% | 99% | 100% | 0 | model | 106.7 ms | [20261010-020011_h2o-lightning-local_compact](20261010-020011_h2o-lightning-local_compact/scorecard.md) |
| 7 | Hesitant oracle (baseline) | standard | **94** | 88% | 82.7% | 81.3% | 100% | 100% | 0 | model | 0 ms | [20261010-013640_mock-hesitant_standard](20261010-013640_mock-hesitant_standard/scorecard.md) |
| 8 | Noisy oracle 10% (baseline) | standard | **91.9** | 91.22% | 91.7% | 90.7% | 91.3% | 92.6% | 8 | model | 0 ms | [20261010-013640_mock-noisy_standard](20261010-013640_mock-noisy_standard/scorecard.md) |
| 9 | Jev (TypeSafe) | reasoning | **85.3** | 79% | 75% | 72.7% | 89.3% | 91.5% | 9.3 | model | 329.7 ms | [20261010-014218_typesafe-jev_reasoning](20261010-014218_typesafe-jev_reasoning/scorecard.md) |
| 10 | H2O-Lightning-4B (local GPU) | standard | **84.7** | 80.44% | 76.3% | 76% | 89% | 89% | 12.3 | model | 166.5 ms | [20261010-015420_h2o-lightning-local_standard](20261010-015420_h2o-lightning-local_standard/scorecard.md) |
| 11 | H2O-Lightning-4B (local GPU) | minimal | **72.3** | 78.22% | 47.3% | 100% | 87.3% | 66.3% | 50.7 | model | 64 ms | [20261010-020954_h2o-lightning-local_minimal](20261010-020954_h2o-lightning-local_minimal/scorecard.md) |
| 12 | H2O-Lightning-4B (local GPU) | reasoning | **49.4** | 48.44% | 27% | 24.7% | 93.7% | 50.4% | 98.4 | model | 163.4 ms | [20261010-020353_h2o-lightning-local_reasoning](20261010-020353_h2o-lightning-local_reasoning/scorecard.md) |
| 13 | Random (baseline) | standard | **30.2** | 33.22% | 30.3% | 34% | 35.3% | 27.2% | 267.4 | model | 0 ms | [20261010-013640_mock-random_standard](20261010-013640_mock-random_standard/scorecard.md) |
| 14 | Always stay (baseline) | standard | **28.1** | 33.33% | 0% | 0% | 100% | 22.8% | 339 | model | 0 ms | [20261010-013640_mock-stay_standard](20261010-013640_mock-stay_standard/scorecard.md) |
