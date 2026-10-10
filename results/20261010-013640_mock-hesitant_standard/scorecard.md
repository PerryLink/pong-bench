# PongBench scorecard: Hesitant oracle (baseline)

- Model: `-` via the mock connector (mock:hesitant)
- Track: standard (Standard); tolerance 5; stay handicap off
- Run: 2026-10-10T01:36:40.644Z, 0 s, 2100 calls, 0 errors; PongBench 1.0.0

## PongBench score: 94

The mean of decision accuracy (macro over up, down and stay) and rally rate. Both are independent of speed.

## Decisions

|  | right | accuracy |
| --- | --- | --- |
| up | 248 / 300 | 82.7% |
| down | 244 / 300 | 81.3% |
| stay | 300 / 300 | 100% |
| **macro** |  | **88%** |

Where it matters:

| slice | right | accuracy |
| --- | --- | --- |
| move needed, ball arrives 5-8 units off centre | 35 / 91 | 38.5% |
| move needed, ball arrives 8-12 units off centre | 44 / 96 | 45.8% |
| move needed, ball arrives 12+ units off centre | 413 / 413 | 100% |
| up toward the top edge (interceptY < 10) | 37 / 37 | 100% |
| down toward the bottom edge (interceptY > 90) | 16 / 16 | 100% |
| ball moving away | 150 / 150 | 100% |
| paddle already covers it | 150 / 150 | 100% |

Confusion (rows: the rule; columns: the answer):

|  | up | down | stay | error |
| --- | --- | --- | --- | --- |
| up | 248 | 0 | 52 | 0 |
| down | 0 | 244 | 56 | 0 |
| stay | 0 | 0 | 300 | 0 |

Calibration (the model's own probabilities): Brier 0.219, log loss 0.4522, ECE 0.02.

Latency: p50 0 ms, p95 0 ms; 0 input tokens per decision; 0 errors.

## Rally (lockstep against the wall)

Rally rate **100%**: 76 returns, 0 misses over 1200 decisions (0 misses per 100 returns, longest rally 19); the answers matched the rule 93.6% of the time.

| seed | returns | misses | rally rate |
| --- | --- | --- | --- |
| 101 | 19 | 0 | 100% |
| 102 | 19 | 0 | 100% |
| 103 | 19 | 0 | 100% |
| 104 | 19 | 0 | 100% |

## Reproduce

```bash
node bin/pongbench.js run --config mock-hesitant --track standard
```

Suites: decisions decisions-v1, rally rally-v1.
