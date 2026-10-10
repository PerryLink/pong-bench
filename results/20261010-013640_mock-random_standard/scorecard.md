# PongBench scorecard: Random (baseline)

- Model: `-` via the mock connector (mock:random)
- Track: standard (Standard); tolerance 5; stay handicap off
- Run: 2026-10-10T01:36:40.266Z, 0 s, 2100 calls, 0 errors; PongBench 1.0.0

## PongBench score: 30.2

The mean of decision accuracy (macro over up, down and stay) and rally rate. Both are independent of speed.

## Decisions

|  | right | accuracy |
| --- | --- | --- |
| up | 91 / 300 | 30.3% |
| down | 102 / 300 | 34% |
| stay | 106 / 300 | 35.3% |
| **macro** |  | **33.22%** |

Where it matters:

| slice | right | accuracy |
| --- | --- | --- |
| move needed, ball arrives 5-8 units off centre | 29 / 91 | 31.9% |
| move needed, ball arrives 8-12 units off centre | 29 / 96 | 30.2% |
| move needed, ball arrives 12+ units off centre | 135 / 413 | 32.7% |
| up toward the top edge (interceptY < 10) | 16 / 37 | 43.2% |
| down toward the bottom edge (interceptY > 90) | 3 / 16 | 18.8% |
| ball moving away | 55 / 150 | 36.7% |
| paddle already covers it | 51 / 150 | 34% |

Confusion (rows: the rule; columns: the answer):

|  | up | down | stay | error |
| --- | --- | --- | --- | --- |
| up | 91 | 98 | 111 | 0 |
| down | 90 | 102 | 108 | 0 |
| stay | 89 | 105 | 106 | 0 |

Calibration (the model's own probabilities): Brier 0.6667, log loss 1.0986, ECE 0.0011.

Latency: p50 0 ms, p95 0 ms; 0 input tokens per decision; 0 errors.

## Rally (lockstep against the wall)

Rally rate **27.2%**: 46 returns, 123 misses over 1200 decisions (267.4 misses per 100 returns, longest rally 4); the answers matched the rule 36.2% of the time.

| seed | returns | misses | rally rate |
| --- | --- | --- | --- |
| 101 | 12 | 29 | 29.3% |
| 102 | 13 | 25 | 34.2% |
| 103 | 11 | 31 | 26.2% |
| 104 | 10 | 38 | 20.8% |

## Reproduce

```bash
node bin/pongbench.js run --config mock-random --track standard
```

Suites: decisions decisions-v1, rally rally-v1.
