# PongBench scorecard: H2O-Lightning-4B (local GPU)

- Model: `h2o-lightning-4b` via the systemone connector (http://127.0.0.1:8798/v1/systemone)
- Track: minimal (Minimal); tolerance 5; stay handicap off
- Run: 2026-10-10T02:09:54.985Z, 134.9 s, 2100 calls, 0 errors; PongBench 1.0.0

## PongBench score: 72.3

The mean of decision accuracy (macro over up, down and stay) and rally rate. Both are independent of speed.

## Decisions

|  | right | accuracy |
| --- | --- | --- |
| up | 142 / 300 | 47.3% |
| down | 300 / 300 | 100% |
| stay | 262 / 300 | 87.3% |
| **macro** |  | **78.22%** |

Where it matters:

| slice | right | accuracy |
| --- | --- | --- |
| move needed, ball arrives 5-8 units off centre | 45 / 91 | 49.5% |
| move needed, ball arrives 8-12 units off centre | 61 / 96 | 63.5% |
| move needed, ball arrives 12+ units off centre | 336 / 413 | 81.4% |
| up toward the top edge (interceptY < 10) | 21 / 37 | 56.8% |
| down toward the bottom edge (interceptY > 90) | 16 / 16 | 100% |
| ball moving away | 150 / 150 | 100% |
| paddle already covers it | 112 / 150 | 74.7% |

Confusion (rows: the rule; columns: the answer):

|  | up | down | stay | error |
| --- | --- | --- | --- | --- |
| up | 142 | 0 | 158 | 0 |
| down | 0 | 300 | 0 | 0 |
| stay | 0 | 38 | 262 | 0 |

Calibration (the model's own probabilities): Brier 0.267, log loss 0.4757, ECE 0.0924.

Latency: p50 64 ms, p95 69.7 ms; 0 errors.

## Rally (lockstep against the wall)

Rally rate **66.3%**: 67 returns, 34 misses over 1200 decisions (50.7 misses per 100 returns, longest rally 7); the answers matched the rule 72.9% of the time.

| seed | returns | misses | rally rate |
| --- | --- | --- | --- |
| 101 | 17 | 8 | 68% |
| 102 | 17 | 7 | 70.8% |
| 103 | 16 | 11 | 59.3% |
| 104 | 17 | 8 | 68% |

## Reproduce

```bash
node bin/pongbench.js run --config h2o-lightning-local --track minimal
```

Suites: decisions decisions-v1, rally rally-v1.
