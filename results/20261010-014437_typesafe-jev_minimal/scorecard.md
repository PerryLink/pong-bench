# PongBench scorecard: Jev (TypeSafe)

- Model: `jev-latest` via the systemone connector (https://api.typesafe.ai/v1/systemone)
- Track: minimal (Minimal); tolerance 5; stay handicap off
- Run: 2026-10-10T01:44:37.704Z, 140.6 s, 2100 calls, 0 errors; PongBench 1.0.0

## PongBench score: 98.9

The mean of decision accuracy (macro over up, down and stay) and rally rate. Both are independent of speed.

## Decisions

|  | right | accuracy |
| --- | --- | --- |
| up | 300 / 300 | 100% |
| down | 300 / 300 | 100% |
| stay | 280 / 300 | 93.3% |
| **macro** |  | **97.78%** |

Where it matters:

| slice | right | accuracy |
| --- | --- | --- |
| move needed, ball arrives 5-8 units off centre | 91 / 91 | 100% |
| move needed, ball arrives 8-12 units off centre | 96 / 96 | 100% |
| move needed, ball arrives 12+ units off centre | 413 / 413 | 100% |
| up toward the top edge (interceptY < 10) | 37 / 37 | 100% |
| down toward the bottom edge (interceptY > 90) | 16 / 16 | 100% |
| ball moving away | 150 / 150 | 100% |
| paddle already covers it | 130 / 150 | 86.7% |

Confusion (rows: the rule; columns: the answer):

|  | up | down | stay | error |
| --- | --- | --- | --- | --- |
| up | 300 | 0 | 0 | 0 |
| down | 0 | 300 | 0 | 0 |
| stay | 20 | 0 | 280 | 0 |

Calibration (the model's own probabilities): Brier 0.0381, log loss 0.0759, ECE 0.0201.

Latency: p50 330.2 ms, p95 379.5 ms; 368 input tokens per decision; 0 errors.

## Rally (lockstep against the wall)

Rally rate **100%**: 76 returns, 0 misses over 1200 decisions (0 misses per 100 returns, longest rally 19); the answers matched the rule 97.8% of the time.

| seed | returns | misses | rally rate |
| --- | --- | --- | --- |
| 101 | 19 | 0 | 100% |
| 102 | 19 | 0 | 100% |
| 103 | 19 | 0 | 100% |
| 104 | 19 | 0 | 100% |

## Reproduce

```bash
node bin/pongbench.js run --config typesafe-jev --track minimal
```

Suites: decisions decisions-v1, rally rally-v1.
