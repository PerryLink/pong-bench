# Connecting your model

A model is a small JSON file in `configs/` that names a **connector** and where to reach the model. Keys never go in
it: a config names the environment variable that holds the key (`apiKeyEnv`), or a file (`apiKeyFile`). PongBench also
reads a `.env` file in the repository root (it is git-ignored). A key must be one line of printable characters.
Wherever a config is shown or saved (the app, scorecards), header values and key-like URL parameters (`key`, `token`,
`sig`, ...) are masked, and a key a provider echoes back in an error is replaced by `(key)`.

```bash
node bin/pongbench.js configs                      # every config, and whether its key is found
node bin/pongbench.js check --config <name>        # four decisions: is it wired up right?
node bin/pongbench.js run   --config <name>        # the benchmark
```

| Connector | For | Probabilities |
|---|---|---|
| `systemone` | TypeSafe Jev, Databricks, Cloudflare Workers AI (Clef), Ollama decision models, decisio's gateway, any server speaking `POST /v1/systemone` | the model's own |
| `openai` | OpenAI, Azure OpenAI, OpenRouter, Gemini, Groq, Together, vLLM, SGLang, llama.cpp, LM Studio, Ollama chat models, `examples/python/hf_server.py` | from logprobs when the server gives them, else one-hot |
| `anthropic` | Claude, through Anthropic's official SDK (`npm install @anthropic-ai/sdk`) | one-hot |
| `mock` | built-in baselines (oracle, random, stay, noisy, hesitant, down) | built in |
| `module` | your own JavaScript (call anything) | yours, if you return them |

Common fields: `name` (shown everywhere), `concurrency` (requests in flight in a run, default 4), `timeoutMs`,
`retries` (default 4), `maxCalls` (a hard budget for a run), `note`.

## System One endpoints

### TypeSafe Jev (hosted)

```json
{ "name": "Jev (TypeSafe)", "connector": "systemone", "url": "https://api.typesafe.ai/v1/systemone",
  "model": "jev-latest", "apiKeyEnv": "TYPESAFE_API_KEY", "concurrency": 8 }
```

`jev-latest` points to `jev-1.13.0` (pin the versioned id for comparable results). Pricing on the models page in
October 2026: $0.042 per million input tokens, output free; a full standard run is about 0.9 million tokens.

### Any local or self-hosted System One server

```json
{ "name": "My decision model", "connector": "systemone", "url": "http://127.0.0.1:8000/v1/systemone", "auth": "none" }
```

