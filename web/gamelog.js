// Every game, saved for analysis (Play, Bot match, Watch): one JSON-lines file per game in pong-lanes/games/.
//   {"k":"h"}    header: mode, settings, the exact prompt and question text, model, game parameters
//   {"k":"d"}    every decision: the exact state sent, the full game state, the rule's move, the model's answer and
//                probabilities, round trip, model time, queue wait, reaction, held, and the paddle's move after it
//   {"k":"e"}    every event: hits (where on the paddle), wall bounces, misses (how far the paddle was), serves,
//                pauses, prompt and setting changes
//   {"k":"x"}    the track: ball and both paddles 20 times a second while the ball is in play
//   {"k":"end"}  the result and a summary (also added to games/index.jsonl)
// During play this only pushes small objects into an array; a chunk is posted every 2 s, the last one by sendBeacon
// when the page closes. tools/analyze_games.py reads the files.
import { percentile } from "/game/stats.js";

const FLUSH_MS = 2000;
const TRACK_MS = 50;
const MAX_QUEUE = 200000;
const r1 = (v) => (typeof v === "number" ? Math.round(v * 10) / 10 : v);
const r2 = (v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v);
const stamp = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19);

/** The game state behind a decision, short keys: ball x, y, vx, vy; paddle y and height; interceptY; dir. */
export const shortState = (ds) => ({ bx: ds.ball.x, by: ds.ball.y, vx: ds.ball.vx, vy: ds.ball.vy, py: ds.paddle.y,
                                    ph: ds.paddle.h, iy: ds.interceptY, dir: ds.dir });

export class GameLog {
  constructor() {
    this.on = true;
    this.id = null;
    this.buf = [];
    this.bytes = 0;
    this.failed = 0;
    this.timer = 0;
    window.addEventListener("pagehide", () => this.end("closed"));
  }

  get open() { return !!this.id; }

  /** Open a log. header: anything that describes the game (settings, prompt, questions, model, cfg). */
  start(mode, header) {
    if (this.id) this.end("replaced");
    if (!this.on) return;
    const rand = Math.random().toString(36).slice(2, 6);
    this.id = `${stamp().replace(/[-:]/g, "").replace("T", "-")}_${mode}_${rand}`;
    this.mode = mode;
    this.created = stamp();
    this.t0 = performance.now();
    this.lastTrack = 0;
    this.bytes = 0;
    this.n = { d: 0, ok: 0, held: 0, warm: 0, per: { up: [0, 0], down: [0, 0], stay: [0, 0] }, trip: [], model: [],
               events: {}, firstT: null, lastT: 0 };
    this.buf.push({ k: "h", id: this.id, mode, created: this.created, version: 1, ...header });
    this.#schedule();
  }

  #t(at = performance.now()) { return r1(at - this.t0); }

  /** One decision (a: the client's answer plus ds, rule, held, age, ...). */
  decision(a, extra = {}) {
    if (!this.id) return;
    const n = this.n, t = this.#t();
    n.d += 1;
    n.firstT ??= t;
    n.lastT = t;
    if (a.warm) n.warm += 1;
    else {
      const ok = a.choice === a.rule;
      n.ok += ok ? 1 : 0;
      n.held += a.held ? 1 : 0;
      n.per[a.rule][1] += 1;
      n.per[a.rule][0] += ok ? 1 : 0;
      n.trip.push(a.ms);
      n.model.push(a.server);
    }
    this.buf.push({
      k: "d", t, ts: a.sentAt ? this.#t(a.sentAt) : undefined, seq: a.seq, sent: a.sent, ds: shortState(a.ds),
      rule: a.rule, ans: a.choice, p: a.probs.map((v) => Math.round(v * 1e4) / 1e4), rt: r2(a.ms), sv: r2(a.server),
      w: r2(a.wait), age: r2(a.age ?? a.ms), held: a.held || undefined, warm: a.warm || undefined, ...extra,
    });
  }

  event(type, data = {}) {
    if (!this.id) return;
    this.n.events[type] = (this.n.events[type] || 0) + 1;
    this.buf.push({ k: "e", t: this.#t(), type, ...data });
  }

  /** Ball and paddles, at most 20 times a second. s: [ballX, ballY, leftY, rightY, modelDir]. */
  track(now, s) {
    if (!this.id || now - this.lastTrack < TRACK_MS) return;
    this.lastTrack = now;
    this.buf.push({ k: "x", t: this.#t(now), s: s.map(r1) });
  }

  summary() {
    const n = this.n, valid = n.d - n.warm, active = Math.max(1, n.lastT - (n.firstT ?? 0)) / 1000;
    return {
      decisions: n.d, warm: n.warm, matches: n.ok, match: valid ? Math.round((1000 * n.ok) / valid) / 10 : null,
      per: n.per, held: n.held, dps_span: Math.round((10 * n.d) / active) / 10,
      p50: r1(percentile(n.trip, 0.5)), p95: r1(percentile(n.trip, 0.95)), model_p50: r1(percentile(n.model, 0.5)),
      events: n.events,
    };
  }

  /** Close the log. index: the one-line summary for the games list. */
  end(result, extra = {}) {
    if (!this.id) return;
    const summary = this.summary();
    const index = { mode: this.mode, created: this.created, result, ...extra.index,
                    decisions: summary.decisions, match: summary.match, p50: summary.p50, model_p50: summary.model_p50 };
    this.buf.push({ k: "end", t: this.#t(), result, summary, ...extra, index });
    this.#flush(true);
    this.id = null;
    clearTimeout(this.timer);
  }

  #schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.#flush(false); if (this.id) this.#schedule(); }, FLUSH_MS);
  }

  #flush(final) {
    if (!this.buf.length) return;
    const id = this.id, lines = this.buf;
    this.buf = [];
    const body = JSON.stringify({ lines });
    this.bytes += body.length;
    const url = `/api/games/${id}`;
    if (final && body.length < 60000 && navigator.sendBeacon(url, new Blob([body], { type: "application/json" }))) return;
    fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: final && body.length < 60000 })
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); })
      .catch(() => {
        this.failed += 1;
        if (!final && this.id === id && this.buf.length + lines.length < MAX_QUEUE) this.buf = [...lines, ...this.buf];
      });
  }
}

