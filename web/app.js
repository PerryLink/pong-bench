// PongBench: the page. Play (you vs the model, real time), Bot match (a bot vs the model, real time), Watch (the upstream
// lockstep benchmark), Prompt lab, Replays. ?view=watch|play|bot|lab|replays opens a view; ?record=60&seed=7 (with any
// setting, e.g. &prompt=upstream) records a Watch run as soon as the model is ready and sets window.__done.
import * as E from "/game/engine.js";
import { BUILTINS, cleanPrompt, questionOf, stateOf } from "/game/prompts.js";
import { Court, frameAt, pathTo, toRow, COLS, COLORS } from "./draw.js";
import { Decider } from "./client.js";
import { ModelDriver } from "./driver.js";
import { Hud } from "./hud.js";
import { Lab } from "./lab.js";
import { Bench } from "./bench.js";
import { openReplays, stop as stopReplays, wireReplays } from "./replays.js";
import { createMatch, serve, advance, decisionState, botControl, BOT_LEVELS } from "/game/realtime.js";
import { loadSettings, saveSettings, renderSettings, setupOf, applySetup, DEFAULTS } from "./settings.js";
import { playLane, WARMUP, POINT_PAUSE_MS } from "./watch.js";
import { summarize } from "/game/stats.js";
import { blip } from "./sound.js";
import { GameLog } from "./gamelog.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const S = loadSettings(params);
const DIRS = { up: -1, down: 1, stay: 0 };
const MOVE_NAMES = ["up", "down", "stay"];
const VIEWS = ["play", "bot", "watch", "bench", "lab", "replays"];
const localStamp = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19);

let hello = {};
let view = VIEWS.includes(params.get("view")) ? params.get("view") : params.has("record") ? "watch" : "play";
const saved = { prompts: {}, setups: {} };
let decider = new Decider(S.transport);
const court = new Court($("court"));
const hud = new Hud();
const glog = new GameLog();
glog.on = S.saveGames;

/* ================================================================ model input */
let inputCache = null, skipStats = 0, tokensText = "";

function appliedPrompt() {
  if (S.prompt === "lab" && S.lab) return cleanPrompt(S.lab) || BUILTINS.compact;
  if (S.prompt.startsWith("user:")) return cleanPrompt({ ...saved.prompts[S.prompt.slice(5)], name: S.prompt.slice(5) }) || BUILTINS.compact;
  return BUILTINS[S.prompt] || BUILTINS.compact;
}

function input() {
  if (!inputCache) {
    const p = appliedPrompt();
    inputCache = { prompt: p, questions: questionOf(p, S.tol), state: (ds) => stateOf(p, ds, S.tol), tol: S.tol };
  }
  return inputCache;
}

const ready = () => !!hello.endpoint && !hello.error;
const NAME = () => hello.config?.name || "the model";

async function postJson(url, body, method = "POST") {
  const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out.detail || `${url}: ${r.status}`);
  return out;
}

/** Input tokens per decision, from the endpoint's own usage counts (when it reports them). */
function noteTokens(usage) {
  if (!usage?.input_tokens) return;
  const t = `${usage.input_tokens} input tokens`;
  if (t !== tokensText) { tokensText = t; showModeLine(); }
}

function inputChanged() {
  inputCache = null;
  skipStats = 2;                                       // a new prompt's first two answers capture its CUDA graphs
  hud.reset();
  tokensText = "";
  const inp = input();
  glog.event("prompt", { prompt: inp.prompt, questions: inp.questions, tol: S.tol });
}

/* ================================================================ real time: Play and Bot match */
const gameCfg = () => ({ crossingS: S.crossingS, speedUp: S.speedUp, paddleH: S.paddleH, paddleSpeed: S.paddleSpeed,
                         pointsToWin: S.pointsToWin });
const rt = { match: createMatch(S.seed, gameCfg()), paused: false, modelDir: 0, keys: new Set(), mouseY: null,
             seen: [], botErr: 0, serveTimer: 0, started: false,
             epoch: 0,                       // +1 at every serve, point, pause, resume and new match: an answer about an
             lastStepAt: performance.now(),  // older epoch is dropped (it described a rally that no longer exists)
             drawEvents: [] };

/** Advance the physics to `now` (fixed 1/240 s steps, so calling it at any moment gives the same game). It runs at
 *  every frame, when a state is sent and when an answer lands: the model sees the state of that instant and its answer
 *  steers the paddle from the instant it arrives, not from the next frame. */
