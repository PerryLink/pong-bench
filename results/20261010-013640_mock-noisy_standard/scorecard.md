# PongBench scorecard: Noisy oracle 10% (baseline)

- Model: `-` via the mock connector (mock:noisy)
- Track: standard (Standard); tolerance 5; stay handicap off
- Run: 2026-10-10T01:36:40.510Z, 0 s, 2100 calls, 0 errors; PongBench 1.0.0

## PongBench score: 91.9

The mean of decision accuracy (macro over up, down and stay) and rally rate. Both are independent of speed.

## Decisions

|  | right | accuracy |
| --- | --- | --- |
| up | 275 / 300 | 91.7% |
| down | 272 / 300 | 90.7% |
| stay | 274 / 300 | 91.3% |
| **macro** |  | **91.22%** |

Where it matters:

| slice | right | accuracy |
| --- | --- | --- |
| move needed, ball arrives 5-8 units off centre | 83 / 91 | 91.2% |
| move needed, ball arrives 8-12 units off centre | 87 / 96 | 90.6% |
| move needed, ball arrives 12+ units off centre | 377 / 413 | 91.3% |
| up toward the top edge (interceptY < 10) | 35 / 37 | 94.6% |
| down toward the bottom edge (interceptY > 90) | 13 / 16 | 81.3% |
| ball moving away | 134 / 150 | 89.3% |
| paddle already covers it | 140 / 150 | 93.3% |

Confusion (rows: the rule; columns: the answer):

|  | up | down | stay | error |
| --- | --- | --- | --- | --- |
| up | 275 | 14 | 11 | 0 |
| down | 17 | 272 | 11 | 0 |
| stay | 13 | 13 | 274 | 0 |

Calibration (the model's own probabilities): Brier 0.1642, log loss 0.3591, ECE 0.0122.

Latency: p50 0 ms, p95 0 ms; 0 input tokens per decision; 0 errors.

## Rally (lockstep against the wall)

Rally rate **92.6%**: 75 returns, 6 misses over 1200 decisions (8 misses per 100 returns, longest rally 19); the answers matched the rule 88.8% of the time.

| seed | returns | misses | rally rate |
| --- | --- | --- | --- |
| 101 | 19 | 2 | 90.5% |
| 102 | 19 | 1 | 95% |
| 103 | 19 | 0 | 100% |
| 104 | 18 | 3 | 85.7% |

## Reproduce

```bash
node bin/pongbench.js run --config mock-noisy --track standard
```

Suites: decisions decisions-v1, rally rally-v1.
