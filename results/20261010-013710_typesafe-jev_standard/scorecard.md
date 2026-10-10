# PongBench scorecard: Jev (TypeSafe)

- Model: `jev-latest` via the systemone connector (https://api.typesafe.ai/v1/systemone)
- Track: standard (Standard); tolerance 5; stay handicap off
- Run: 2026-10-10T01:37:10.091Z, 139 s, 2100 calls, 0 errors; PongBench 1.0.0

## PongBench score: 98.6

The mean of decision accuracy (macro over up, down and stay) and rally rate. Both are independent of speed.

## Decisions

|  | right | accuracy |
| --- | --- | --- |
| up | 298 / 300 | 99.3% |
| down | 278 / 300 | 92.7% |
| stay | 299 / 300 | 99.7% |
| **macro** |  | **97.22%** |

Where it matters:

| slice | right | accuracy |
| --- | --- | --- |
| move needed, ball arrives 5-8 units off centre | 69 / 91 | 75.8% |
| move needed, ball arrives 8-12 units off centre | 94 / 96 | 97.9% |
| move needed, ball arrives 12+ units off centre | 413 / 413 | 100% |
| up toward the top edge (interceptY < 10) | 37 / 37 | 100% |
| down toward the bottom edge (interceptY > 90) | 16 / 16 | 100% |
| ball moving away | 150 / 150 | 100% |
| paddle already covers it | 149 / 150 | 99.3% |

Confusion (rows: the rule; columns: the answer):

|  | up | down | stay | error |
| --- | --- | --- | --- | --- |
| up | 298 | 2 | 0 | 0 |
| down | 0 | 278 | 22 | 0 |
| stay | 1 | 0 | 299 | 0 |

Calibration (the model's own probabilities): Brier 0.0519, log loss 0.1077, ECE 0.034.

Latency: p50 330 ms, p95 379.9 ms; 642 input tokens per decision; 0 errors.

## Rally (lockstep against the wall)

Rally rate **100%**: 76 returns, 0 misses over 1200 decisions (0 misses per 100 returns, longest rally 19); the answers matched the rule 98.1% of the time.

| seed | returns | misses | rally rate |
| --- | --- | --- | --- |
| 101 | 19 | 0 | 100% |
| 102 | 19 | 0 | 100% |
| 103 | 19 | 0 | 100% |
| 104 | 19 | 0 | 100% |

## Reproduce

```bash
node bin/pongbench.js run --config typesafe-jev --track standard
```

Suites: decisions decisions-v1, rally rally-v1.