function syncRealtime(now = performance.now()) {
  if (now <= rt.lastStepAt) return;
  const dt = (now - rt.lastStepAt) / 1000;
  rt.lastStepAt = now;
  rt.drawEvents.push(...stepRealtime(dt, now));
}

const driver = new ModelDriver({
  decider: { ask: (...a) => decider.ask(...a) },
  input,
  snapshot: () => {
    syncRealtime();
    return { playing: (view === "play" || view === "bot") && rt.match.status === "playing" && !rt.paused,
             ds: decisionState(rt.match), epoch: rt.epoch };
  },
  cfg: () => ({ inflight: S.inflight, maxRate: S.maxRate, addedMs: S.addedMs, minConf: S.minConf, stayBias: S.stayBias }),
  onAnswer: (a) => {
    if (!a.held) rt.modelDir = DIRS[a.choice];
    const warm = skipStats > 0;
    glog.decision({ ...a, warm }, { dir: rt.modelDir, inflight: S.inflight, raw: a.raw !== a.choice ? a.raw : undefined });
    if (warm) { skipStats -= 1; return; }
    hud.decision(a);
    noteTokens(a.usage);
    if ($("vState").closest("details").open) hud.sees(input().state(a.ds), tokensText);
  },
  onError: (e) => { toast(`The model stopped answering: ${e.message}`); pause(); },
});

function logHeader(mode) {
  const inp = input();
  return {
    settings: { ...S, lab: undefined }, prompt: inp.prompt, questions: inp.questions, tol: S.tol, transport: S.transport,
    model: { name: NAME(), connector: hello.endpoint?.kind, model: hello.endpoint?.model, endpoint: hello.endpoint?.url },
    game: mode === "watch" ? { lockstep: true, seed: S.seed, warmup: WARMUP, pointPauseMs: POINT_PAUSE_MS }
      : { ...rt.match.cfg, court: { w: 160, h: 100 }, left: mode === "bot" ? { bot: S.bot, ...BOT_LEVELS[S.bot] } : { human: true, fair: S.fair } },
    decisions: { inflight: S.inflight, maxRate: S.maxRate, addedMs: S.addedMs, minConf: S.minConf, stayBias: S.stayBias },
    fields: { d: "t: answer used (ms from start), ts: state sent, sent: exact state, ds: game state (bx by vx vy py ph iy dir), rule, ans: the move played, raw: the model's plain top answer when the stay handicap changed it, p: [up, down, stay], rt: round trip, sv: model, w: queue wait, age: snapshot to use, held, warm, dir: paddle direction after",
              x: "s: [ball x, ball y, left paddle y, right paddle y, model dir]" },
  };
}

function endMatchLog(result) {
  if (!glog.open) return;
  const m = rt.match;
  glog.end(result, {
    score: m.score, hits: m.hits, longest: m.longest, stale: driver.stale, outdated: driver.outdated,
    index: { prompt: input().prompt.name, score: `${m.score[0]}:${m.score[1]}`, modelMisses: m.score[0], leftMisses: m.score[1], model: NAME(),
             winner: m.status === "over" ? (m.score[0] > m.score[1] ? (view === "bot" ? "bot" : "you") : "model") : null },
  });
}

function newMatch() {
  endMatchLog(rt.started ? "restart" : "unplayed");
  clearTimeout(rt.serveTimer);
  rt.match = createMatch(S.seed + Math.floor(Math.random() * 100000), gameCfg());
  rt.modelDir = 0;
  rt.epoch += 1;
  rt.paused = false;
  rt.started = false;
  hud.reset();
  court.jump();
  showOverlay();
  renderControls();
}

function serveNow() {
  if (!ready()) return;
  if (!rt.started) glog.start(view, logHeader(view));
  syncRealtime();
  rt.started = true;
  rt.paused = false;
  rt.modelDir = 0;                     // every rally starts still: the paddle waits for its first answer
  rt.epoch += 1;
  rt.match = serve({ ...rt.match, cfg: { ...rt.match.cfg, ...gameCfg() } });
  glog.event("serve", { ball: rt.match.ball, left: rt.match.left.y, right: rt.match.right.y, cfg: rt.match.cfg });
  rt.botErr = botError();
  hideOverlay();
  driver.start();
  renderControls();
}

