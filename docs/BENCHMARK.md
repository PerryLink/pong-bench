# How PongBench scores a model

PongBench asks a decision model to play the right paddle in Pong, one typed decision at a time: `up`, `down` or
`stay`. It measures two things that do not depend on speed (is each decision right, and does the model survive real
games) and, separately, how it plays in real time where its latency is its reaction time.

## The suites

### Decisions (`decisions-v1`, 900 states)

Fixed decision states, each asked once:

| Kind | States | The right move |
|---|---|---|
| `up` | 300 | up (the ball will arrive more than 5 units above the paddle centre) |
| `down` | 300 | down |
| `away` | 150 | stay (the ball is moving away) |
| `covered` | 150 | stay (the paddle is already within 5 units) |

How they were made: games are played with the upstream engine from fixed seeds, by a paddle that follows the rule only
60% of the time (so it is often off target and every distance comes up); the states are shuffled with a fixed seed and
the first 300 / 300 / 150 / 150 of each kind are kept. Duplicates are dropped, and so are states where the rule points
into a wall the paddle already touches (there, `stay` is as good as the rule's move, so they would not test anything).
The suite is frozen in [`suites/decisions-v1.json`](../suites/decisions-v1.json) with a SHA-256 of its items that every
run checks; `node bin/pongbench.js suites --build` rebuilds it byte for byte.

**Reported:** accuracy per move (up, down, stay) and their mean, the **macro accuracy** (the headline: a model that
always says `stay` gets 33.3%, not 33% weighted toward the most common answer); accuracy in the hard bands (the ball
arriving 5 to 8, 8 to 12, or 12 and more units off centre when a move is needed); the top and bottom edges; the
confusion matrix; calibration (Brier score, log loss, expected calibration error) when the endpoint returns real
probabilities; latency; tokens.

### Rally (`rally-v1`, 1,200 decisions)

Four lockstep matches (seeds 101 to 104, 300 decisions each) against a wall that never misses. This is the upstream
mechanic: **one decision moves the ball one step**, so the game is the same whatever the model's speed. Every point
lost is the model's.

**Reported:** the **rally rate**, returns / (returns + misses); misses per 100 returns; the longest rally; how often the
answers matched the rule during play.

The rally checks something the decisions suite cannot: whether a model's mistakes cost points. A model that hesitates
near the tolerance can be wrong 12% of the time and never miss (the paddle still covers the ball), while one that is
wrong 10% of the time at random misses 8 times per 100 returns (see the baselines).

### Arena (real time, optional)

Games against bots on a clock (a served ball crosses the court in 1.6 s and speeds up 5% per hit, first to 5 points,
at most 150 s). The model steers its paddle with its latest answer, so a model that answers in 30 ms reacts 30 ms after
the state it saw and one that answers in 800 ms reacts much later. Physics is advanced to the moment each state is sent
and each answer lands; an answer about a rally that has already ended is dropped.

**Reported:** points won, per bot; decisions per second; reaction time. **Arena depends on hardware and network**, so
it is never part of the headline score. Bots: Easy (220 ms late, aim off by up to 9), Medium (140 ms, 6), Hard (70 ms,
3), Perfect (never misses).

## The score

```
PongBench score = (decisions macro accuracy + rally rate) / 2
```

Both halves are percentages and speed-independent, so the score is comparable across a hosted API, a local GPU and a
CPU. It is reported per **track**:

| Track | What changes | Why |
|---|---|---|
| `standard` | decisio's own prompt and full state | **the official track**, comparable with the original demo |
| `compact` | the same rule in half the words, only the needed fields | prompt sensitivity |
| `minimal` | one line of instructions | how much the model needs to be told |
| `reasoning` | no interceptY: ball position and velocity only | the model must work out the bounce: the hard track |

## Reference results (2026-10-10)

Generated from `results/*/scorecard.json` by `node tools/results-table.mjs`. Baselines (in italics) are scripted players that show the range: a perfect player, random, a player that never moves.

<!-- results:start -->
| Model | Track | Score | Decisions (macro) | up | down | stay | Rally rate | Misses | Probabilities | p50 latency |
|---|---|---|---|---|---|---|---|---|---|---|
| Jev (TypeSafe) | compact | **99.8** | 99.67% | 100% | 100% | 99% | 100% | 0 | yes | 330.1 ms |
| Jev (TypeSafe) | minimal | **98.9** | 97.78% | 100% | 100% | 93.3% | 100% | 0 | yes | 330.2 ms |
| Jev (TypeSafe) | standard | **98.6** | 97.22% | 99.3% | 92.7% | 99.7% | 100% | 0 | yes | 330 ms |
| H2O-Lightning-4B (local GPU) | compact | **95.8** | 91.67% | 81.3% | 94.7% | 99% | 100% | 0 | yes | – |
| Jev (TypeSafe) | reasoning | **85.3** | 79% | 75% | 72.7% | 89.3% | 91.5% | 7 | yes | 329.7 ms |
| H2O-Lightning-4B (local GPU) | standard | **84.7** | 80.44% | 76.3% | 76% | 89% | 89% | 9 | yes | – |
| H2O-Lightning-4B (local GPU) | minimal | **72.3** | 78.22% | 47.3% | 100% | 87.3% | 66.3% | 34 | yes | – |
| H2O-Lightning-4B (local GPU) | reasoning | **49.4** | 48.44% | 27% | 24.7% | 93.7% | 50.4% | 60 | yes | – |
| Qwen3.5-4B (transformers server, CPU) | standard (quick) | **30.4** | 38% | 31% | 0% | 83% | 22.7% | 34 | yes | – |
| *Rule oracle (baseline)* | standard | **100** | 100% | 100% | 100% | 100% | 100% | 0 | yes | – |
| *Hesitant oracle (baseline)* | standard | **94** | 88% | 82.7% | 81.3% | 100% | 100% | 0 | yes | – |
| *Noisy oracle 10% (baseline)* | standard | **91.9** | 91.22% | 91.7% | 90.7% | 91.3% | 92.6% | 6 | yes | – |
| *Random (baseline)* | standard | **30.2** | 33.22% | 30.3% | 34% | 35.3% | 27.2% | 123 | yes | – |
| *Always stay (baseline)* | standard | **28.1** | 33.33% | 0% | 0% | 100% | 22.8% | 139 | yes | – |
<!-- results:end -->

The live table, with every run and its scorecard, is [`results/LEADERBOARD.md`](../results/LEADERBOARD.md).
Jev's latency was measured from India to TypeSafe's hosted API; the local runs publish no timing.

## Rules for a result

- Full runs only (`--quick` runs are for trying a setup and are kept off the leaderboard), on the current suites
  (the scorecard records their hashes), one of the four tracks, the official stay tolerance (5), and under 1% failed
  calls. The leaderboard checks all of this and shows the **latest** such run per model and track, not the best one:
  re-running a sampled model until it gets lucky does not pay.
- The model sees only the request: no access to the rule, the suite file, or earlier answers. Caching answers across
  requests is not allowed.
- Official results use the plain top answer (`--stay-bias 0`, the default). Reading the probabilities differently is
  allowed for exploration and is recorded in the scorecard, which is then not comparable.
- A config may set any decoding the endpoint offers (temperature, reasoning effort, provider routing): it is saved, keys
  removed, with the result.
- Report the hardware or service and where it was measured from: latency means nothing without it.

## What PongBench does not tell you

- **Rally saturates for strong models.** Jev and the hesitant baseline both reach 100% on the standard track: a model
  that is right most of the time survives the wall. The decisions suite does the ranking among strong models, and the
  reasoning track has the headroom (Jev drops to 79% macro and 91.5% rally there).
- **Calibration needs probabilities.** Chat models without logprobs answer one-hot; their Brier score and ECE are not
  measured, and the scorecard says so.
- **Arena is a property of the setup**, not only the model: the same model is slower over a far network or on a busy
  GPU.
- **One game, one skill.** PongBench measures reading a small numeric state and choosing an action under a stated
  rule. It is not a general reasoning benchmark.

## Versions

A suite never changes after release. A change to the engine, the rule, the suite builder or the standard track's text
makes a new version (`decisions-v2`), and results on different versions are not compared. Each scorecard records the
suite versions and the SHA-256 of the decisions suite it ran.
