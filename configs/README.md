# Endpoint configs

One JSON file per model. `node bin/pongbench.js configs` lists them and whether each one's key is found; pass a name
(without `.json`) to `check`, `run` and `serve`. Keys never go here: `apiKeyEnv` names the environment variable (or
put `NAME=value` in the repository's `.env`). Every field is explained in [../docs/CONNECTORS.md](../docs/CONNECTORS.md).

| Config | Endpoint |
|---|---|
| `mock-*` | built-in baselines: oracle, random, always stay, noisy (10% wrong), hesitant |
| `typesafe-jev` | TypeSafe's hosted Jev (`TYPESAFE_API_KEY`) |
| `systemone-local`, `ollama-systemone` | a System One server on this machine; Ollama 0.35+ decision models |
| `databricks-systemone`, `cloudflare-clef` | OpenJev on Databricks; Clef-flash on Cloudflare Workers AI |
| `openai`, `openai-reasoning`, `azure-openai`, `openrouter`, `gemini` | hosted chat APIs |
| `vllm`, `llamacpp`, `lmstudio`, `ollama-chat` | local OpenAI-compatible servers |
| `hf-local`, `hf-local-systemone` | `examples/python/hf_server.py`: any open-weight causal LM |
| `anthropic` | Claude through the official SDK |
| `custom-module` | your own JavaScript (`examples/custom-connector.mjs`) |

Placeholders to replace are written `REPLACE_...`. Paths in a config (`path`, `apiKeyFile`) are relative to the
config file; write them with forward slashes and they work on Windows, macOS and Linux.
