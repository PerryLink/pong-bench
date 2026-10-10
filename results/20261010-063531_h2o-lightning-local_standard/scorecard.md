# PongBench scorecard: H2O-Lightning-4B (local GPU)

- Model: `h2o-lightning-4b` via the systemone connector (http://127.0.0.1:8798/v1/systemone)
- Track: standard (Standard); tolerance 5; stay handicap off
- Run: 2026-10-10T06:35:31.355Z, 77.4 s, 2100 calls, 0 errors; PongBench 1.0.0

## PongBench score: 84.7

The mean of decision accuracy (macro over up, down and stay) and rally rate. Both are independent of speed.

## Decisions

|  | right | accuracy |
| --- | --- | --- |
| up | 229 / 300 | 76.3% |
| down | 228 / 300 | 76% |
| stay | 267 / 300 | 89% |
| **macro** |  | **80.44%** |

Where it matters:

| slice | right | accuracy |
| --- | --- | --- |
| move needed, ball arrives 5-8 units off centre | 32 / 91 | 35.2% |
| move needed, ball arrives 8-12 units off centre | 50 / 96 | 52.1% |
| move needed, ball arrives 12+ units off centre | 375 / 413 | 90.8% |
| up toward the top edge (interceptY < 10) | 36 / 37 | 97.3% |
| down toward the bottom edge (interceptY > 90) | 15 / 16 | 93.8% |
| ball moving away | 150 / 150 | 100% |
| paddle already covers it | 117 / 150 | 78% |

Confusion (rows: the rule; columns: the answer):

|  | up | down | stay | error |
| --- | --- | --- | --- | --- |
| up | 229 | 3 | 68 | 0 |
| down | 12 | 228 | 60 | 0 |
| stay | 19 | 14 | 267 | 0 |

Calibration (the model's own probabilities): Brier 0.3492, log loss 0.6356, ECE 0.2135.

Latency: p50 36.5 ms, p95 40.4 ms; 0 errors.

## Rally (lockstep against the wall)

Rally rate **89%**: 73 returns, 9 misses over 1200 decisions (12.3 misses per 100 returns, longest rally 19); the answers matched the rule 85.7% of the time.

| seed | returns | misses | rally rate |
| --- | --- | --- | --- |
| 101 | 18 | 3 | 85.7% |
| 102 | 18 | 3 | 85.7% |
| 103 | 18 | 3 | 85.7% |
| 104 | 19 | 0 | 100% |

## Reproduce

```bash
node bin/pongbench.js run --config h2o-lightning-local --track standard
```

Suites: decisions decisions-v1, rally rally-v1.
