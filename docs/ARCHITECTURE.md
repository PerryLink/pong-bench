# Architecture

PongBench is Node 18+ with no dependencies. One codebase serves three uses: the command-line runner, the app's
server, and the page (which imports the same game modules the runner uses).

```
bin/pongbench.js            the command line: check, run, serve, configs, suites, leaderboard
src/
  config.js                 configs/*.json, keys from env or files, .env, nothing secret in public copies
  game/                     shared by Node and the browser (served at /game/)
    engine.js               the upstream lockstep engine (decisio v0.10.0, line for line)
    realtime.js             the real-time game: a clock, fixed 1/240 s physics steps, bots
    prompts.js              tracks and prompts as data; the rule; pickMove
    stats.js                percentiles, rolling rates
  connectors/               one door per kind of model; each returns {choice, probs, probSource, usage}
    systemone.js openai.js anthropic.js mock.js module.js common.js index.js
  bench/
    suites.js               decisions-v1 (built from seeds, frozen, hashed), rally-v1
    matches.js              rally (lockstep) and arena (real time) players
    metrics.js              every number in a scorecard
    runner.js               runBench(): suites in order, a bounded pool of requests, events, saveRun()
    report.js               scorecard.md, LEADERBOARD.md
  server/
    server.js               static files, /ws decisions, /api/... (bench, results, games, recordings, store)
    ws.js                   a small RFC 6455 WebSocket endpoint
web/                        the app: app.js (views, game loop), bench.js, lab.js, hud.js, draw.js, driver.js, ...
suites/                     the frozen test material
configs/                    one JSON per endpoint
results/                    scorecards (commit them), LEADERBOARD.md
examples/                   servers and a custom connector
tests/check.mjs             npm test
```

## A decision, end to end

1. A **state** comes from a game: `engine.toDecisionState` (lockstep) or `realtime.decisionState` (real time), or from
   the frozen suite.
2. The **track** turns it into the request: `stateOf(prompt, ds)` picks the fields, `questionOf(prompt)` fills the
   text.
3. The **connector** sends it (System One as is; chat models get the rendered chat prompt) and returns the move and
   probabilities. Retries with backoff on 429 and 5xx; timeouts; call counters; an optional budget.
4. The **runner** scores it against `expectedMove(ds)` (the rule), and the game applies the move. Nothing else moves
   the model's paddle.

## The page and the server

The page sends `{id, state, questions}` over `/ws`; the server calls the active connector and answers `{id, choice,
probs, probSource, ms, usage}`. Keys stay in the server process. The Bench tab posts to `/api/bench/start`, and the
server runs `runBench()` with the active connector, pushing progress on `/api/bench/events` (Server-Sent Events).

## Determinism

The suites, the rally seeds, the mock players and the arena bots are seeded. A deterministic endpoint gives the same
Decisions and Rally scores on every run; Arena depends on timing.
