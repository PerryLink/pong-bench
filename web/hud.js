// The live metrics panel. Every number is measured: round trip in the page, model time and queue wait from the
// server, transport = round trip - endpoint time - queue, reaction = state snapshot to paddle (round trip + added latency).
// Answers only update counters; the DOM is written at most 15 times a second, so the panel never slows the game.
import { MOVES } from "/game/prompts.js";
import { Ring, Rate } from "/game/stats.js";
import { drawSpark, COLORS } from "./draw.js";

const $ = (id) => document.getElementById(id);
const ARROWS = { up: "↑", down: "↓", stay: "•" };
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : "–");
const f0 = (v) => (Number.isFinite(v) ? Math.round(v).toString() : "–");
const PAINT_MS = 66;

/** The rule asks to move into a wall the paddle already touches. */
function pinned(ds, rule) {
  const half = ds.paddle.h / 2;
  return (rule === "up" && ds.paddle.y <= half + 0.05) || (rule === "down" && ds.paddle.y >= ds.court.h - half - 0.05);
}

export class Hud {
  constructor() {
    this.fps = new Rate(1000);
    this.drawMs = new Ring(120);
    this.gpu = {};
    this.gameItems = [];
    this.view = { text: "", tokens: "" };
    this.lastPaint = 0;
    this.reset();
  }

  /** Clear the decision counters (a new game, a new prompt). */
  reset() {
    this.trip = new Ring(400); this.model = new Ring(400); this.wire = new Ring(400); this.wait = new Ring(400);
    this.react = new Ring(400); this.conf = new Ring(400); this.rate = new Rate(3000);
    this.n = { d: 0, ok: 0, held: 0, wall: 0, per: { up: [0, 0], down: [0, 0], stay: [0, 0] } };
    this.last = null;
    this.dirty = true;
  }

  /** One answer: {choice, probs, conf, ms, server, wait, rule, held, age, ds} (age: snapshot to use). With the paddle
   *  against a wall, the strict upstream rule can still ask to move into it: "stay" is as good there, so those
   *  disagreements are counted apart (the headline stays the strict rule). */
  decision(a, now = performance.now()) {
    this.trip.push(a.ms); this.model.push(a.server); this.wait.push(a.wait);
    this.wire.push(Math.max(0, a.ms - a.server - a.wait)); this.react.push(a.age ?? a.ms); this.conf.push(a.conf);
    this.rate.hit(now);
    this.n.d += 1;
    const ok = a.choice === a.rule;
    this.n.ok += ok ? 1 : 0;
    this.n.held += a.held ? 1 : 0;
    this.n.per[a.rule][1] += 1;
    this.n.per[a.rule][0] += ok ? 1 : 0;
    if (!ok && a.choice === "stay" && a.ds && pinned(a.ds, a.rule)) this.n.wall += 1;
    this.last = a;
    this.dirty = true;
  }

  /** Game numbers: [[value, label], ...] (up to six). */
  game(items) { this.gameItems = items; this.dirty = true; }
  system(gpu) { this.gpu = gpu || {}; this.dirty = true; }
  frame(ms, now) { this.fps.hit(now); this.drawMs.push(ms); }
  sees(state, tokens) { this.view = { state, tokens }; }

