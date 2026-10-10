# Examples

| File | What it is |
|---|---|
| `python/systemone_server.py` | a System One endpoint in plain Python (standard library only): put your model behind `decide()` |
| `python/hf_server.py` | any Hugging Face causal LM as a decision endpoint, with System One and OpenAI routes; probabilities from the model's logits. `pip install torch transformers`; it uses an NVIDIA GPU (`cuda`), an Apple-silicon GPU (`mps`) or the CPU, whichever is there (`--device` to choose) |
| `mock-systemone-server.mjs` | a built-in player behind System One (Node), to test a client without a model |
| `custom-connector.mjs` | a player for the `module` connector: any JavaScript |

```bash
python3 examples/python/hf_server.py --model Qwen/Qwen3-4B-Instruct-2507 --port 8001   # "python" on Windows
node bin/pongbench.js check --config hf-local             # OpenAI route, probabilities from logprobs
node bin/pongbench.js check --config hf-local-systemone   # System One route
```
