# PongBench scorecard: Qwen3.5-4B (transformers server, CPU)

- Model: `Qwen3.5-4B` via the openai connector (http://127.0.0.1:8001/v1/chat/completions)
- Track: standard (Standard), quick run; tolerance 5; stay handicap off
- Run: 2026-10-10T01:52:33.322Z, timing not published, 600 calls, 0 errors; PongBench 1.0.0

## PongBench score: 30.4

The mean of decision accuracy (macro over up, down and stay) and rally rate. Both are independent of speed.

## Decisions

|  | right | accuracy |
| --- | --- | --- |
| up | 31 / 100 | 31% |
| down | 0 / 100 | 0% |
| stay | 83 / 100 | 83% |
| **macro** |  | **38%** |

Where it matters:

| slice | right | accuracy |
| --- | --- | --- |
| move needed, ball arrives 5-8 units off centre | 4 / 23 | 17.4% |
| move needed, ball arrives 8-12 units off centre | 9 / 41 | 22% |
| move needed, ball arrives 12+ units off centre | 18 / 136 | 13.2% |
| up toward the top edge (interceptY < 10) | 3 / 15 | 20% |
| down toward the bottom edge (interceptY > 90) | 0 / 7 | 0% |
| ball moving away | 50 / 50 | 100% |
| paddle already covers it | 33 / 50 | 66% |

Confusion (rows: the rule; columns: the answer):

|  | up | down | stay | error |
| --- | --- | --- | --- | --- |
| up | 31 | 0 | 69 | 0 |
| down | 65 | 0 | 35 | 0 |
| stay | 17 | 0 | 83 | 0 |

Calibration (the model's own probabilities): Brier 0.6623, log loss 1.1021, ECE 0.2502.

Latency: not published for this run; 360 input tokens per decision; 0 errors.

## Rally (lockstep against the wall)

Rally rate **22.7%**: 10 returns, 34 misses over 300 decisions (340 misses per 100 returns, longest rally 2); the answers matched the rule 39.7% of the time.

| seed | returns | misses | rally rate |
| --- | --- | --- | --- |
| 101 | 6 | 13 | 31.6% |
| 102 | 4 | 21 | 16% |

## Reproduce

```bash
node bin/pongbench.js run --config hf-local --track standard --quick
```

Suites: decisions decisions-v1-quick, rally rally-v1-quick.