function botError() {
  const lvl = BOT_LEVELS[S.bot] || BOT_LEVELS.medium;
  return (Math.random() * 2 - 1) * lvl.err;
}

function leftControl(now) {
  if (view === "bot") {
    const lvl = BOT_LEVELS[S.bot] || BOT_LEVELS.medium;
    rt.seen.push({ t: now, m: rt.match });
    while (rt.seen.length > 2 && rt.seen[1].t <= now - lvl.lagS * 1000) rt.seen.shift();
    return botControl(rt.match, rt.seen[0].m, rt.botErr);
  }
  const up = rt.keys.has("ArrowUp") || rt.keys.has("w") || rt.keys.has("W");
  const down = rt.keys.has("ArrowDown") || rt.keys.has("s") || rt.keys.has("S");
  if (up || down) { rt.mouseY = null; return { dir: (down ? 1 : 0) - (up ? 1 : 0) }; }
  return rt.mouseY === null ? { dir: 0 } : { target: rt.mouseY };
}

function leftSpeed() {
  if (view === "bot") return S.paddleSpeed * (BOT_LEVELS[S.bot] || BOT_LEVELS.medium).speed;
  return S.fair ? S.paddleSpeed : 2000;
}

function stepRealtime(dt, now) {
  if (rt.paused || !rt.started) return [];
  const playing = rt.match.status === "playing";
  rt.match = advance(rt.match, dt, { left: leftControl(now), right: { dir: playing ? rt.modelDir : 0 } },
                     { left: leftSpeed(), right: S.paddleSpeed });
  const ev = rt.match.events;
  for (const info of rt.match.info) {
    const { type, ...data } = info;
    glog.event(type, { ...data, ball: rt.match.ball, left: rt.match.left.y, right: rt.match.right.y, modelDir: rt.modelDir });
  }
  for (const e of ev) {
    if (S.sound) blip(e);
    if (e === "hit-right" || e === "hit-left") rt.botErr = botError();
  }
  if (ev.some((e) => e.startsWith("miss"))) {
    court.jump();
    rt.modelDir = 0;
    rt.epoch += 1;
    const leftScored = ev.includes("miss-right");
    if (rt.match.status === "over") {
      endMatchLog("over");
      showOverlay();
    } else {
      toast(leftScored ? (view === "bot" ? "Point to the bot" : "Point to you") : `Point to ${NAME()}`);
      rt.serveTimer = setTimeout(() => { if (!rt.paused && rt.match.status === "point") serveNow(); }, 900);
    }
  }
  return ev;
}

function sceneRealtime(events) {
  const m = rt.match, playing = m.status === "playing";
  const ds = playing ? decisionState(m) : null;
  return {
    ball: m.ball, score: m.score, events, effects: S.effects, trail: S.trail && playing,
    left: { y: m.left.y, h: m.cfg.paddleH, color: view === "bot" ? COLORS.wall : COLORS.you },
    right: { y: m.right.y, h: m.cfg.paddleH, color: COLORS.model },
    guide: S.guide && playing ? pathTo(m.ball, "right") : null,
    target: S.guide && ds ? ds.interceptY : null,
  };
}

function realtimeGameStats() {
  const m = rt.match, them = view === "bot" ? "bot" : "your";
  const speed = m.ball.vx ? Math.abs(m.ball.vx) / (152 / m.cfg.crossingS) : 1;
  return [[`${m.score[0]} : ${m.score[1]}`, view === "bot" ? "bot : model" : "you : model"], [String(m.hits[0]), `${them} returns`],
    [String(m.hits[1]), "model returns"], [String(m.rally), "rally"], [String(m.longest), "longest rally"], [`${speed.toFixed(2)}x`, "ball speed"]];
}

/* ================================================================ Watch: the lockstep benchmark */
const watch = { ctl: null, ticks: [], t0: 0, gap: 40, ds: null, totals: null, recording: 0, recSeconds: 60 };

