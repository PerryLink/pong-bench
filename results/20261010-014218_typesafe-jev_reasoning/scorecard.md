# PongBench scorecard: Jev (TypeSafe)

- Model: `jev-latest` via the systemone connector (https://api.typesafe.ai/v1/systemone)
- Track: reasoning (Reasoning); tolerance 5; stay handicap off
- Run: 2026-10-10T01:42:18.194Z, 139.4 s, 2100 calls, 0 errors; PongBench 1.0.0

## PongBench score: 85.3

The mean of decision accuracy (macro over up, down and stay) and rally rate. Both are independent of speed.

## Decisions

|  | right | accuracy |
| --- | --- | --- |
| up | 225 / 300 | 75% |
| down | 218 / 300 | 72.7% |
| stay | 268 / 300 | 89.3% |
| **macro** |  | **79%** |

Where it matters:

| slice | right | accuracy |
| --- | --- | --- |
| move needed, ball arrives 5-8 units off centre | 19 / 91 | 20.9% |
| move needed, ball arrives 8-12 units off centre | 41 / 96 | 42.7% |
| move needed, ball arrives 12+ units off centre | 383 / 413 | 92.7% |
| up toward the top edge (interceptY < 10) | 34 / 37 | 91.9% |
| down toward the bottom edge (interceptY > 90) | 15 / 16 | 93.8% |
| ball moving away | 150 / 150 | 100% |
| paddle already covers it | 118 / 150 | 78.7% |

Confusion (rows: the rule; columns: the answer):

|  | up | down | stay | error |
| --- | --- | --- | --- | --- |
| up | 225 | 22 | 53 | 0 |
| down | 7 | 218 | 75 | 0 |
| stay | 14 | 18 | 268 | 0 |

Calibration (the model's own probabilities): Brier 0.3178, log loss 0.5582, ECE 0.0584.

Latency: p50 329.7 ms, p95 378.9 ms; 609 input tokens per decision; 0 errors.

## Rally (lockstep against the wall)

Rally rate **91.5%**: 75 returns, 7 misses over 1200 decisions (9.3 misses per 100 returns, longest rally 19); the answers matched the rule 83.6% of the time.

| seed | returns | misses | rally rate |
| --- | --- | --- | --- |
| 101 | 19 | 2 | 90.5% |
| 102 | 18 | 3 | 85.7% |
| 103 | 19 | 0 | 100% |
| 104 | 19 | 2 | 90.5% |

## Reproduce

```bash
node bin/pongbench.js run --config typesafe-jev --track reasoning
```

Suites: decisions decisions-v1, rally rally-v1.
