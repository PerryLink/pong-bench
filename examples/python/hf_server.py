"""Serve any Hugging Face causal language model as a decision endpoint, with real probabilities.

  pip install torch transformers
  python examples/python/hf_server.py --model Qwen/Qwen3-4B-Instruct-2507 [--port 8001] [--device cuda] [--dtype bfloat16]

Two routes, so PongBench (or anything else) can use either connector:

  POST /v1/systemone          System One: {state, questions: {name: {type: "choice", instructions, criteria}}}
                              -> {answers: {name: {type, choice, probabilities, confidence}}, usage}
  POST /v1/chat/completions   OpenAI shape, one token, with logprobs/top_logprobs of that token

Probabilities come from the model's own next-token logits over the option keys (one forward pass, no sampling): the
softmax over each key's first token when those are distinct, or over each key's full log-likelihood (one batched pass)
when they are not. The prompt is PongBench's chat layout (examples and docs/SPEC.md). One request at a time.
Also answers "noul" (p(yes) from yes/no) and "score" (levels 0..n-1) questions.
"""
from __future__ import annotations

import argparse
import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX_BODY, MAX_QUESTIONS, MAX_KEYS = 1 << 20, 8, 16      # one request stays small: a web page cannot make it run for minutes
SYSTEM = "You make one decision about the state given. Answer with the key of exactly one option, and nothing else."


def render(state, question: dict, keys: list[str]) -> str:
    crit = question.get("criteria")
    if isinstance(crit, dict):
        opts = "\n".join(f"- {k}: {v if isinstance(v, str) else json.dumps(v)}" for k, v in crit.items())
    else:
        opts = "\n".join(f"- {k}: {v}" for k, v in zip(keys, crit or keys))
    instr = question.get("instructions", "")
    return "\n".join(["State:", state if isinstance(state, str) else json.dumps(state), "",
                      f"Question: {instr if isinstance(instr, str) else json.dumps(instr)}", "Options:", opts, "",
                      f"Answer with one of: {', '.join(keys)}."])


class Model:
    def __init__(self, name: str, device: str, dtype: str, max_gpu_gib: float | None) -> None:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer
        self.torch = torch
        self.tok = AutoTokenizer.from_pretrained(name)
        kw = {"dtype": getattr(torch, dtype)}
        if device == "auto" or max_gpu_gib:
            try:
                import accelerate  # noqa: F401
            except ImportError as e:
                raise SystemExit("--device auto / --max-gpu-gib need the accelerate package: pip install accelerate") from e
            kw["device_map"] = "auto"
            if max_gpu_gib:
                kw["max_memory"] = {0: f"{max_gpu_gib}GiB", "cpu": "64GiB"}
        self.model = AutoModelForCausalLM.from_pretrained(name, **kw).eval()
        if "device_map" not in kw:
            self.model.to(device)
        self.device = next(self.model.parameters()).device
        self.name = name
        self.lock = threading.Lock()

    def prompt_ids(self, messages: list[dict]):
        try:
            text = self.tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True, enable_thinking=False)
        except TypeError:
            text = self.tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        return self.tok(text, return_tensors="pt", add_special_tokens=False).input_ids.to(self.device)

    def option_probs(self, messages: list[dict], keys: list[str]) -> tuple[list[float], int]:
        """p(key) for each key: first-token softmax when the keys' first tokens differ, else full log-likelihoods."""
        torch = self.torch
        ids = self.prompt_ids(messages)
        seqs = [self.tok(k, add_special_tokens=False).input_ids for k in keys]
        with self.lock, torch.inference_mode():
            firsts = [s[0] for s in seqs]
            if len(set(firsts)) == len(firsts):
                logits = self.model(ids).logits[0, -1].float()
                lp = torch.log_softmax(logits, -1)[firsts]
            else:
                lp = []
                for s in seqs:                       # exact: the sum of each key's token log-probs
                    full = torch.cat([ids, torch.tensor([s], device=self.device)], 1)
                    out = torch.log_softmax(self.model(full).logits[0].float(), -1)
                    n = ids.shape[1]
                    lp.append(sum(out[n - 1 + j, t] for j, t in enumerate(s)))
                lp = torch.stack(lp)
            p = torch.softmax(lp, 0).tolist()
        return p, int(ids.shape[1])

    def top_logprobs(self, messages: list[dict], k: int) -> tuple[list[tuple[str, float]], int]:
        torch = self.torch
        ids = self.prompt_ids(messages)
        with self.lock, torch.inference_mode():
            lp = torch.log_softmax(self.model(ids).logits[0, -1].float(), -1)
            vals, idx = lp.topk(k)
        return [(self.tok.decode([int(i)]), float(v)) for v, i in zip(vals, idx)], int(ids.shape[1])


def check_questions(qs) -> None:
    """Raise ValueError unless qs is a map of 1 to MAX_QUESTIONS questions, each with 1 to MAX_KEYS options."""
    if not isinstance(qs, dict) or not 0 < len(qs) <= MAX_QUESTIONS:
        raise ValueError(f"questions must be a map of 1 to {MAX_QUESTIONS} questions")
    for name, q in qs.items():
        if not isinstance(q, dict):
            raise ValueError(f"question {name!r} must be an object")
        typ = q.get("type", "choice")
        if typ not in ("choice", "noul", "score"):
            raise ValueError(f"question {name!r}: type must be choice, noul or score")
        crit = q.get("criteria")
        if typ != "noul" and (not isinstance(crit, (dict, list)) or not 0 < len(crit) <= MAX_KEYS):
            raise ValueError(f"question {name!r} needs 1 to {MAX_KEYS} criteria")