async function runWatch(seconds) {
  if (watch.ctl || !ready()) return null;
  hud.reset();
  watch.ticks = [];
  watch.ds = null;
  watch.totals = { d: 0, returns: 0, misses: 0, games: 1 };
  glog.start("watch", logHeader("watch"));
  let result = "stopped";
  watch.ctl = new AbortController();
  watch.recording = Number.isFinite(seconds) ? seconds : 0;
  hideOverlay();
  renderControls();
  const seed = S.seed;
  try {
    const out = await playLane({
      seed, seconds, signal: watch.ctl.signal, decider, input, bias: () => S.stayBias,
      hooks: {
        status: (s) => { $("modeLine").textContent = s || modeText(); },
        tick: (tick, extra) => {
          watch.t0 = extra.t0;
          const prev = watch.ticks.at(-1);
          watch.ticks.push(tick);
          if (watch.ticks.length > 60) watch.ticks.splice(0, watch.ticks.length - 60);
          if (prev && prev.g !== tick.g) watch.totals.games += 1;
          if (prev && prev.g === tick.g && tick.s0 > prev.s0) {
            watch.totals.misses += 1;
            court.jump();
            glog.event("miss-right", { y: extra.ds?.interceptY ?? null, paddleY: tick.ry, score: [tick.s0, tick.s1] });
          }
          if (tick.m < 0) { if (tick.t > 0) glog.event("serve", { game: tick.g }); return; }
          if (tick.r) glog.event("hit-right", { y: tick.by, paddleY: tick.ry });
          if (prev) watch.gap = 0.8 * watch.gap + 0.2 * Math.min(250, Math.max(10, tick.t - prev.t));
          watch.totals.d += 1;
          watch.totals.returns += tick.r;
          watch.ds = extra.ds;
          if (S.sound && tick.r) blip("hit-right");
          const a = extra.answer, warm = skipStats > 0;
          glog.decision({ ...a, ds: extra.ds, sent: extra.sent, rule: MOVE_NAMES[tick.e], held: false, age: a.ms, warm },
                        { tick: tick.t, r: tick.r || undefined, paddleAfter: tick.ry, raw: a.raw !== a.choice ? a.raw : undefined });
          if (warm) { skipStats -= 1; return; }
          hud.decision({ ...a, rule: MOVE_NAMES[tick.e], held: false, age: a.ms, ds: extra.ds });
          noteTokens(a.usage);
          hud.sees(extra.sent, tokensText);
        },
      },
    });
    result = watch.recording ? "recorded" : "finished";
    if (watch.recording) return await saveRecording(seed, out);
  } catch (e) {
    if (e.name !== "AbortError") { result = "error"; toast(`Stopped: ${e.message}`); throw e; }
  } finally {
    glog.end(result, { totals: watch.totals, index: { prompt: input().prompt.name, seed, returns: watch.totals.returns,
                                                      modelMisses: watch.totals.misses, model: NAME() } });
    watch.ctl = null;
    watch.recording = 0;
    renderControls();
    showModeLine();
    showOverlay();
  }
  return null;
}

async function saveRecording(seed, { ticks, seconds }) {
  const summary = summarize(ticks, seconds), inp = input();
  const rec = {
    version: 2, model: hello.endpoint?.model || "", model_name: NAME(), endpoint: hello.endpoint?.url, seed,
    seconds: Math.round(seconds), created: localStamp(), warmup: WARMUP, point_pause_ms: POINT_PAUSE_MS,
    settings: { prompt: S.prompt, promptName: inp.prompt.name, promptObj: inp.prompt, tol: S.tol, transport: S.transport, stayBias: S.stayBias },
    summary, cols: COLS, snaps: ticks.map(toRow),
  };
  const body = await postJson("/api/recordings", rec);
  toast(`Saved: ${summary.dps} decisions/s, ${summary.agree}% match the rule. Compare it in Replays.`);
  return { name: body.name, summary };
}

function sceneWatch() {
  const t = performance.now() - watch.t0 - watch.gap;    // one decision behind, so the ball eases between ticks
  const f = frameAt(watch.ticks, t) || watch.ticks.at(-1);
  if (!f) return null;
  const ds = watch.ds;
  return {
    ball: { x: f.bx, y: f.by }, score: [f.s0, f.s1], effects: S.effects, trail: S.trail, events: [],
    left: { y: f.ly, h: 20, color: COLORS.wall }, right: { y: f.ry, h: 20, color: COLORS.model },
    guide: S.guide && ds && ds.dir === "toward" ? pathTo({ x: f.bx, y: f.by, vx: ds.ball.vx, vy: ds.ball.vy }, "right") : null,
    target: S.guide ? f.ty : null,
  };
}

/* ================================================================ overlay, toast, controls */
function button(text, fn, ghost = false) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = text;
  if (ghost) b.className = "ghost";
  b.addEventListener("click", fn);
  return b;
}

function hideOverlay() { $("overlay").hidden = true; }

