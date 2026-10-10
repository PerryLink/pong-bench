// The Prompt lab: edit everything the model reads (instructions, what each answer means, an optional context line,
// which state fields are sent, number precision), see the exact request and its size, check it on the 300 states of a
// quick benchmark run (decisions-v1, a third of each kind), and apply it to the running game (used from the next
// decision). A check reports the input tokens the endpoint counted, when it reports them.
import { BUILTINS, FIELDS, MOVES, cleanPrompt, expectedMove, pickMove, questionOf, stateOf } from "/game/prompts.js";
import { percentile } from "/game/stats.js";

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ the check set: a quick benchmark run's 300 states */
let SUITE = null;
async function checkSet() {
  if (!SUITE) {
    const r = await fetch("/suites/decisions-v1.json");
    if (!r.ok) throw new Error("the decisions suite is missing on the server");
    const suite = await r.json();
    const keep = { up: 100, down: 100, away: 50, covered: 50 };
    SUITE = suite.items.filter((it) => Number(it.id.split("-")[1]) <= keep[it.kind]).map((it) => it.ds);
  }
  return SUITE;
}

/* ------------------------------------------------------------------ the editor */
export class Lab {
  /**
   * app: {settings(), saved() -> {name: prompt}, applied() -> prompt, decider(), ready() -> bool,
   *       sample() -> ds, apply(prompt), save(name, prompt),
   *       remove(name), pauseGame()}
   */
  constructor(app) {
    this.app = app;
    this.draft = null;
    this.history = [];
    this.timer = 0;
    this.running = false;
    this.#wire();
  }

  open() {
    if (!this.draft) this.load(this.app.applied());
    this.#bases();
    this.#refresh();
  }

  load(prompt) {
    this.draft = cleanPrompt(prompt) || { ...BUILTINS.compact };
    this.draft.name = prompt.name || this.draft.name;
    $("labName").value = this.draft.name;
    $("labInstr").value = this.draft.instructions;
    $("labUp").value = this.draft.criteria.up;
    $("labDown").value = this.draft.criteria.down;
    $("labStay").value = this.draft.criteria.stay;
    $("labContext").value = this.draft.context || "";
    this.#chips();
    for (const b of $("labDec").children) b.setAttribute("aria-checked", String(Number(b.dataset.v) === this.draft.decimals));
    this.#refresh();
  }

