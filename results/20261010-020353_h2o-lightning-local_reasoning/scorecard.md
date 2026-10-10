# PongBench scorecard: H2O-Lightning-4B (local GPU)

- Model: `h2o-lightning-4b` via the systemone connector (http://127.0.0.1:8798/v1/systemone)
- Track: reasoning (Reasoning); tolerance 5; stay handicap off
- Run: 2026-10-10T02:03:53.077Z, 343 s, 2100 calls, 0 errors; PongBench 1.0.0

## PongBench score: 49.4

The mean of decision accuracy (macro over up, down and stay) and rally rate. Both are independent of speed.

## Decisions

|  | right | accuracy |
| --- | --- | --- |
| up | 81 / 300 | 27% |
| down | 74 / 300 | 24.7% |
| stay | 281 / 300 | 93.7% |
| **macro** |  | **48.44%** |

Where it matters:

| slice | right | accuracy |
| --- | --- | --- |
| move needed, ball arrives 5-8 units off centre | 6 / 91 | 6.6% |
| move needed, ball arrives 8-12 units off centre | 4 / 96 | 4.2% |
| move needed, ball arrives 12+ units off centre | 145 / 413 | 35.1% |
| up toward the top edge (interceptY < 10) | 29 / 37 | 78.4% |
| down toward the bottom edge (interceptY > 90) | 7 / 16 | 43.8% |
| ball moving away | 150 / 150 | 100% |
| paddle already covers it | 131 / 150 | 87.3% |

Confusion (rows: the rule; columns: the answer):

|  | up | down | stay | error |
| --- | --- | --- | --- | --- |
| up | 81 | 2 | 217 | 0 |
| down | 43 | 74 | 183 | 0 |
| stay | 15 | 4 | 281 | 0 |

Calibration (the model's own probabilities): Brier 0.5627, log loss 0.9462, ECE 0.1103.

Latency: p50 163.4 ms, p95 170.9 ms; 0 errors.

## Rally (lockstep against the wall)

Rally rate **50.4%**: 61 returns, 60 misses over 1200 decisions (98.4 misses per 100 returns, longest rally 3); the answers matched the rule 60% of the time.

| seed | returns | misses | rally rate |
| --- | --- | --- | --- |
| 101 | 15 | 16 | 48.4% |
| 102 | 15 | 16 | 48.4% |
| 103 | 15 | 15 | 50% |
| 104 | 16 | 13 | 55.2% |

## Reproduce

```bash
node bin/pongbench.js run --config h2o-lightning-local --track reasoning
```

Suites: decisions decisions-v1, rally rally-v1.