function overlay(title, html, buttons, stats = []) {
  $("ovTitle").textContent = title;
  $("ovText").innerHTML = html;
  $("ovStats").replaceChildren(...stats.map(([v, l]) => {
    const d = document.createElement("div");
    d.innerHTML = "<b></b><span></span>";
    d.children[0].textContent = v;
    d.children[1].textContent = l;
    return d;
  }));
  $("ovButtons").replaceChildren(...buttons);
  $("overlay").hidden = false;
}

const fmtMs = (v) => (Number.isFinite(v) ? `${v.toFixed(1)} ms` : "–");
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function showOverlay() {
  if (!["play", "bot", "watch"].includes(view)) return;
  if (!hello.endpoint && !hello.error) return overlay("Connecting", "Waiting for the PongBench server.", []);
  if (hello.error || !hello.endpoint) return overlay("No endpoint", `${escapeHtml(hello.error || "No endpoint is active.")} Pick one in the Bench tab.`, [button("Open Bench", () => setView("bench"))]);
  if (view === "watch") {
    if (watch.ctl) return hideOverlay();
    return overlay(`Watch ${NAME()} play`,
      "The upstream rules (the Rally suite): one decision moves the ball one step, against a wall that never misses. The ball moves exactly as fast as the model answers.",
      [button("Start", () => runWatch(Infinity).catch(() => {})), button(`Record ${watch.recSeconds} s`, () => runWatch(watch.recSeconds).catch(() => {}), true)]);
  }
  const m = rt.match, who = view === "bot" ? `${BOT_LEVELS[S.bot]?.label || "Medium"} bot` : "You";
  if (m.status === "over") {
    const leftWon = m.score[0] > m.score[1];
    const title = view === "bot" ? (leftWon ? "The bot wins" : `${NAME()} wins`) : (leftWon ? "You win" : `${NAME()} wins`);
    return overlay(title, `${m.score[0]} : ${m.score[1]}. Longest rally ${m.longest}.`,
      [button("Play again", () => { newMatch(); serveNow(); }), button("Settings", () => openDrawer(true), true)],
      [[Number.isFinite(hud.rate.perSecond) ? hud.rate.perSecond.toFixed(1) : "–", "decisions/s"],
       [fmtMs(hud.react.q(0.5)), "reaction p50"], [hud.n.d ? `${((100 * hud.n.ok) / hud.n.d).toFixed(1)}%` : "–", "matches the rule"]]);
  }
  if (rt.paused && rt.started) {
    return overlay("Paused", "Press <kbd>Space</kbd> to resume.", [button("Resume", resume), button("Restart", newMatch, true)]);
  }
  if (!rt.started) {
    const how = view === "bot" ? "The bot plays the left paddle, the model the right." :
      "Move with <kbd>W</kbd> <kbd>S</kbd>, the arrow keys or the mouse. <kbd>Space</kbd> serves and pauses.";
    return overlay(`${who} vs ${NAME()}`, `${how} First to ${S.pointsToWin}.`, [button(view === "bot" ? "Start" : "Serve", serveNow)]);
  }
  return hideOverlay();
}

function pause() {
  if (!rt.started || rt.match.status === "over") return;
  syncRealtime();
  rt.paused = true;
  rt.epoch += 1;
  clearTimeout(rt.serveTimer);
  glog.event("pause");
  showOverlay();
  renderControls();
}

function resume() {
  rt.lastStepAt = performance.now();   // no time passes while paused
  rt.paused = false;
  rt.modelDir = 0;
  rt.epoch += 1;
  glog.event("resume");
  hideOverlay();
  if (rt.match.status === "point") serveNow();
  renderControls();
}

let toastTimer = 0;
function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 1800);
}