  #bases() {
    const sel = $("labBase"), keep = sel.value;
    sel.replaceChildren(new Option("The prompt the game uses now", "applied"));
    for (const [id, p] of Object.entries(BUILTINS)) sel.append(new Option(`${p.name} (built in)`, `b:${id}`));
    for (const name of Object.keys(this.app.saved())) sel.append(new Option(`${name} (saved)`, `u:${name}`));
    if ([...sel.options].some((o) => o.value === keep)) sel.value = keep;
  }

  #chips() {
    $("labFields").replaceChildren(...FIELDS.map(([key, label, hint]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.textContent = label;
      b.title = hint;
      b.setAttribute("aria-pressed", String(this.draft.fields.includes(key)));
      b.addEventListener("click", () => {
        const on = !this.draft.fields.includes(key);
        this.draft.fields = on ? [...this.draft.fields, key] : this.draft.fields.filter((k) => k !== key);
        this.draft.fields = FIELDS.map(([k]) => k).filter((k) => this.draft.fields.includes(k));
        b.setAttribute("aria-pressed", String(on));
        this.#refresh();
      });
      return b;
    }));
  }

  #wire() {
    const text = [["labName", (v) => { this.draft.name = v; }], ["labInstr", (v) => { this.draft.instructions = v; }],
      ["labUp", (v) => { this.draft.criteria = { ...this.draft.criteria, up: v }; }],
      ["labDown", (v) => { this.draft.criteria = { ...this.draft.criteria, down: v }; }],
      ["labStay", (v) => { this.draft.criteria = { ...this.draft.criteria, stay: v }; }],
      ["labContext", (v) => { this.draft.context = v; }]];
    for (const [id, set] of text) $(id).addEventListener("input", (e) => { set(e.target.value); this.#refresh(); });
    for (const b of $("labDec").children) {
      b.addEventListener("click", () => {
        this.draft.decimals = Number(b.dataset.v);
        for (const o of $("labDec").children) o.setAttribute("aria-checked", String(o === b));
        this.#refresh();
      });
    }
    $("labLoad").addEventListener("click", () => {
      const v = $("labBase").value;
      if (v === "applied") this.load(this.app.applied());
      else if (v.startsWith("b:")) this.load(BUILTINS[v.slice(2)]);
      else this.load({ ...this.app.saved()[v.slice(2)], name: v.slice(2) });
      this.#msg(`Loaded "${this.draft.name}". Nothing changes in the game until you apply it.`);
    });
    $("labApply").addEventListener("click", () => {
      const p = this.#valid();
      if (!p) return;
      this.app.apply(p);
      this.#msg(`Applied "${p.name}": the game uses it from the next decision (its first two are slower: new shapes).`);
      this.#refresh();
    });
    $("labSave").addEventListener("click", async () => {
      const p = this.#valid();
      if (!p) return;
      try {
        await this.app.save(p.name, p);
        this.#bases();
        this.#msg(`Saved "${p.name}". Pick it in Settings or load it here any time.`);
      } catch (e) { this.#msg(`Could not save: ${e.message}`); }
    });
    $("labDelete").addEventListener("click", async () => {
      const name = this.draft.name;
      if (!(name in this.app.saved())) { this.#msg(`"${name}" is not a saved preset (built-in prompts cannot be deleted).`); return; }
      try {
        await this.app.remove(name);
        this.#bases();
        this.#msg(`Deleted "${name}". The editor still holds it: save again to keep it.`);
      } catch (e) { this.#msg(`Could not delete: ${e.message}`); }
    });
    $("labRevert").addEventListener("click", () => { this.load(this.app.applied()); this.#msg("Back to the prompt the game uses now."); });
    $("labCheck").addEventListener("click", () => this.check());
  }

  #valid() {
    const p = cleanPrompt(this.draft);
    if (!p) { this.#msg("Instructions and all three answers need some text."); return null; }
    return p;
  }

  #msg(t) { $("labMsg").textContent = t; }

  #refresh() {
    if (!this.draft) return;
    const s = this.app.settings();
    const applied = cleanPrompt(this.app.applied());
    const same = JSON.stringify(cleanPrompt(this.draft)) === JSON.stringify(applied);
    $("labDirty").textContent = same ? "this is the prompt the game uses" : "not applied yet";
    const ds = this.app.sample();
    const req = { state: stateOf(this.draft, ds, s.tol), questions: questionOf(this.draft, s.tol) };
    $("labPreview").textContent = JSON.stringify(req, null, 1);
    this.#size(req);
  }

  #size(req) {
    const chars = JSON.stringify(req).length;
    $("labTokens").textContent = `${chars} characters, about ${Math.round(chars / 4)} tokens (a check shows the endpoint's own count)`;
  }

  /** The 300 states through the draft prompt (the game pauses meanwhile: one endpoint, one queue). */
  async check() {
    if (this.running || !this.app.ready()) { if (!this.app.ready()) this.#msg("No endpoint is ready (see the Bench tab)."); return; }
    const p = this.#valid();
    if (!p) return;
    this.running = true;
    this.app.pauseGame();
    const s = this.app.settings(), btn = $("labCheck"), q = questionOf(p, s.tol);
    const dec = this.app.decider();
    const per = { up: [0, 0], down: [0, 0], stay: [0, 0] }, ms = [], toks = [];
    let set;
    try { set = await checkSet(); } catch (e) { this.#msg(e.message); this.running = false; return; }
    try {
      for (let i = 0; i < set.length; i += 1) {
        const ds = set[i], rule = expectedMove(ds, s.tol);
        const a = await dec.ask(stateOf(p, ds, s.tol), q);
        const choice = pickMove(a.probs, s.stayBias);          // read the way the game reads it
        per[rule][1] += 1;
        per[rule][0] += choice === rule ? 1 : 0;
        ms.push(a.server);
        if (a.usage?.input_tokens) toks.push(a.usage.input_tokens);
        if (i % 10 === 0) btn.textContent = `Checking ${i} / ${set.length}`;
      }
    } catch (e) {
      this.#msg(`The check stopped: ${e.message}`);
      return;
    } finally {
      btn.textContent = "Run 300 states";
      this.running = false;
    }
    const ok = per.up[0] + per.down[0] + per.stay[0];
    const tokensText = toks.length ? `${Math.round(toks.reduce((a, b) => a + b, 0) / toks.length)} tokens` : "not reported";
    $("labTokens").textContent = toks.length ? `${tokensText} per decision, as the endpoint counts them` : "the endpoint reports no token counts";
    const row = { name: s.stayBias ? `${p.name} (stay handicap ${s.stayBias.toFixed(2)})` : p.name, tokens: tokensText, match: (100 * ok) / set.length, per, p50: percentile(ms, 0.5), p95: percentile(ms, 0.95) };
    this.history.unshift(row);
    $("labResult").replaceChildren(...[[`${row.match.toFixed(1)}%`, "match the rule"], [`${row.p50.toFixed(1)} ms`, "endpoint p50"],
      [`${row.p95.toFixed(1)} ms`, "endpoint p95"], [`${(1000 / row.p50).toFixed(0)}/s`, "decisions/s at most"]].map(([v, l]) => {
      const d = document.createElement("div");
      d.className = "m";
      d.innerHTML = "<b></b><span></span>";
      d.children[0].textContent = v;
      d.children[1].textContent = l;
      return d;
    }));
    $("labChecks").replaceChildren(...this.history.slice(0, 12).map((r) => {
      const tr = document.createElement("tr");
      for (const v of [r.name, r.tokens, `${r.match.toFixed(1)}%`, `${r.per.up[0]}/${r.per.up[1]}`,
        `${r.per.down[0]}/${r.per.down[1]}`, `${r.per.stay[0]}/${r.per.stay[1]}`, `${r.p50.toFixed(1)} ms`]) {
        const td = document.createElement("td");
        td.textContent = v;
        tr.append(td);
      }
      return tr;
    }));
    this.#msg(`Checked "${p.name}" on ${set.length} states: ${row.match.toFixed(1)}% match the rule, model p50 ${row.p50.toFixed(1)} ms.`);
  }
}
