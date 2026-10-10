# Results

Every run writes a folder here: `scorecard.md` (read this), `scorecard.json` (every number, the config without keys,
the suite versions and hashes) and `decisions.jsonl.gz` (every decision: state, rule, answer, probabilities, timing).
[LEADERBOARD.md](LEADERBOARD.md) is rebuilt after each run: the latest comparable full run per model and track (the
rules are in [docs/BENCHMARK.md](../docs/BENCHMARK.md#rules-for-a-result)). `node tools/rescore.mjs` recomputes saved
runs from their own records if the metrics code changes; it never calls a model.

To add a result to the repository, commit its folder and say in the pull request what hardware or service it ran on
and where from (latency depends on it).

## The reference runs (2026-10-10)

| Model | Where it ran | Measured from |
|---|---|---|
| Jev (TypeSafe), `jev-latest` | TypeSafe's hosted API ([`configs/typesafe-jev.json`](../configs/typesafe-jev.json)), 8 requests in flight | India |
| H2O-Lightning-4B | a local System One server (not part of this repository) on a laptop GPU, MXFP8 weights, one request at a time | the same laptop, in its maximum (manual) power mode |
| baselines | the `mock` connector, in process | |

Scores do not depend on speed. To publish a result without its timing, run
`node tools/strip-timing.mjs <run-id> [--label "..."] [--note "..."]`: it removes latency, decisions per second, the
run's duration and every per-decision time, and leaves the score as it was.
