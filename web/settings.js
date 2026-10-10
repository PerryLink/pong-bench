// Every knob in one list: the settings panel is built from it, choices are kept in this browser (localStorage, best
// effort), and URL parameters override them (?prompt=upstream&tol=5&transport=http, for headless runs). Prompts are
// picked here and edited in the Prompt lab; whole setups (every setting) can be saved and loaded by name.
import { BUILTINS } from "/game/prompts.js";
import { BOT_LEVELS } from "/game/realtime.js";

const KEY = "pongbench-settings-v1";
const pct = (v) => `${Math.round(v * 100)}%`;

export const GROUPS = [
  {
    title: "Model input", note: "What the model reads every decision. Edit prompts in the Prompt lab.", items: [
      { key: "prompt", label: "Prompt", type: "select", def: "standard" },
      { key: "tol", label: "Stay tolerance", type: "range", def: 5, min: 2, max: 15, step: 1, fmt: (v) => `${v} units`,
        help: () => "How close the paddle must be to interceptY to count as covering it (in the prompt and in the rule)." },
    ],
  },
  {
    title: "Decisions", note: "How answers travel and how the game uses them.", items: [
      { key: "transport", label: "Transport", type: "seg", def: "ws", options: [["ws", "WebSocket"], ["http", "HTTP"]],
        help: (v) => (v === "ws" ? "Fastest from the browser. Same answers." : "TypeSafe's System One API (/v1/systemone): a few ms more per decision in Chrome.") },
      { key: "inflight", label: "In flight", type: "seg", def: 1, options: [[1, "1"], [2, "2"]], modes: ["play", "bot"],
        help: (v) => (Number(v) === 1 ? "The next state goes out when the last answer lands: the freshest answers." : "Two requests overlap: a few more answers per second, each a little older.") },
      { key: "stayBias", label: "Stay handicap", type: "range", def: 0, min: 0, max: 0.4, step: 0.05,
        fmt: (v) => (v ? v.toFixed(2) : "off"),
        help: () => `Taken off the model's own probability of "stay" before the most likely move is played. Decision models often lean to "stay" just past the tolerance; this tests how much a calibrated reading helps. Off (official runs) = its plain top answer. Needs real probabilities (System One, or logprobs).` },
      { key: "minConf", label: "Min confidence", type: "range", def: 0, min: 0, max: 0.9, step: 0.05, modes: ["play", "bot"],
        fmt: (v) => (v ? pct(v) : "off"), help: () => "Below this, the paddle keeps its previous move instead of following a doubtful answer." },
      { key: "addedMs", label: "Added latency", type: "range", def: 0, min: 0, max: 300, step: 10, modes: ["play", "bot"],
        fmt: (v) => `${v} ms`, help: () => "Holds every answer this long before the paddle uses it: how much does reaction time matter?" },
      { key: "maxRate", label: "Decision cap", type: "seg", def: 0, modes: ["play", "bot"],
        options: [[0, "No cap"], [20, "20/s"], [10, "10/s"], [5, "5/s"]], help: () => "At most this many decisions per second." },
    ],
  },
  {
    title: "Game", note: "Changes apply from the next serve.", modes: ["play", "bot"], items: [
      { key: "crossingS", label: "Ball speed", type: "range", def: 1.6, min: 0.6, max: 3, step: 0.1,
        fmt: (v) => `${v.toFixed(1)} s per crossing`, help: () => "Time for a served ball to cross the court (lower is faster)." },
      { key: "speedUp", label: "Speed-up per hit", type: "range", def: 0.05, min: 0, max: 0.12, step: 0.01, fmt: pct },
      { key: "paddleH", label: "Paddle size", type: "range", def: 20, min: 10, max: 40, step: 2, fmt: (v) => `${v} units` },
      { key: "paddleSpeed", label: "Paddle speed", type: "range", def: 110, min: 50, max: 220, step: 10, fmt: (v) => `${v} units/s`,
        help: () => "The model's paddle (and yours with fair paddles on). The court is 160 x 100." },
      { key: "fair", label: "Fair paddles", type: "toggle", def: true, modes: ["play"],
        help: (v) => (v ? "Your paddle has the same top speed as the model's." : "Your paddle follows the mouse instantly.") },
      { key: "pointsToWin", label: "Points to win", type: "seg", def: 5, options: [[3, "3"], [5, "5"], [7, "7"], [11, "11"]] },
      { key: "bot", label: "Bot", type: "seg", def: "medium", modes: ["bot"],
        options: Object.entries(BOT_LEVELS).map(([k, v]) => [k, v.label]),
        help: (v) => { const b = BOT_LEVELS[v]; return b.lagS ? `Reacts ${Math.round(b.lagS * 1000)} ms late and misses its aim by up to ${b.err} units.` : "Never misses."; } },
    ],
  },
  {
    title: "Display", items: [
      { key: "guide", label: "Intercept guide", type: "toggle", def: true, help: () => "Where the ball will reach the model's paddle." },
      { key: "trail", label: "Ball trail", type: "toggle", def: true },
      { key: "effects", label: "Glow and hit flashes", type: "toggle", def: true },
      { key: "sound", label: "Sound", type: "toggle", def: false },
    ],
  },
  {
    title: "Data", items: [
      { key: "saveGames", label: "Save every game", type: "toggle", def: true,
        help: (v) => (v ? "Each game goes to pong-lanes/games/: every decision, event and the ball's path, for analysis (about 0.7 MB a minute of play)." : "Games are not saved.") },
    ],
  },
];

