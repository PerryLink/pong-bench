# PongBench scorecard: H2O-Lightning-4B (local GPU)

- Model: `h2o-lightning-4b` via the systemone connector (http://127.0.0.1:8798/v1/systemone)
- Track: compact (Compact); tolerance 5; stay handicap off
- Run: 2026-10-10T02:00:11.429Z, 221.5 s, 2100 calls, 0 errors; PongBench 1.0.0

## PongBench score: 95.8

The mean of decision accuracy (macro over up, down and stay) and rally rate. Both are independent of speed.

## Decisions

|  | right | accuracy |
| --- | --- | --- |
| up | 244 / 300 | 81.3% |
| down | 284 / 300 | 94.7% |
| stay | 297 / 300 | 99% |
| **macro** |  | **91.67%** |

Where it matters:

| slice | right | accuracy |
| --- | --- | --- |
| move needed, ball arrives 5-8 units off centre | 37 / 91 | 40.7% |
| move needed, ball arrives 8-12 units off centre | 89 / 96 | 92.7% |
| move needed, ball arrives 12+ units off centre | 402 / 413 | 97.3% |
| up toward the top edge (interceptY < 10) | 27 / 37 | 73% |
| down toward the bottom edge (interceptY > 90) | 16 / 16 | 100% |
| ball moving away | 150 / 150 | 100% |
| paddle already covers it | 147 / 150 | 98% |

Confusion (rows: the rule; columns: the answer):

|  | up | down | stay | error |
| --- | --- | --- | --- | --- |
| up | 244 | 0 | 56 | 0 |
| down | 0 | 284 | 16 | 0 |
| stay | 0 | 3 | 297 | 0 |

Calibration (the model's own probabilities): Brier 0.2199, log loss 0.4392, ECE 0.2343.

Latency: p50 106.7 ms, p95 114.6 ms; 0 errors.

## Rally (lockstep against the wall)

Rally rate **100%**: 76 returns, 0 misses over 1200 decisions (0 misses per 100 returns, longest rally 19); the answers matched the rule 93.9% of the time.

| seed | returns | misses | rally rate |
| --- | --- | --- | --- |
| 101 | 19 | 0 | 100% |
| 102 | 19 | 0 | 100% |
| 103 | 19 | 0 | 100% |
| 104 | 19 | 0 | 100% |

## Reproduce

```bash
node bin/pongbench.js run --config h2o-lightning-local --track compact
```

Suites: decisions decisions-v1, rally rally-v1.