function renderControls() {
  const box = $("controls");
  box.replaceChildren();
  if (view === "watch") {
    const running = !!watch.ctl;
    box.append(running ? button("Stop", () => watch.ctl?.abort(), true) : button("Start", () => runWatch(Infinity).catch(() => {})));
    const seed = document.createElement("label");
    seed.innerHTML = 'Seed <input type="number" min="1" max="99999">';
    const inp = seed.querySelector("input");
    inp.value = S.seed;
    inp.disabled = running;
    inp.addEventListener("change", () => { S.seed = Math.max(1, Math.min(99999, Math.round(Number(inp.value)) || 7)); inp.value = S.seed; saveSettings(S); });
    box.append(seed);
    const seg = document.createElement("div");
    seg.className = "seg";
    for (const v of [30, 60, 120]) {
      const b = button(`${v} s`, () => { watch.recSeconds = v; renderControls(); showOverlay(); });
      b.setAttribute("aria-checked", String(watch.recSeconds === v));
      seg.append(b);
    }
    const rec = button(watch.recording ? `Recording ${watch.recording} s` : "Record", () => runWatch(watch.recSeconds).catch(() => {}), true);
    rec.disabled = running;
    box.append(seg, rec);
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = "12 untimed warm-up decisions first";
    box.append(hint);
    return;
  }
  if (view === "play" || view === "bot") {
    const label = rt.match.status === "over" ? "Play again" : rt.started && !rt.paused ? "Pause" : rt.started ? "Resume" : view === "bot" ? "Start" : "Serve";
    box.append(button(label, () => {
      if (rt.match.status === "over") { newMatch(); serveNow(); } else if (!rt.started) serveNow(); else if (rt.paused) resume(); else pause();
    }));
    box.append(button("Restart", newMatch, true));
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.innerHTML = view === "play" ? "<kbd>W</kbd> <kbd>S</kbd>, arrows or mouse. <kbd>Space</kbd> serve or pause. <kbd>R</kbd> restart."
      : "<kbd>Space</kbd> start or pause. <kbd>R</kbd> restart.";
    box.append(hint);
  }
}

function modeText() {
  const p = input().prompt.name;
  const cost = tokensText ? ` (${tokensText})` : "";
  if (view === "watch") return `Upstream rules. Prompt: ${p}${cost}`;
  return `Prompt: ${p}${cost}. ${S.transport === "ws" ? "WebSocket" : "HTTP"}${S.addedMs ? `, +${S.addedMs} ms` : ""}`;
}

function showModeLine() {
  $("modeLine").textContent = modeText();
  $("leftName").textContent = view === "play" ? "You" : view === "bot" ? `Bot (${BOT_LEVELS[S.bot]?.label || ""})` : "Wall";
}

/* ================================================================ views */
let lab = null, bench = null;

function setView(v) {
  if (!VIEWS.includes(v)) return;
  const leaving = view;
  if (leaving === "watch" && v !== "watch") watch.ctl?.abort();
  if ((leaving === "play" || leaving === "bot") && v !== leaving) {
    pause();
    driver.stop();
    if (["play", "bot", "watch"].includes(v)) endMatchLog("left");   // the lab and replays keep the game (it resumes)
  }
  if (leaving === "replays" && v !== "replays") stopReplays();
  view = v;
  for (const b of document.querySelectorAll(".tabs button")) b.setAttribute("aria-selected", String(b.dataset.view === v));
  const game = ["play", "bot", "watch"].includes(v);
  $("viewGame").hidden = !game;
  $("viewLab").hidden = v !== "lab";
  $("viewBench").hidden = v !== "bench";
  $("viewReplays").hidden = v !== "replays";
  if ((v === "play" || v === "bot") && (v !== leaving || !rt.started)) newMatch();
  if (v === "lab") lab.open();
  if (v === "bench") bench.open().catch((e) => toast(`Bench: ${e.message}`));
  if (v === "replays") openReplays().catch((e) => { $("replayNote").textContent = `Could not load the recordings: ${e.message}`; });
  if (game) { hud.reset(); renderControls(); showModeLine(); showOverlay(); renderDrawer(); }
}

/* ================================================================ settings drawer */
function openDrawer(open) {
  $("drawer").hidden = !open;
  $("openSettings").setAttribute("aria-expanded", String(open));
  if (open) {
    if (!["play", "bot", "watch"].includes(view)) setView("play");
    renderDrawer();
  }
}

function promptNote(id) {
  if (id === "lab") return "Applied from the Prompt lab.";
  if (id.startsWith("user:")) return "A prompt you saved in the Prompt lab.";
  return BUILTINS[id]?.note || "";
}

function renderDrawer() {
  if ($("drawer").hidden) return;
  renderSettings($("settingsBox"), S, view, { prompts: saved.prompts, setups: saved.setups, promptNote }, onSetting, onSetup);
}

