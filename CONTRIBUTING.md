# Contributing

Thank you for helping. PongBench stays small on purpose: Node 18+, no dependencies, one file per concern.

- **Run the checks** before a pull request: `npm test` (about ten seconds, no network, no GPU).
- **A new connector**: add `src/connectors/<name>.js` exporting `create(config, {key, baseDir})` that returns
  `{kind, url, decide({state, questions}, {signal})}`; register it in `src/connectors/index.js` and `src/config.js`
  (`CONNECTORS`), add a config to `configs/`, a section to `docs/CONNECTORS.md`, and a mock-server test to
  `tests/check.mjs`.
- **A provider recipe** (a new hosted endpoint that already speaks System One or OpenAI chat): just a config in
  `configs/` and a section in `docs/CONNECTORS.md`.
- **Results**: run `node bin/pongbench.js run --config <yours>` (full, not `--quick`), and open a pull request with the
  `results/<run>/` folder. Say what hardware or service produced the latency numbers. Never commit keys: configs name
  an environment variable, and `.env` is ignored.
- **The suites are frozen.** A change to the game, the rule, the suite builder or the standard track changes what a
  score means: it needs a new suite version (`decisions-v2`), never an edit to `decisions-v1`.
- Writing style for docs and messages: plain words, short sentences, no em dashes.