def systemone(model: Model, body: dict) -> dict:
    answers, used = {}, 0
    for name, q in body["questions"].items():
        typ = q.get("type", "choice")
        if typ == "choice":
            keys = list(q["criteria"])
        elif typ == "noul":
            keys = ["yes", "no"]
        else:
            keys = [str(i) for i in range(len(q["criteria"]))]
        messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": render(body.get("state"), q, keys)}]
        p, n = model.option_probs(messages, keys)
        used += n
        best = max(range(len(keys)), key=p.__getitem__)
        if typ == "noul":
            answers[name] = {"type": "noul", "noul": p[0]}
        elif typ == "score":
            answers[name] = {"type": "score", "score": sum(i * x for i, x in enumerate(p)), "confidence": p[best],
                             "probabilities": dict(zip(keys, p)), "legend": dict(zip(keys, q["criteria"]))}
        else:
            answers[name] = {"type": "choice", "choice": keys[best], "confidence": p[best], "probabilities": dict(zip(keys, p))}
    return {"model": model.name, "answers": answers, "usage": {"input_tokens": used, "output_tokens": 0}}


def chat(model: Model, body: dict) -> dict:
    k = int(body.get("top_logprobs") or 5)
    top, n = model.top_logprobs(body["messages"], max(1, min(20, k)))
    token, lp = top[0]
    return {"id": f"hf-{int(time.time() * 1000)}", "object": "chat.completion", "model": model.name,
            "choices": [{"index": 0, "finish_reason": "length", "message": {"role": "assistant", "content": token},
                         "logprobs": {"content": [{"token": token, "logprob": lp,
                                                   "top_logprobs": [{"token": t, "logprob": v} for t, v in top]}]}}],
            "usage": {"prompt_tokens": n, "completion_tokens": 1, "total_tokens": n + 1}}


def main() -> None:
    ap = argparse.ArgumentParser(description="Any Hugging Face causal LM as a System One / OpenAI decision endpoint")
    ap.add_argument("--model", required=True, help="a Hugging Face model id or a local folder")
    ap.add_argument("--port", type=int, default=8001)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--device", default="cuda", help="cuda, cpu, or auto (spread across GPU and CPU)")
    ap.add_argument("--dtype", default="bfloat16")
    ap.add_argument("--max-gpu-gib", type=float, default=None, help="cap GPU memory and put the rest of the model in RAM")
    ap.add_argument("--pure-torch", action="store_true",
                    help="ignore optional kernel packages (fla, causal_conv1d): needed on CPU, implied by --device cpu")
    args = ap.parse_args()
    if args.pure_torch or args.device == "cpu":
        for mod in ("fla", "causal_conv1d"):        # their Triton kernels cannot run on CPU tensors
            sys.modules[mod] = None
    print(f"loading {args.model} ...", flush=True)
    model = Model(args.model, args.device, args.dtype, args.max_gpu_gib)
    print(f"ready on {model.device}: http://{args.host}:{args.port}/v1/systemone and /v1/chat/completions", flush=True)

    class Handler(BaseHTTPRequestHandler):
        def _send(self, code: int, obj: dict) -> None:
            data = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):  # noqa: N802
            self._send(200, {"ok": True, "model": model.name, "routes": ["/v1/systemone", "/v1/chat/completions"]})

        def do_POST(self):  # noqa: N802
            try:
                if not (self.headers.get("content-type") or "").lower().startswith("application/json"):
                    return self._send(415, {"error": "send JSON (content-type: application/json)"})
                size = int(self.headers.get("content-length") or 0)
                if not 0 <= size <= MAX_BODY:
                    return self._send(413, {"error": f"a request is 0 to {MAX_BODY} bytes"})
                body = json.loads(self.rfile.read(size) or b"{}")
                if not isinstance(body, dict):
                    raise ValueError("the body must be a JSON object")
                route = self.path.rstrip("/")
                if route.endswith("/v1/systemone"):
                    check_questions(body.get("questions"))
                elif route.endswith("/chat/completions"):
                    if not isinstance(body.get("messages"), list):
                        raise ValueError("messages must be a list")
                else:
                    return self._send(404, {"error": "unknown route"})
            except (KeyError, TypeError, ValueError) as e:      # the request is wrong: the caller's to fix
                return self._send(422, {"error": f"bad request: {e}"})
            try:
                t0 = time.perf_counter()
                out = systemone(model, body) if route.endswith("/v1/systemone") else chat(model, body)
                out["server_ms"] = round((time.perf_counter() - t0) * 1000, 2)
                self._send(200, out)
            except Exception as e:  # noqa: BLE001  (the model failed: the server's problem, not the request's)
                self._send(500, {"error": f"{type(e).__name__}: {e}"})

        def log_message(self, *a):  # quiet
            pass

    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
