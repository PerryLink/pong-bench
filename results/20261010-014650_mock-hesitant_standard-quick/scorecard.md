# PongBench scorecard: Hesitant oracle (baseline)

- Model: `-` via the mock connector (mock:hesitant)
- Track: standard (Standard), quick run; tolerance 5; stay handicap off
- Run: 2026-10-10T01:46:50.838Z, 0 s, 600 calls, 0 errors; PongBench 1.0.0

## PongBench score: 93.2

The mean of decision accuracy (macro over up, down and stay) and rally rate. Both are independent of speed.

## Decisions

|  | right | accuracy |
| --- | --- | --- |
| up | 77 / 100 | 77% |
| down | 82 / 100 | 82% |
| stay | 100 / 100 | 100% |
| **macro** |  | **86.33%** |

Where it matters:

| slice | right | accuracy |
| --- | --- | --- |
| move needed, ball arrives 5-8 units off centre | 7 / 23 | 30.4% |
| move needed, ball arrives 8-12 units off centre | 16 / 41 | 39% |
| move needed, ball arrives 12+ units off centre | 136 / 136 | 100% |
| up toward the top edge (interceptY < 10) | 15 / 15 | 100% |
| down toward the bottom edge (interceptY > 90) | 7 / 7 | 100% |
| ball moving away | 50 / 50 | 100% |
| paddle already covers it | 50 / 50 | 100% |

Confusion (rows: the rule; columns: the answer):

|  | up | down | stay | error |
| --- | --- | --- | --- | --- |
| up | 77 | 0 | 23 | 0 |
| down | 0 | 82 | 18 | 0 |
| stay | 0 | 0 | 100 | 0 |

Calibration (the model's own probabilities): Brier 0.2473, log loss 0.5004, ECE 0.0367.

Latency: p50 0 ms, p95 0 ms; 0 input tokens per decision; 0 errors.

## Rally (lockstep against the wall)

Rally rate **100%**: 20 returns, 0 misses over 300 decisions (0 misses per 100 returns, longest rally 10); the answers matched the rule 95% of the time.

| seed | returns | misses | rally rate |
| --- | --- | --- | --- |
| 101 | 10 | 0 | 100% |
| 102 | 10 | 0 | 100% |

## Reproduce

```bash
node bin/pongbench.js run --config mock-hesitant --track standard --quick
```

Suites: decisions decisions-v1-quick, rally rally-v1-quick.