const ALL = GROUPS.flatMap((g) => g.items);
export const DEFAULTS = Object.fromEntries([...ALL.map((i) => [i.key, i.def]), ["seed", 7], ["lab", null]]);
const SETUP_KEYS = Object.keys(DEFAULTS).filter((k) => k !== "lab");

function coerce(item, raw) {
  if (!item) return raw;
  if (item.type === "toggle") return raw === true || raw === "1" || raw === "true";
  if (typeof item.def === "number") {
    const n = Number(raw);
    if (!Number.isFinite(n)) return item.def;
    if (item.options) return item.options.some(([v]) => v === n) ? n : item.def;
    return item.min !== undefined ? Math.min(item.max, Math.max(item.min, n)) : n;
  }
  if (item.type === "select") return typeof raw === "string" && raw ? raw : item.def;
  return item.options && !item.options.some(([v]) => String(v) === String(raw)) ? item.def : raw;
}

const item = (k) => ALL.find((i) => i.key === k);

function apply(s, src) {
  for (const [k, v] of src) {
    if (!(k in DEFAULTS) || k === "lab") continue;
    s[k] = k === "seed" ? Math.max(1, Math.min(99999, Math.round(Number(v)) || 7)) : coerce(item(k), v);
  }
  return s;
}

export function loadSettings(params) {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { saved = {}; }
  const s = apply({ ...DEFAULTS }, Object.entries(saved));
  if (saved.lab && typeof saved.lab === "object") s.lab = saved.lab;
  return apply(s, params);
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private window or blocked storage: settings last this visit */ }
}

/** A setup: every setting except the lab's draft (the prompt it names travels with it when it is the lab's). */
export function setupOf(s, prompt) {
  return { ...Object.fromEntries(SETUP_KEYS.map((k) => [k, s[k]])), promptObj: prompt };
}

export function applySetup(s, setup) {
  return apply({ ...s }, Object.entries(setup || {}));
}

/** All prompt choices: the built-ins, the lab's applied prompt, and the saved ones ("user:<name>"). */
export function promptChoices(s, saved) {
  const out = Object.entries(BUILTINS).map(([id, p]) => [id, `${p.name} (built in)`]);
  if (s.lab) out.push(["lab", `${s.lab.name || "Prompt lab"} (from the lab)`]);
  for (const name of Object.keys(saved || {})) out.push([`user:${name}`, `${name} (saved)`]);
  return out;
}

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/**
 * Build the panel into `box` for `mode`. ctx: {prompts (saved), setups (saved), promptNote(id)}. onChange(key, value)
 * after every change; onSetup(action, name) for the setups row ("load", "save", "delete").
 */
export function renderSettings(box, s, mode, ctx, onChange, onSetup) {
  box.replaceChildren(setupsRow(ctx.setups, onSetup));
  for (const g of GROUPS) {
    if (g.modes && !g.modes.includes(mode)) continue;
    const sec = el("section", "set-group");
    const head = el("div", "set-head");
    head.append(el("h3", "", g.title));
    if (g.note) head.append(el("p", "set-note", g.note));
    sec.append(head);
    for (const it of g.items) {
      if (it.modes && !it.modes.includes(mode)) continue;
      sec.append(control(it, s, ctx, onChange));
    }
    box.append(sec);
  }
}