function onSetting(key) {
  saveSettings(S);
  if (key !== "prompt" && key !== "tol") glog.event("setting", { key, value: S[key] });
  if (key === "saveGames") { if (!S.saveGames) glog.end("logging off"); glog.on = S.saveGames; }
  if (key === "prompt" || key === "tol") inputChanged();
  if (key === "transport") { decider.close(); decider = new Decider(S.transport); hud.reset(); }
  if (key === "inflight") driver.restart();
  if (key === "pointsToWin") rt.match = { ...rt.match, cfg: { ...rt.match.cfg, pointsToWin: S.pointsToWin } };
  if (key === "pointsToWin" || key === "bot") showOverlay();
  showModeLine();
}

async function onSetup(action, name) {
  try {
    if (action === "save") {
      await postJson(`/api/store/setups/${encodeURIComponent(name)}`, setupOf(S, input().prompt), "PUT");
      toast(`Saved setup "${name}"`);
    } else if (action === "delete") {
      await fetch(`/api/store/setups/${encodeURIComponent(name)}`, { method: "DELETE" });
      toast(`Deleted setup "${name}"`);
    } else if (action === "load") {
      const setup = saved.setups[name];
      Object.assign(S, applySetup(S, setup));
      const known = BUILTINS[S.prompt] || (S.prompt.startsWith("user:") && saved.prompts[S.prompt.slice(5)]);
      if (!known && setup.promptObj) { S.lab = setup.promptObj; S.prompt = "lab"; }
      saveSettings(S);
      decider.close();
      decider = new Decider(S.transport);
      inputChanged();
      driver.restart();
      toast(`Loaded setup "${name}"`);
    }
    await loadSaved();
    renderDrawer();
    showModeLine();
  } catch (e) { toast(`Setup: ${e.message}`); }
}

async function loadSaved() {
  try {
    const [p, s] = await Promise.all([fetch("/api/store/prompts").then((r) => r.json()), fetch("/api/store/setups").then((r) => r.json())]);
    saved.prompts = p || {};
    saved.setups = s || {};
  } catch { /* the store is optional: built-ins still work */ }
}

/* ================================================================ status and system */
async function poll() {
  try {
    hello = await (await fetch("/api/state", { cache: "no-store" })).json();
  } catch {
    hello = { error: "The PongBench server is not answering (was its console closed?)" };
  }
  $("dot").className = `dot ${ready() ? "ready" : "error"}`;
  $("modelName").textContent = hello.config?.name || "No endpoint";
  const e = hello.endpoint;
  $("status").textContent = ready() ? `${e.kind}${e.model ? `, ${e.model}` : ""}${hello.config?.key === "missing" ? ", key missing" : ""}` : hello.error || "no endpoint";
  $("rightName").textContent = NAME();
  showOverlay();
  showModeLine();
}

/** The endpoint's counters (calls, errors, tokens) once a second, for the System panel. */
async function pollEndpoint() {
  if (document.visibilityState === "visible") {
    try {
      const st = await (await fetch("/api/state", { cache: "no-store" })).json();
      const changed = st.config?.id !== hello.config?.id || st.error !== hello.error;
      hello = st;
      hud.system({ endpoint: st.endpoint, config: st.config });
      if (changed) { inputChanged(); poll(); }
    } catch { /* next second */ }
  }
  setTimeout(pollEndpoint, 1000);
}

function sampleDs() {
  if (view === "watch" && watch.ds) return watch.ds;
  if (rt.match.status === "playing") return decisionState(rt.match);
  return E.toDecisionState(E.applyTick(E.applyTick(E.serve(E.createEngine(7)), "stay"), "up"), "right");
}

/* ================================================================ input */
function wireInput() {
  const typing = (e) => ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName);
  const realtime = () => view === "play" || view === "bot";
  window.addEventListener("keydown", (e) => {
    if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (["ArrowUp", "ArrowDown", "w", "W", "s", "S"].includes(e.key) && view === "play") {
      rt.keys.add(e.key);
      e.preventDefault();
      return;
    }
    if (e.key === "Escape" && !$("drawer").hidden) { openDrawer(false); return; }
    if (!realtime()) return;
    if (e.key === " ") {
      e.preventDefault();
      if (e.target.tagName === "BUTTON") e.target.blur();
      if (rt.match.status === "over") { newMatch(); serveNow(); } else if (!rt.started) serveNow(); else if (rt.paused) resume(); else pause();
    } else if (e.key === "p" || e.key === "P" || e.key === "Escape") pause();
    else if (e.key === "r" || e.key === "R") newMatch();
  });
  window.addEventListener("keyup", (e) => rt.keys.delete(e.key));
  window.addEventListener("blur", () => rt.keys.clear());
  const cv = $("court");
  const toY = (e) => {
    const r = cv.getBoundingClientRect(), k = Math.min(r.width / 160, r.height / 100);
    return (e.clientY - r.top - (r.height - 100 * k) / 2) / k;
  };
  cv.addEventListener("pointermove", (e) => { if (view === "play") rt.mouseY = toY(e); });
  cv.addEventListener("pointerdown", (e) => { if (view === "play") { rt.mouseY = toY(e); cv.setPointerCapture(e.pointerId); } });
  document.addEventListener("visibilitychange", () => { if (document.hidden && realtime()) pause(); });
}

