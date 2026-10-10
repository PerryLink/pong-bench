# PongBench scorecard: Always stay (baseline)

- Model: `-` via the mock connector (mock:stay)
- Track: standard (Standard); tolerance 5; stay handicap off
- Run: 2026-10-10T01:36:40.397Z, 0 s, 2100 calls, 0 errors; PongBench 1.0.0

## PongBench score: 28.1

The mean of decision accuracy (macro over up, down and stay) and rally rate. Both are independent of speed.

## Decisions

|  | right | accuracy |
| --- | --- | --- |
| up | 0 / 300 | 0% |
| down | 0 / 300 | 0% |
| stay | 300 / 300 | 100% |
| **macro** |  | **33.33%** |

Where it matters:

| slice | right | accuracy |
| --- | --- | --- |
| move needed, ball arrives 5-8 units off centre | 0 / 91 | 0% |
| move needed, ball arrives 8-12 units off centre | 0 / 96 | 0% |
| move needed, ball arrives 12+ units off centre | 0 / 413 | 0% |
| up toward the top edge (interceptY < 10) | 0 / 37 | 0% |
| down toward the bottom edge (interceptY > 90) | 0 / 16 | 0% |
| ball moving away | 150 / 150 | 100% |
| paddle already covers it | 150 / 150 | 100% |

Confusion (rows: the rule; columns: the answer):

|  | up | down | stay | error |
| --- | --- | --- | --- | --- |
| up | 0 | 0 | 300 | 0 |
| down | 0 | 0 | 300 | 0 |
| stay | 0 | 0 | 300 | 0 |

Calibration (the model's own probabilities): Brier 1.1483, log loss 2.0323, ECE 0.5667.

Latency: p50 0 ms, p95 0 ms; 0 input tokens per decision; 0 errors.

## Rally (lockstep against the wall)

Rally rate **22.8%**: 41 returns, 139 misses over 1200 decisions (339 misses per 100 returns, longest rally 3); the answers matched the rule 33% of the time.

| seed | returns | misses | rally rate |
| --- | --- | --- | --- |
| 101 | 12 | 27 | 30.8% |
| 102 | 10 | 35 | 22.2% |
| 103 | 7 | 47 | 13% |
| 104 | 12 | 30 | 28.6% |

## Reproduce

```bash
node bin/pongbench.js run --config mock-stay --track standard
```

Suites: decisions decisions-v1, rally rally-v1.
