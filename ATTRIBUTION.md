# Attribution

PongBench builds on the Pong demo of **decisio v0.10.0**
(<https://github.com/aminry/decisio/tree/v0.10.0/examples/demos/pong>), which is itself a modified copy of **jev-pong** by
Ably Labs (<https://github.com/ably-labs/jev-pong>, commit `d28d6ae34508e0a6aed0b6c4b93f963e650feb4e`). Both are under the
Apache License 2.0; the unmodified licence text is in [`LICENSE`](LICENSE).

| File here | Upstream | What changed |
|---|---|---|
| `src/game/engine.js` | `examples/demos/pong/lib/game/engine.ts` | plain JavaScript, line for line; the rules, constants and seeded serve are unchanged |
| `src/game/prompts.js` (the `standard` track) | `examples/demos/pong/lib/decide/prompt.ts` | plain JavaScript, the default variant only, the tolerance as a parameter; the instructions and criteria text are word for word. The other tracks are PongBench's own |

Each of these files says so in its header. Everything else (the real-time game, the connectors, the benchmark suites,
runner and scoring, the server, the app, the examples and the docs) was written for PongBench. The chat prompt layout
used for chat models follows decisio's `examples/demos/tools/systemone_gateway.py` (render_chat); no code was copied.
