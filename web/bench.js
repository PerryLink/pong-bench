// The Bench tab: pick and check an endpoint, run the benchmark with any settings (the same runner as the command
// line, running in the server), watch it live, read the scorecard, compare runs.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (v) => (v === null || v === undefined ? "–" : `${v}%`);
const SUITE_NAMES = { decisions: "Decisions", rally: "Rally", arena: "Arena" };

/** "2026-10-10 07:24" in the viewer's time zone (scorecards store UTC). */
const localTime = (iso) => {
  const d = new Date(iso), p = (n) => String(n).padStart(2, "0");
  return Number.isNaN(d.getTime()) ? String(iso) : `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export class Bench {
  /** app: {prompt() -> the game's current prompt object, endpointChanged()} */
  constructor(app) {
    this.app = app;
    this.events = null;
    this.progress = {};
    this.t0 = 0;
    this.timer = 0;
    this.lastP50 = null;
    this.#wire();
  }

  async open() {
    if (!this.events) this.#listen();
    await Promise.all([this.#configs(), this.#runs()]);
    this.#estimate();
  }

  // ---------------------------------------------------------------- endpoint
  async #configs() {
    const [list, st] = await Promise.all([fetch("/api/configs").then((r) => r.json()), fetch("/api/state").then((r) => r.json())]);
    this.list = list;
    const sel = $("bConfig");
    sel.replaceChildren(...list.map((c) => new Option(`${c.name || c.id}${c.error ? " (error)" : ""}  [${c.connector || "?"}${c.key === "missing" ? ", key missing" : ""}]`, c.id)));
    if (st.config) sel.value = st.config.id;
    $("bEndpointState").textContent = st.error ? `not ready: ${st.error}` : st.config ? `active: ${st.config.name}` : "";
    this.#info();
  }

  #info() {
    const c = this.list?.find((x) => x.id === $("bConfig").value);
    if (!c) return;
    const rows = [["connector", c.connector], ["model", c.model || c.policy || "–"], ["endpoint", c.url || c.baseUrl || "–"],
                  ["key", c.key], ["note", c.note || ""]].filter(([, v]) => v);
    $("bConfigInfo").innerHTML = rows.map(([k, v]) => `<span>${esc(k)}</span><b>${esc(v)}</b>`).join("");
  }

  async #use() {
    const id = $("bConfig").value;
    const r = await fetch("/api/config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    const out = await r.json();
    $("bCheckOut").textContent = out.ok ? `Now using ${out.config.name}.` : `Could not use it: ${out.error}`;
    await this.#configs();
    this.app.endpointChanged();
  }

  async #check() {
    await this.#use();
    $("bCheckOut").textContent = "Asking 4 decisions...";
    const r = await fetch("/api/check", { method: "POST", headers: { "content-type": "application/json" },
                                           body: JSON.stringify({ track: this.#track() === "lab" ? "standard" : this.#track() }) });
    const out = await r.json();
    if (!r.ok) { $("bCheckOut").textContent = `Check failed: ${out.error}`; return; }
    $("bCheckOut").innerHTML = out.rows.map((x) => x.error
      ? `<div class="bad">${esc(x.kind)}: ${esc(x.error)}</div>`
      : `<div class="${x.right ? "ok" : "bad"}">${esc(x.kind)}: rule ${x.rule}, answer ${x.choice} (${x.right ? "right" : "wrong"}), ${Math.round(x.ms)} ms, p = [${x.probs.map((p) => p.toFixed(2)).join(", ")}] ${x.probSource === "one-hot" ? "(one answer, no probabilities)" : ""}</div>`).join("") +
      `<div class="sub">${out.rows.some((x) => x.error) ? "Fix the config before a run (docs/CONNECTORS.md)." : "The endpoint works."}</div>`;
    const ms = out.rows.filter((x) => !x.error).map((x) => x.ms).sort((a, b) => a - b);
    if (ms.length) this.lastP50 = ms[Math.floor(ms.length / 2)];
    this.#estimate();
  }

  // ---------------------------------------------------------------- options
  #wire() {
    $("bConfig").addEventListener("change", () => this.#info());
    $("bUse").addEventListener("click", () => this.#use());
    $("bCheck").addEventListener("click", () => this.#check());
    for (const box of ["bSuites", "bBots"]) {
      for (const b of $(box).children) b.addEventListener("click", () => { b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true")); this.#estimate(); });
    }
    for (const b of $("bTrack").children) {
      b.addEventListener("click", () => { for (const o of $("bTrack").children) o.setAttribute("aria-checked", String(o === b)); });
    }
    $("bQuick").addEventListener("click", () => { const q = $("bQuick"); q.setAttribute("aria-checked", String(q.getAttribute("aria-checked") !== "true")); this.#estimate(); });
    $("bConc").addEventListener("input", () => { $("bConcOut").textContent = $("bConc").value; this.#estimate(); });
    $("bBias").addEventListener("input", () => { const v = Number($("bBias").value); $("bBiasOut").textContent = v ? v.toFixed(2) : "off"; });
    $("bRun").addEventListener("click", () => this.#run());
    $("bStop").addEventListener("click", () => fetch("/api/bench/stop", { method: "POST" }));
  }

  #pressed(box) { return [...$(box).children].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.dataset.v); }
  #track() { return [...$("bTrack").children].find((b) => b.getAttribute("aria-checked") === "true")?.dataset.v || "standard"; }

  #estimate() {
    const suites = this.#pressed("bSuites"), quick = $("bQuick").getAttribute("aria-checked") === "true";
    const conc = Number($("bConc").value);
    const n = { decisions: quick ? 300 : 900, rally: quick ? 300 : 1200 };
    const calls = suites.reduce((s, x) => s + (n[x] || 0), 0);
    let text = `${calls.toLocaleString()} calls${suites.includes("arena") ? " plus the arena games (up to 2.5 minutes each)" : ""}.`;
    if (this.lastP50) {
      const sec = (suites.includes("decisions") ? (n.decisions * this.lastP50) / conc : 0)
                + (suites.includes("rally") ? (n.rally / Math.min(conc, quick ? 2 : 4)) * this.lastP50 : 0);
      text += ` About ${Math.max(1, Math.round(sec / 60000))} min at the checked latency (${Math.round(this.lastP50)} ms).`;
    }
    $("bEstimate").textContent = text;
    $("bArenaBox").hidden = !suites.includes("arena");
  }

  async #run() {
    const track = this.#track();
    const body = {
      suites: this.#pressed("bSuites"), track: track === "lab" ? "custom" : track, prompt: track === "lab" ? this.app.prompt() : null,
      quick: $("bQuick").getAttribute("aria-checked") === "true", concurrency: Number($("bConc").value),
      stayBias: Number($("bBias").value), bots: this.#pressed("bBots"), label: $("bLabel").value.trim(),
    };
    const r = await fetch("/api/bench/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const out = await r.json();
    if (!r.ok) { this.#log(`Could not start: ${out.error}`, "bad"); }
  }

  // ---------------------------------------------------------------- live progress (Server-Sent Events)
  #listen() {
    this.events = new EventSource("/api/bench/events");
    this.events.onmessage = (e) => this.#event(JSON.parse(e.data));
    this.events.onerror = () => { /* the browser reconnects by itself */ };
  }

  #event(e) {
    if (e.type === "hello") { this.#running(e.running); if (e.running) fetch("/api/bench/status").then((r) => r.json()).then((s) => s.log.forEach((x) => this.#event(x))); return; }
    if (e.type === "started") {
      this.progress = {};
      $("bLog").replaceChildren();
      this.t0 = Date.now();
      clearInterval(this.timer);
      this.timer = setInterval(() => { $("bClock").textContent = `${Math.round((Date.now() - this.t0) / 1000)} s`; }, 1000);
      this.#log(`Started on ${e.endpoint}: ${e.options.suites.join(", ")}, track ${e.options.track}${e.options.quick ? ", quick" : ""}.`);
      this.#running(true);
    }
    if (e.type === "plan") {
      for (const [k, n] of Object.entries(e.plan)) if (n) this.progress[k] = { done: 0, total: n, right: null };
      this.#bars();
    }
    if (e.type === "progress") { this.progress[e.suite] = { ...this.progress[e.suite], done: e.done, total: e.total, right: e.right ?? null, note: e.note }; this.#bars(); }
    if (e.type === "suite") {
      const m = e.metrics;
      this.#log(e.suite === "decisions" ? `Decisions: ${m.macro_accuracy}% macro (up ${m.per_move.up.accuracy}%, down ${m.per_move.down.accuracy}%, stay ${m.per_move.stay.accuracy}%), p50 ${m.latency_ms.p50} ms.`
        : e.suite === "rally" ? `Rally: ${m.rally_rate}% (${m.returns} returns, ${m.misses} misses).` : `Arena: ${m.points_won}% of points won.`, "ok");
    }
    if (e.type === "done") this.#card(e.result);
    if (e.type === "saved") { this.#log(`Saved ${e.id}: PongBench score ${e.score ?? "–"}.`, "ok"); this.#runs(); this.#end(); }
    if (e.type === "error" || e.type === "stopped") { this.#log(e.type === "stopped" ? "Stopped." : `Failed: ${e.message}`, "bad"); this.#end(); }
  }

  #end() { clearInterval(this.timer); this.#running(false); }
  #running(on) { $("bRun").disabled = on; $("bStop").disabled = !on; }

  #bars() {
    $("bProgress").replaceChildren(...Object.entries(this.progress).map(([k, p]) => {
      const d = document.createElement("div");
      d.className = "pbar";
      const frac = p.total ? p.done / p.total : 0;
      d.innerHTML = `<div class="row-between"><span>${SUITE_NAMES[k]}</span><span class="faint"></span></div><div class="track"><i></i></div>`;
      d.querySelector(".faint").textContent = `${p.done} / ${p.total}${p.right !== null && p.done ? `, ${((100 * p.right) / p.done).toFixed(1)}% right` : ""}${p.note ? `, ${p.note}` : ""}`;
      d.querySelector("i").style.width = `${(100 * frac).toFixed(1)}%`;
      return d;
    }));
  }

  #log(text, cls = "") {
    const li = document.createElement("li");
    li.textContent = text;
    if (cls) li.className = cls;
    $("bLog").append(li);
  }

  // ---------------------------------------------------------------- results
  async #runs() {
    const rows = await fetch("/api/results").then((r) => r.json()).catch(() => []);
    $("bRuns").replaceChildren(...(rows.length ? rows.map((x) => {
      const tr = document.createElement("tr");
      tr.tabIndex = 0;
      tr.className = "clickable";
      for (const v of [localTime(x.created).slice(5), x.name, `${x.track}${x.quick ? " (quick)" : ""}`, x.score ?? "–", pct(x.macro), pct(x.rally), pct(x.arena), x.p50 != null ? `${x.p50} ms` : "–"]) {
        const td = document.createElement("td");
        td.textContent = v;
        tr.append(td);
      }
      const show = async () => this.#card(await fetch(`/api/results/${encodeURIComponent(x.id)}`).then((r) => r.json()));
      tr.addEventListener("click", show);
      tr.addEventListener("keydown", (ev) => { if (ev.key === "Enter") show(); });
      return tr;
    }) : [(() => { const tr = document.createElement("tr"); tr.innerHTML = '<td colspan="8" class="faint">No runs yet.</td>'; return tr; })()]));
  }

  #card(r) {
    const d = r.suites.decisions, ra = r.suites.rally, ar = r.suites.arena;
    $("bCardLink").textContent = r.id ? "scorecard.md" : "";
    $("bCardLink").href = r.id ? `/results/${encodeURIComponent(r.id)}/scorecard.md` : "#";
    const bar = (label, v) => `<div class="b"><span>${label}</span><span class="track"><i style="width:${v ?? 0}%"></i></span><span class="pct">${pct(v)}</span></div>`;
    $("bCardBody").innerHTML = `
      <div class="score-row"><div class="big">${r.score ?? "–"}</div><div class="sub">PongBench score for <b>${esc(r.model.name)}</b>, track ${esc(r.track)}${r.quick ? " (quick)" : ""}<br>
      ${esc(localTime(r.created))}, ${r.calls?.calls ?? "?"} calls, ${r.calls?.errors ?? 0} errors${r.label ? `<br>${esc(r.label)}` : ""}</div></div>
      ${d ? `<div class="bars card-bars">${bar("up", d.per_move.up.accuracy)}${bar("down", d.per_move.down.accuracy)}${bar("stay", d.per_move.stay.accuracy)}${bar("<b>macro</b>", d.macro_accuracy)}</div>
        <div class="kv">${Object.entries(d.bands).map(([k, b]) => `<span>move needed, ${k} off centre</span><b>${pct(b.accuracy)} of ${b.of}</b>`).join("")}
        <span>up to the top edge</span><b>${pct(d.edges.top.accuracy)} of ${d.edges.top.of}</b><span>down to the bottom edge</span><b>${pct(d.edges.bottom.accuracy)} of ${d.edges.bottom.of}</b>
        <span>probabilities</span><b>${d.calibration ? `the model's own (Brier ${d.calibration.brier}, ECE ${d.calibration.ece})` : "one answer only"}</b>
        <span>latency</span><b>p50 ${d.latency_ms.p50} ms, p95 ${d.latency_ms.p95} ms${d.tokens ? `, ${d.tokens.per_decision_input} input tokens per decision` : ""}</b></div>` : ""}
      ${ra ? `<div class="kv"><span>rally rate</span><b>${pct(ra.rally_rate)} (${ra.returns} returns, ${ra.misses} misses, longest rally ${ra.longest_rally})</b></div>` : ""}
      ${ar ? `<div class="kv"><span>arena</span><b>${pct(ar.points_won)} of points won: ${ar.games.map((g) => `${g.bot} ${g.score}`).join(", ")}</b></div>` : ""}`;
  }
}