function setupsRow(setups, onSetup) {
  const sec = el("section", "set-group setups");
  const head = el("div", "set-head");
  head.append(el("h3", "", "Setups"), el("p", "set-note", "Save every setting under a name and switch between them."));
  const row = el("div", "set-inline");
  const sel = el("select");
  sel.setAttribute("aria-label", "saved setups");
  sel.append(new Option(Object.keys(setups || {}).length ? "Choose a setup" : "No setups yet", ""));
  for (const name of Object.keys(setups || {})) sel.append(new Option(name, name));
  const load = el("button", "ghost small", "Load");
  const del = el("button", "ghost small", "Delete");
  for (const b of [load, del]) b.type = "button";
  load.addEventListener("click", () => sel.value && onSetup("load", sel.value));
  del.addEventListener("click", () => sel.value && onSetup("delete", sel.value));
  row.append(sel, load, del);
  const row2 = el("div", "set-inline");
  const name = el("input");
  Object.assign(name, { placeholder: "Name for the current settings", maxLength: 60, spellcheck: false });
  name.setAttribute("aria-label", "setup name");
  const save = el("button", "small", "Save current");
  save.type = "button";
  const go = () => { const n = name.value.trim(); if (n) onSetup("save", n); else name.focus(); };
  save.addEventListener("click", go);
  name.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  sel.addEventListener("change", () => { if (sel.value) name.value = sel.value; });
  row2.append(name, save);
  sec.append(head, row, row2);
  return sec;
}

function control(it, s, ctx, onChange) {
  const row = el("div", `set-row set-${it.type}`);
  const top = el("div", "set-top");
  const id = `set-${it.key}`;
  const label = el("label", "set-label", it.label);
  label.htmlFor = id;
  top.append(label);
  const help = el("p", "set-help");
  const showHelp = () => {
    const text = it.key === "prompt" ? ctx.promptNote(s.prompt) : it.help ? it.help(s[it.key]) : "";
    help.textContent = text;
    help.hidden = !text;
  };
  if (it.type === "select") {
    const sel = el("select");
    sel.id = id;
    for (const [v, text] of promptChoices(s, ctx.prompts)) sel.append(new Option(text, v));
    sel.value = s[it.key];
    sel.addEventListener("change", () => { s[it.key] = sel.value; showHelp(); onChange(it.key, sel.value); });
    row.append(top, sel);
  } else if (it.type === "seg") {
    const seg = el("div", "seg");
    seg.id = id;
    seg.setAttribute("role", "radiogroup");
    seg.setAttribute("aria-label", it.label);
    for (const [v, text] of it.options) {
      const b = el("button", "", text);
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(String(s[it.key]) === String(v)));
      b.addEventListener("click", () => {
        for (const o of seg.children) o.setAttribute("aria-checked", String(o === b));
        s[it.key] = v;
        showHelp();
        onChange(it.key, v);
      });
      seg.append(b);
    }
    top.append(seg);
    row.append(top);
  } else if (it.type === "range") {
    const out = el("output", "set-val", it.fmt ? it.fmt(s[it.key]) : String(s[it.key]));
    top.append(out);
    const r = el("input");
    Object.assign(r, { type: "range", min: it.min, max: it.max, step: it.step, value: s[it.key], id });
    r.addEventListener("input", () => {
      s[it.key] = Number(r.value);
      out.textContent = it.fmt ? it.fmt(s[it.key]) : String(s[it.key]);
      onChange(it.key, s[it.key]);
    });
    row.append(top, r);
  } else {
    const t = el("button", "switch");
    Object.assign(t, { type: "button", id });
    t.setAttribute("role", "switch");
    t.setAttribute("aria-checked", String(!!s[it.key]));
    t.addEventListener("click", () => {
      s[it.key] = !s[it.key];
      t.setAttribute("aria-checked", String(s[it.key]));
      showHelp();
      onChange(it.key, s[it.key]);
    });
    top.append(t);
    row.append(top);
  }
  showHelp();
  row.append(help);
  return row;
}