/* ================================================================ the frame loop */
let lastFrame = performance.now();
function frame(now) {
  const dt = (now - lastFrame) / 1000;
  lastFrame = now;
  if (!$("viewGame").hidden) {
    const t0 = performance.now();
    let scene;
    if (view === "watch") {
      scene = sceneWatch();
      if (watch.totals) {
        hud.game([[String(watch.totals.d), "decisions"], [String(watch.totals.returns), "returns"], [String(watch.totals.misses), "misses"],
          [String(watch.totals.games), "games"], [watch.ticks.length ? `${(watch.ticks.at(-1).t / 1000).toFixed(0)} s` : "0 s", "time"],
          [watch.recording ? "recording" : watch.ctl ? "live" : "stopped", "run"]]);
      }
    } else {
      const status = rt.match.status;
      syncRealtime();
      scene = sceneRealtime(rt.drawEvents);
      rt.drawEvents = [];
      if (status !== rt.match.status) renderControls();
      hud.game(realtimeGameStats());
      const m = rt.match;
      if (m.status === "playing" && !rt.paused) glog.track(now, [m.ball.x, m.ball.y, m.left.y, m.right.y, rt.modelDir]);
    }
    court.draw(scene);
    hud.log = glog.open ? `${Math.round(glog.bytes / 1024)} KB saved` : S.saveGames ? "waiting for a game" : "off";
    hud.frame(performance.now() - t0, now);
    hud.paint(now);
  }
  requestAnimationFrame(frame);
}

/* ================================================================ start */
async function main() {
  for (const b of document.querySelectorAll(".tabs button")) b.addEventListener("click", () => setView(b.dataset.view));
  $("openSettings").addEventListener("click", () => openDrawer($("drawer").hidden));
  $("closeSettings").addEventListener("click", () => openDrawer(false));
  $("resetSettings").addEventListener("click", () => {
    Object.assign(S, { ...DEFAULTS });
    saveSettings(S);
    decider.close();
    decider = new Decider(S.transport);
    inputChanged();
    driver.restart();
    renderDrawer();
    showModeLine();
    toast("Settings reset to defaults");
  });
  lab = new Lab({
    settings: () => S, saved: () => saved.prompts, applied: () => input().prompt, decider: () => decider, ready,
    sample: sampleDs,
    apply: (p) => { S.lab = p; S.prompt = "lab"; saveSettings(S); inputChanged(); showModeLine(); },
    save: async (name, p) => { await postJson(`/api/store/prompts/${encodeURIComponent(name)}`, p, "PUT"); await loadSaved(); },
    remove: async (name) => {
      const r = await fetch(`/api/store/prompts/${encodeURIComponent(name)}`, { method: "DELETE" });
      if (!r.ok) throw new Error(`the server answered ${r.status}`);
      if (S.prompt === `user:${name}`) { S.prompt = "compact"; saveSettings(S); inputChanged(); }
      await loadSaved();
    },
    pauseGame: () => { watch.ctl?.abort(); pause(); driver.stop(); },
  });
  bench = new Bench({ prompt: () => input().prompt, endpointChanged: () => { poll(); inputChanged(); } });
  wireReplays();
  wireInput();
  await loadSaved();
  setView(view);
  requestAnimationFrame(frame);
  await poll();
  pollEndpoint();
  showOverlay();
  const rec = Number(params.get("record"));
  if (rec > 0) {
    window.__done = ready()
      ? await runWatch(rec).then((out) => ({ ok: true, ...out }), (e) => ({ ok: false, error: String(e.message || e) }))
      : { ok: false, error: hello.error || "no endpoint is ready" };
  }
}

window.__pong = { S, hud, rt, watch, input };
main();
