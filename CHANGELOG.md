# Changelog

## 1.0.0 (2026-10-10)

First release.

- Suites: `decisions-v1` (900 frozen decision states, SHA-256 checked), `rally-v1` (lockstep matches on four seeds,
  1,200 decisions), `arena` (real-time games against bots).
- Tracks: `standard` (decisio's prompt, official), `compact`, `minimal`, `reasoning`.
- Connectors: `systemone` (TypeSafe, Databricks, Cloudflare Workers AI, Ollama, local servers), `openai` (OpenAI, Azure,
  OpenRouter, Gemini, vLLM, llama.cpp, LM Studio, Ollama; logprobs or text or JSON), `anthropic` (official SDK, optional),
  `mock` (baselines), `module` (your own JavaScript).
- The app: Play, Bot match, Watch, Bench, Prompt lab, Replays; every game logged; live metrics.
- Examples: a Python System One template, a transformers server for any open-weight model (System One and OpenAI routes,
  probabilities from logits), a Node mock System One server, a custom connector.
- The leaderboard ranks comparable runs only (current suites, a built-in track, no stay bias, tolerance 5, under 1%
  failed calls) and shows the latest per model and track. `tools/rescore.mjs` recomputes saved runs from their records.
- The app refuses requests from other websites (Host, Origin and content-type checks; WebSockets too), picks configs by
  name only, and never shows a key: keys must be one printable line, are redacted from provider errors, and key-like URL
  parameters are masked wherever a config is shown or saved.
- Runs on Windows, macOS and Linux: launchers for each (`Start-PongBench.bat`, `Start-PongBench.command`,
  `start-pongbench.sh`), `serve --open` with the system's own opener, LF line endings, a test that every import and
  link matches its file name's case, and CI on all three systems with Node 18, 20 and 22. The transformers server picks
  CUDA, Apple's MPS or the CPU by itself.
- Tools: `results-table.mjs` (the README table), `rescore.mjs`, `strip-timing.mjs` (publish a run without its latency),
  `screenshot.mjs`.
- Reference results: baselines, Jev (TypeSafe) and H2O-Lightning-4B on all four tracks. H2O-Lightning was run in two
  power modes; all 8,400 decisions were identical.
