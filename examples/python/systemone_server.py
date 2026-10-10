#!/usr/bin/env python3
"""A System One endpoint in plain Python (standard library only): put your model behind decide() and PongBench (or any
System One client) can call it.

  python examples/python/systemone_server.py [--port 8000]
  node bin/pongbench.js check --config systemone-local

POST /v1/systemone receives {"state": ..., "questions": {"move": {"type": "choice", "instructions": "...",
"criteria": {"up": "...", "down": "...", "stay": "..."}}}} and must answer {"answers": {"move": {"type": "choice",
"choice": "up", "probabilities": {"up": 0.8, "down": 0.1, "stay": 0.1}}}}. Probabilities are optional but make the
scorecard richer (calibration). See docs/SPEC.md for the full contract.
"""
from __future__ import annotations

import argparse
import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def decide(state, questions: dict) -> dict:
    """Replace this with your model. The example plays the rule from interceptY and paddle.y (both in the standard
    and compact tracks), so the pipeline can be tried end to end."""
    answers = {}
    for name, q in questions.items():
        keys = list(q.get("criteria") or {})
        choice = "stay"
        if isinstance(state, dict) and state.get("interceptY") is not None and isinstance(state.get("paddle"), dict):
            delta = state["interceptY"] - state["paddle"]["y"]
            choice = "up" if delta < -5 else "down" if delta > 5 else "stay"
        if choice not in keys:
            choice = keys[0] if keys else choice
        probs = {k: (0.9 if k == choice else 0.1 / max(1, len(keys) - 1)) for k in keys}
        answers[name] = {"type": "choice", "choice": choice, "confidence": probs.get(choice, 1.0), "probabilities": probs}
    return {"answers": answers, "usage": {"input_tokens": 0, "output_tokens": 0}}


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, obj: dict) -> None:
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):  # noqa: N802
        if not self.path.rstrip("/").endswith("/v1/systemone"):
            return self._send(404, {"error": "POST /v1/systemone"})
        size = int(self.headers.get("content-length") or 0)
        if not 0 <= size <= 1 << 20:                      # keep requests small
            return self._send(413, {"error": "a request is at most 1 MB"})
        if not (self.headers.get("content-type") or "").lower().startswith("application/json"):
            return self._send(415, {"error": "send JSON (content-type: application/json)"})
        try:
            body = json.loads(self.rfile.read(size) or b"{}")
            if not isinstance(body, dict) or not isinstance(body.get("questions"), dict) or not body["questions"]:
                return self._send(422, {"detail": [{"loc": ["body", "questions"], "msg": "a non-empty map of questions"}]})
            t0 = time.perf_counter()
            out = decide(body.get("state"), body["questions"])
            out["server_ms"] = round((time.perf_counter() - t0) * 1000, 3)
            self._send(200, out)
        except Exception as e:  # noqa: BLE001
            self._send(500, {"error": f"{type(e).__name__}: {e}"})

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args()
    print(f"System One endpoint: http://{args.host}:{args.port}/v1/systemone", flush=True)
    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()