  paint(now) {
    if (now - this.lastPaint < PAINT_MS) return;
    this.lastPaint = now;
    this.#system();
    if (!this.dirty) return;
    this.dirty = false;
    this.#decision();
    $("mRate").textContent = f1(this.rate.perSecond);
    $("mTrip").textContent = f1(this.trip.q(0.5));
    $("mModel").textContent = f1(this.model.q(0.5));
    $("mP95").textContent = f1(this.trip.q(0.95));
    $("mWire").textContent = f1(this.wire.q(0.5));
    $("mReact").textContent = f1(this.react.q(0.5));
    const qw = this.wait.q(0.5);
    $("mQueue").textContent = Number.isFinite(qw) && qw >= 0.5 ? `queue p50 ${f1(qw)} ms` : "";
    drawSpark($("spark"), this.trip.values.slice(-120), this.model.values.slice(-120), COLORS.model);
    const n = this.n;
    $("qMatch").textContent = n.d ? `${((100 * n.ok) / n.d).toFixed(1)}%` : "–";
    $("qConf").textContent = this.conf.length ? `${Math.round(100 * this.conf.q(0.5))}%` : "–";
    $("qHeld").textContent = String(n.held);
    $("qNote").textContent = n.wall
      ? `${n.wall} of the misses were "stay" with the paddle already against the wall the rule points at (it cannot move further and still covers the ball). Without them: ${((100 * n.ok) / (n.d - n.wall)).toFixed(1)}%.`
      : "";
    $("qPer").replaceChildren(...MOVES.map((m) => {
      const [ok, all] = n.per[m], d = document.createElement("div");
      d.innerHTML = `${m} <b></b>`;
      d.querySelector("b").textContent = all ? `${ok}/${all}` : "–";
      return d;
    }));
    $("gStats").replaceChildren(...this.gameItems.map(([v, label]) => {
      const d = document.createElement("div");
      d.className = "m";
      d.innerHTML = "<b></b><span></span>";
      d.children[0].textContent = v;
      d.children[1].textContent = label;
      return d;
    }));
    const det = $("vState").closest("details");
    if (det.open && this.view.state) $("vState").textContent = JSON.stringify(this.view.state, null, 1);
    $("vTokens").textContent = this.view.tokens || "";
  }

  #decision() {
    const a = this.last;
    if (!a) {
      $("dMove").textContent = "waiting"; $("dArrow").textContent = "·"; $("dRule").textContent = "";
      $("dRule").className = "rule"; $("dBars").replaceChildren(); $("dAge").textContent = "";
      return;
    }
    $("dMove").textContent = a.choice;
    $("dArrow").textContent = ARROWS[a.choice];
    const rule = $("dRule");
    if (a.held) { rule.textContent = "held: low confidence"; rule.className = "rule held"; }
    else if (a.choice === a.rule) { rule.textContent = "matches the rule"; rule.className = "rule ok"; }
    else { rule.textContent = `rule says ${a.rule}`; rule.className = "rule no"; }
    $("dAge").textContent = `${f1(a.ms)} ms`;
    const top = a.probs.indexOf(Math.max(...a.probs));
    $("dBars").replaceChildren(...MOVES.map((m, i) => {
      const row = document.createElement("div");
      row.className = `b${i === top ? " top" : ""}`;
      row.innerHTML = `<span></span><span class="track"><span class="fill"></span></span><span class="pct"></span>`;
      row.children[0].textContent = m;
      row.querySelector(".fill").style.width = `${(100 * a.probs[i]).toFixed(1)}%`;
      row.querySelector(".pct").textContent = `${Math.round(100 * a.probs[i])}%`;
      return row;
    }));
  }

  #system() {
    const e = this.gpu.endpoint, items = [];
    if (e) {
      const st = e.stats || {};
      items.push([e.kind, "connector"], [e.model || "-", "model"], [String(st.calls ?? 0), "calls"],
                 [String(st.errors ?? 0), "errors"], [st.inputTokens ? `${Math.round(st.inputTokens / 1000)}k` : "-", "input tokens"],
                 [this.last?.probSource === "one-hot" ? "one answer" : this.last?.probSource ? "model's own" : "-", "probabilities"]);
    }
    items.push([`${f0(this.fps.perSecond)} fps · ${f1(this.drawMs.q(0.5))} ms`, "court drawing"]);
    if (this.log) items.push([this.log, "game log"]);
    $("sys").replaceChildren(...items.map(([v, label]) => {
      const d = document.createElement("div");
      d.innerHTML = "<b></b><span></span>";
      d.children[0].textContent = v;
      d.children[1].title = v;
      d.children[1].textContent = label;
      return d;
    }));
  }

}