`url` can also be given as `baseUrl` (PongBench adds `/v1/systemone`), or left out to use `SYSTEM_ONE_BASE_URL` and
`SYSTEM_ONE_API_KEY` (Pydantic AI's convention). Ready-made servers in this repository:

- `examples/python/systemone_server.py`: standard library only; put your model behind `decide()`.
- `examples/python/hf_server.py`: any Hugging Face causal LM, probabilities from its logits (also has an OpenAI route).
- `examples/mock-systemone-server.mjs`: a built-in player behind System One, to test a client.

Open-weight System One models people serve this way include OpenJev, Clef and Clef-flash (Cloudflare), Laya, Von, Kev,
H2O-Lightning and Liquid's d1; local servers include Ollama (0.35+), Ollajev and Ollaya. Check each model's card for
its own server or shim.

### Ollama decision models

```json
{ "name": "Ollama decision model", "connector": "systemone", "url": "http://127.0.0.1:11434/v1/systemone",
  "model": "<the model you pulled>", "auth": "none", "concurrency": 1 }
```

Ollama serves decision models over System One from version 0.35 (choices up to 26 options, which is plenty here).

### Databricks (Unity Gateway)

```json
{ "name": "OpenJev on Databricks", "connector": "systemone",
  "url": "https://<workspace-host>/ai-gateway/typesafe/v1/systemone", "model": "system.ai.openjev-qwen35-4b",
  "auth": "basic", "basicUser": "token", "apiKeyEnv": "DATABRICKS_TOKEN" }
```

HTTP Basic with `token:<DATABRICKS_TOKEN>`; `model` is the fully qualified serving name.

### Cloudflare Workers AI (Clef)

```json
{ "name": "Clef-flash", "connector": "systemone",
  "url": "https://api.cloudflare.com/client/v4/accounts/<account-id>/ai/run/@cf/cloudflare/clef-flash",
  "model": "clef-flash", "apiKeyEnv": "CLOUDFLARE_API_TOKEN" }
```

Workers AI wraps answers in `{"result": ...}`; PongBench unwraps it.

### Other auth

`"auth": "bearer"` (the default when a key is set), `"basic"` (with `basicUser`), `"header"` (the key in the header
named by `authHeader`, e.g. `x-api-key`), or `"none"`. Extra headers: `"headers": {"x-org": "..."}`. Extra request
fields: `"extraBody": {...}`.

## OpenAI-compatible chat endpoints

```json
{ "name": "GPT-4.1 mini", "connector": "openai", "baseUrl": "https://api.openai.com/v1", "model": "gpt-4.1-mini",
  "apiKeyEnv": "OPENAI_API_KEY", "answer": "auto", "maxTokensField": "max_completion_tokens", "concurrency": 8 }
```

| Field | Default | Notes |
|---|---|---|
| `baseUrl` | required | everything before `/chat/completions` |
| `model` | required (except Azure deployment URLs) | |
| `answer` | `auto` | `logprobs`, `json`, `text`, or `auto` (logprobs, switching to text by itself if the server rejects or ignores them) |
| `temperature` | `0` | `null` leaves it out (reasoning models reject it) |
| `maxTokens` / `maxTokensField` | 4 (20 for json) / `max_tokens` | OpenAI's newer models want `max_completion_tokens` |
| `topLogprobs` | 10 | |
| `auth` | `bearer` | `api-key` for Azure, `none` for local servers |
| `query` | none | URL parameters, e.g. Azure's `api-version` |
| `extraBody` | none | merged into every request (`reasoning_effort`, provider routing, `seed`, ...) |

Recipes (all in `configs/`):

| Provider | baseUrl | Notes |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | non-reasoning models give logprobs; reasoning models: `"answer": "text"`, `"temperature": null`, `"maxTokens": 2000`, `"extraBody": {"reasoning_effort": "low"}` |
| Azure OpenAI (deployment URL) | `https://<resource>.openai.azure.com/openai/deployments/<deployment>` | `"auth": "api-key"`, `"query": {"api-version": "2024-10-21"}`, no `model` needed |
| Azure OpenAI (v1 URL) | `https://<resource>.openai.azure.com/openai/v1` | `"model"` = the deployment name, `"auth": "api-key"` |
| OpenRouter | `https://openrouter.ai/api/v1` | `"extraBody": {"provider": {"require_parameters": true}}` keeps logprobs-capable providers |
| Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | `"answer": "text"` |
| vLLM / SGLang | `http://127.0.0.1:8000/v1` | `"auth": "none"`; logprobs work |
| llama.cpp server | `http://127.0.0.1:8080/v1` | `llama-server -m model.gguf`; logprobs work |
| LM Studio | `http://127.0.0.1:1234/v1` | `"auth": "none"` |
| Ollama (chat models) | `http://127.0.0.1:11434/v1` | `"auth": "none"` |
| PongBench's transformers server | `http://127.0.0.1:8001/v1` | `python3 examples/python/hf_server.py --model <id>` (`python` on Windows) |

## Claude (Anthropic)

```json
{ "name": "Claude Opus 5.5", "connector": "anthropic", "model": "claude-opus-5-5", "effort": "low", "concurrency": 8 }
```

Run `npm install @anthropic-ai/sdk` once in this folder (the rest of PongBench needs no packages). The SDK finds the key
itself (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, or an `ant auth login` profile), or set `apiKeyEnv`. The answer
comes back as structured output with an enum of the three moves. Server-side model fallbacks are deliberately not
enabled: a benchmark must measure one model, so a refusal is recorded as an error. Any Claude model works (`model`);
a one-word decision rarely needs more than `"effort": "low"`.

## Your own code (`module`)

```json
{ "name": "My player", "connector": "module", "path": "../examples/custom-connector.mjs", "options": {} }
```

The module exports `create(options)` returning `{ decide({ state, questions }, { signal }) }`, which returns
`{ choice }` or `{ choice, probabilities: { up, down, stay } }` (or the full System One shape). `path` is relative to the
config file. See [`examples/custom-connector.mjs`](../examples/custom-connector.mjs).

## Baselines (`mock`)

`"policy"`: `oracle` (the rule: the ceiling), `random` (the floor), `stay`, `down`, `noisy` (`errorRate`, default 0.1),
`hesitant` (stays when the ball arrives just outside the tolerance with probability `nearStay`, default 0.6: the most
common decision-model mistake). `latencyMs` and `jitterMs` simulate answer time.

## When something is wrong

| `check` says | Usually |
|---|---|
| `no API key: set X` | export `X` or put `X=...` in `.env` |
| `answered 401` | wrong key, or the wrong `auth` style (bearer, api-key, basic) |
| `answered 404` | the URL path: System One wants `/v1/systemone`; OpenAI wants `baseUrl` up to `/v1` |
| `answered 422` | the server rejected the request shape: read the detail it prints |
| `could not reach` | the server is not running, or the port differs |
| `the model answered "..."` | a chat model wandered off: try `"answer": "json"`, or `"text"` with a larger `maxTokens` |
| probabilities `(one-hot)` | the endpoint returns one answer only: fine for scoring, but calibration is not measured |
