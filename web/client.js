// The page's line to the model, through PongBench's own server (which holds the endpoint config and any API key):
// a WebSocket by default (lowest overhead), or HTTP POST /api/decide. Every answer carries its timings: the round
// trip seen by the page, and the endpoint's own time measured by the server (the rest is page <-> server transport).
import { MOVES } from "/game/prompts.js";

export class Decider {
  constructor(transport = "ws") {
    this.transport = transport;
    this.ws = null;
    this.opening = null;
    this.pending = new Map();
    this.seq = 0;
    this.qKey = null;
    this.qJson = "";
  }

  /** The questions' JSON, serialised once per question set (it never changes during a game). */
  #questions(questions) {
    if (questions !== this.qKey) { this.qKey = questions; this.qJson = JSON.stringify(questions); }
    return this.qJson;
  }

  #open() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return Promise.resolve(this.ws);
    if (this.opening) return this.opening;
    this.opening = new Promise((ok, no) => {
      const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
      ws.onopen = () => { this.ws = ws; this.opening = null; ok(ws); };
      ws.onerror = () => { this.opening = null; no(new Error("could not reach the PongBench server")); };
      ws.onclose = () => {
        this.ws = null;
        for (const p of this.pending.values()) p.no(new Error("the connection to the server closed"));
        this.pending.clear();
      };
      ws.onmessage = (e) => this.#answer(JSON.parse(e.data), performance.now());
    });
    return this.opening;
  }

  #answer(body, now) {
    const p = this.pending.get(body.id);
    if (!p) return;
    this.pending.delete(body.id);
    if (body.error) p.no(new Error(body.error));
    else p.ok(parse(body, now - p.t0, p.t0));
  }

  /** One decision. Resolves {choice, probs, conf, ms, server, wait, sentAt, probSource, usage}. */
  async ask(state, questions, signal) {
    const t0 = performance.now();
    if (this.transport === "http") {
      const r = await fetch("/api/decide", { method: "POST", headers: { "content-type": "application/json" }, signal,
                                             body: `{"state":${JSON.stringify(state)},"questions":${this.#questions(questions)}}` });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || `the server answered ${r.status}`);
      return parse(body, performance.now() - t0, t0);
    }
    const ws = await this.#open();
    const id = (this.seq += 1);
    const done = new Promise((ok, no) => this.pending.set(id, { ok, no, t0 }));
    ws.send(`{"id":${id},"state":${JSON.stringify(state)},"questions":${this.#questions(questions)}}`);
    if (signal) {
      signal.addEventListener("abort", () => {
        const p = this.pending.get(id);
        if (p) { this.pending.delete(id); p.no(new DOMException("stopped", "AbortError")); }
      }, { once: true });
    }
    return done;
  }

  close() { this.ws?.close(); this.ws = null; }
}

function parse(body, ms, t0) {
  if (!MOVES.includes(body.choice)) throw new Error("the answer has no valid move");
  const probs = Array.isArray(body.probs) && body.probs.length === 3 ? body.probs : MOVES.map((m) => (m === body.choice ? 1 : 0));
  return { choice: body.choice, probs, conf: Math.max(...probs), ms, server: Number(body.ms) || 0, wait: 0, sentAt: t0,
           probSource: body.probSource, usage: body.usage };
}
