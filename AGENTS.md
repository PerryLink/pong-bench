# Setting up PongBench for a model (instructions for coding agents)

You are setting up PongBench, a game benchmark for decision models, so that the user's model can be checked, benchmarked
and played against. Follow these steps in order. Each step says how to verify it. Do not skip the check in step 4.

**Ground rules**
- Never write an API key into any file you create or edit except `.env` (which is git-ignored), and never print one.
  Configs name an environment variable (`apiKeyEnv`) instead.
- Never edit `suites/`, `src/game/engine.js`, `src/game/prompts.js` (the tracks) or `src/bench/metrics.js`: they define
  what a score means. To try a different prompt, use a prompt file (step 6) instead.
- Runs call the user's endpoint many times (a full run is about 2,100 calls). Tell the user the count before a full run
  on a paid API, and start with `--quick` (600 calls).
- Docs to read when needed: `docs/CONNECTORS.md` (every endpoint type), `docs/SPEC.md` (the request and answer),
  `docs/BENCHMARK.md` (the suites and the score).

## 1. Check the tools

```bash
node --version        # must be 18.17 or newer
npm test              # about ten seconds; must end with "all ... checks passed"
```

No `npm install` is needed. (Only for Claude models: `npm install @anthropic-ai/sdk`.)

## 2. Find out what kind of endpoint the model has

Ask the user if it is not clear from context. Pick the first row that fits:

| The model is ... | Connector | Start from |
|---|---|---|
| served over `POST /v1/systemone` (TypeSafe Jev, Databricks, Cloudflare Clef, Ollama 0.35+ decision models, Ollajev, a decision model's own server) | `systemone` | `configs/typesafe-jev.json`, `configs/systemone-local.json`, `configs/databricks-systemone.json`, `configs/cloudflare-clef.json`, `configs/ollama-systemone.json` |
| an OpenAI-compatible chat API (OpenAI, Azure OpenAI, OpenRouter, Gemini, Groq, Together, vLLM, SGLang, llama.cpp, LM Studio, Ollama chat) | `openai` | `configs/openai.json`, `configs/azure-openai.json`, `configs/openrouter.json`, `configs/vllm.json`, ... |
| a Claude model | `anthropic` | `configs/anthropic.json` |
| open weights on disk or on Hugging Face, with no server yet | start a server: `python examples/python/hf_server.py --model <id or folder>` (`python3` on macOS and Linux; needs `pip install torch transformers`; it picks CUDA, Apple's MPS or the CPU by itself), then `openai` | `configs/hf-local.json` (or `configs/hf-local-systemone.json`) |
| code the user writes (an SDK, a local process, anything) | `module` | `configs/custom-module.json` and `examples/custom-connector.mjs` |

## 3. Write the config

Copy the closest example to `configs/<short-name>.json` and fill in the URL, the model id and `apiKeyEnv`. Set `name`
to how the model should appear in results (for example `"Qwen3-8B (vLLM, RTX 4090)"`). If the user has the key, put it
in `.env` as `NAME=value` (one line; this works the same on Windows, macOS and Linux), or ask them to set it in their
shell (`export NAME=...` in bash or zsh, `$env:NAME="..."` in PowerShell).

Verify: `node bin/pongbench.js configs` lists it, with `key found` (or `not needed`).

## 4. Check the endpoint

```bash
node bin/pongbench.js check --config <short-name>
```

Expected: four rows (up, down, away, covered), each with an answer, a latency and probabilities, and the line
`The endpoint works`. If a row says ERROR, fix it using the table at the end of `docs/CONNECTORS.md` (401: the key or
`auth` style; 404: the URL path; 422: read the printed detail; "could not reach": the server is not running). A
model that answers with `(one-hot)` probabilities is fine: it just has no calibration numbers. A chat model that
answers with something other than up, down or stay: set `"answer": "json"`, or `"text"` with a larger `maxTokens`.

## 5. Run the benchmark

```bash
node bin/pongbench.js run --config <short-name> --quick          # 600 calls: a smoke run, timing estimate
node bin/pongbench.js run --config <short-name>                  # the full run: 2,100 calls, the official track
```

Useful options: `--concurrency 8` for hosted APIs that allow parallel requests (keep 1 for a single local GPU);
`--track compact|minimal|reasoning` for the other tracks; `--suites decisions,rally,arena` to add real-time games
(they depend on latency). The run ends with `PongBench score: <n>` and the path of the scorecard.

## 6. (Optional) Try a different prompt

Save a prompt as JSON (shape in `docs/PROMPTS.md`) and run with `--prompt my-prompt.json`. It is recorded as track
`custom`, so it never mixes with the official results. The app's Prompt lab does the same interactively.

## 7. Report to the user

Read `results/<run>/scorecard.md` and tell the user: the PongBench score; decisions macro accuracy with up, down and
stay; the rally rate and misses; the weak spots the scorecard shows (the 5 to 8 unit band, the edges, a confusion
pattern such as "stay" instead of "up"); latency and errors. Point them to `results/LEADERBOARD.md` for comparison with
the reference models.

## 8. (Optional) Open the app

```bash
node bin/pongbench.js serve --config <short-name>      # http://127.0.0.1:8800
```

Play against the model, watch it play, run the benchmark from the Bench tab, tune prompts in the Prompt lab.

## Definition of done

- [ ] `npm test` passes.
- [ ] `configs/<short-name>.json` exists, holds no key, and `configs` shows its key as found or not needed.
- [ ] `check` shows four answers and "The endpoint works".
- [ ] A full run finished, and its `results/<run>/scorecard.md` exists.
- [ ] The user has the score and the weak spots, in plain words.
