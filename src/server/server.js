// The app's server: static files, the decision channel (the page never sees an API key: it sends the state and the
// question here, and this process calls the endpoint), the Bench runner with live progress, results, saved games,
// recordings, and saved prompts and setups. Binds to 127.0.0.1 by default.
//
// Other websites cannot use it: requests must name this server in Host (no DNS rebinding), browsers' Origin must be
// this app's own (no cross-site requests or WebSockets), bodies must be JSON (no preflight-free form posts), and
// configs are picked by name from configs/ only. PONGBENCH_ALLOWED_HOSTS=a,b adds host names (e.g. for a LAN).
//
//   WS   /ws                    {id, state, questions} -> {id, choice, probs, probSource, ms, serverMs, usage} | {id, error}
//   POST /api/decide            the same over HTTP
//   GET  /api/state             the active endpoint (nothing secret) and its call counters
//   GET  /api/configs, POST /api/config {id}           list the endpoint configs, switch the active one
//   POST /api/bench/start, POST /api/bench/stop, GET /api/bench/events (Server-Sent Events), GET /api/bench/status
//   GET  /api/results, GET /api/results/<id>, GET /api/leaderboard
//   POST /api/games/<id>, GET /api/games              every game played in the app, as JSON lines (data/games/)
//   GET/POST /api/recordings, GET /api/recordings/<n>  Watch recordings for Replays (data/recordings/)
//   GET/PUT/DELETE /api/store/<prompts|setups>[/<name>]  saved prompts and setups (data/store/)
import { createServer } from "node:http";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, renameSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { acceptWebSocket } from "./ws.js";
import { ROOT, loadConfig, loadNamedConfig, listConfigs, publicConfig } from "../config.js";
import { BOT_LEVELS } from "../game/realtime.js";
import { connect } from "../connectors/index.js";
import { runBench, saveRun, inputFor, RESULTS_DIR, SUITES } from "../bench/runner.js";
import { loadDecisions, SUITE_DIR } from "../bench/suites.js";
import { readScorecards, renderLeaderboard, writeLeaderboard } from "../bench/report.js";

const WEB = join(ROOT, "web"), GAME = join(ROOT, "src", "game"), DATA = process.env.PONGBENCH_DATA || join(ROOT, "data");
const GAMES = join(DATA, "games"), RECS = join(DATA, "recordings"), STORE = join(DATA, "store");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
                ".css": "text/css; charset=utf-8", ".json": "application/json", ".md": "text/markdown; charset=utf-8",
                ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
const NAME = /^[A-Za-z0-9_.-]{1,100}$/;
const TRACK_OK = ["standard", "compact", "minimal", "reasoning"];
const LIMITS = { body: 256 * 1024, decide: 64 * 1024, recording: 8 * 1024 * 1024, chunk: 2 * 1024 * 1024, game: 64 * 1024 * 1024 };
const LOOPBACK = ["127.0.0.1", "localhost", "[::1]", "::1"];
const RESERVED = new Set(["__proto__", "constructor", "prototype"]);

export async function serve({ config, port = 8800, host = "127.0.0.1" } = {}) {
  // one bad request must never stop the server
  process.on("unhandledRejection", (e) => console.error(`unhandled: ${e?.message || e}`));
  const app = { cfg: null, connector: null, error: "", bench: null, benchLog: [], listeners: new Set() };

  async function activate(cfg) {
    const connector = await connect(cfg);
    await app.connector?.close();
    Object.assign(app, { cfg, connector, error: "" });
    return cfg;
  }
  try {
    await activate(loadConfig(config || "mock-oracle"));    // the command line may name a file
  } catch (e) {
    app.error = e.message;
    console.error(`endpoint: ${e.message} (pick another in the app, or fix the config)`);
  }

  const state = () => ({
    pongbench: "1.0.0", error: app.error, config: app.cfg ? publicConfig(app.cfg) : null,
    endpoint: app.connector ? { kind: app.connector.kind, url: app.connector.url, model: app.connector.model, stats: app.connector.stats } : null,
    bench: app.bench ? { running: true, started: app.bench.started, options: app.bench.options } : { running: false },
    suites: SUITES,
  });

  async function decide(msg) {
    if (!app.connector) throw new Error(app.error || "no endpoint is active");
    if (!msg || typeof msg !== "object" || !msg.questions) throw new Error("send {state, questions}");
    const d = await app.connector.decide({ state: msg.state, questions: msg.questions });
    return { choice: d.choice, probs: d.probs, probSource: d.probSource, ms: Math.round(d.ms * 100) / 100,
             serverMs: d.serverMs, usage: d.usage };
  }

  /** Four decisions, one of each kind: is the endpoint wired up right? */
  async function check({ track = "standard" } = {}) {
    if (!app.connector) throw new Error(app.error || "no endpoint is active");
    const input = inputFor(TRACK_OK.includes(track) ? track : "standard");
    const items = loadDecisions({ quick: true }).items;
    const rows = [];
    for (const kind of ["up", "down", "away", "covered"]) {
      const it = items.find((x) => x.kind === kind);
      try {
        const d = await app.connector.decide({ state: input.state(it.ds), questions: input.questions });
        rows.push({ kind, rule: it.rule, choice: d.choice, right: d.choice === it.rule, ms: d.ms, probs: d.probs, probSource: d.probSource });
      } catch (e) {
        rows.push({ kind, rule: it.rule, error: `${e.message}${e.detail ? `: ${String(e.detail).slice(0, 160)}` : ""}` });
      }
    }
    return { rows };
  }

  function emit(event) {
    const line = `data: ${JSON.stringify(event)}\n\n`;
    if (event.type !== "progress") app.benchLog.push(event);
    else app.benchLog[app.benchLog.length - 1]?.type === "progress" ? (app.benchLog[app.benchLog.length - 1] = event) : app.benchLog.push(event);
    for (const res of app.listeners) res.write(line);
  }

  async function startBench(opts) {
    if (app.bench) throw new Error("a run is already going");
    if (!app.connector) throw new Error(app.error || "no endpoint is active");
    const suites = (opts.suites || ["decisions", "rally"]).filter((s) => SUITES.includes(s));
    if (!suites.length) throw new Error("pick at least one suite");
    const track = opts.track || "standard";
    if (track === "custom" ? !opts.prompt || typeof opts.prompt !== "object" : !TRACK_OK.includes(track)) {
      throw new Error(`track must be one of ${TRACK_OK.join(", ")}, or custom with a prompt`);
    }
    const bots = opts.bots === undefined || opts.bots === null ? [] : opts.bots;
    if (!Array.isArray(bots) || bots.length > 4 || !bots.every((b) => typeof b === "string" && Object.hasOwn(BOT_LEVELS, b))) {
      throw new Error(`bots are up to four of ${Object.keys(BOT_LEVELS).join(", ")}`);
    }
    const ctl = new AbortController();
    const options = { suites, track, quick: !!opts.quick, concurrency: clampInt(opts.concurrency, 1, 32, 4),
                      stayBias: Math.max(0, Math.min(1, Number(opts.stayBias) || 0)), tol: clampInt(opts.tol, 1, 20, 5),
                      label: String(opts.label || "").slice(0, 120),
                      arena: { bots: bots.length ? bots : undefined, maxSeconds: clampInt(opts.arenaSeconds, 10, 600, 150) } };
    app.bench = { ctl, started: new Date().toISOString(), options };
    app.benchLog = [];
    emit({ type: "started", options, endpoint: app.cfg.name });
    (async () => {
      try {
        const out = await runBench({ connector: app.connector, config: app.cfg, ...options, prompt: opts.prompt || null,
                                     onEvent: emit, signal: ctl.signal });
        const saved = saveRun(out);
        writeLeaderboard(RESULTS_DIR);
        emit({ type: "saved", id: saved.id, score: out.result.score });
      } catch (e) {
        emit({ type: e.name === "AbortError" ? "stopped" : "error", message: e.message });
      } finally {
        app.bench = null;
      }
    })();
    return { started: true };
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    const refused = guard(req, server.address().port, host);
    if (refused) return json(res, { error: refused.error }, refused.status);
    try {
      if (p === "/api/state") return json(res, state());
      if (p === "/api/configs") return json(res, listConfigs());
      if (p === "/api/config" && req.method === "POST") {
        const { id } = await body(req);
        try { const cfg = await activate(loadNamedConfig(id)); return json(res, { ok: true, config: publicConfig(cfg) }); }
        catch (e) { app.error = e.message; return json(res, { ok: false, error: e.message }, 400); }
      }
      if (p === "/api/decide" && req.method === "POST") return json(res, await decide(await body(req, LIMITS.decide)));
      if (p === "/api/check" && req.method === "POST") return json(res, await check(await body(req)));
      if (p === "/api/bench/start" && req.method === "POST") return json(res, await startBench(await body(req)));
      if (p === "/api/bench/stop" && req.method === "POST") { app.bench?.ctl.abort(); return json(res, { stopping: !!app.bench }); }
      if (p === "/api/bench/status") return json(res, { running: !!app.bench, log: app.benchLog.slice(-200) });
      if (p === "/api/bench/events") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        res.write(`data: ${JSON.stringify({ type: "hello", running: !!app.bench })}\n\n`);
        app.listeners.add(res);
        req.on("close", () => app.listeners.delete(res));
        return;
      }
      if (p === "/api/results") {
        return json(res, readScorecards(RESULTS_DIR).sort((a, b) => b.created.localeCompare(a.created)).map((c) => ({
          id: c.id, created: c.created, name: c.model.name, model: c.model.model, connector: c.model.connector, track: c.track, quick: c.quick,
          score: c.score, macro: c.suites.decisions?.macro_accuracy, rally: c.suites.rally?.rally_rate, arena: c.suites.arena?.points_won,
          p50: c.suites.decisions?.latency_ms?.p50 ?? c.suites.rally?.latency_ms?.p50, label: c.label })));
      }
      if (p.startsWith("/api/results/")) {
        const id = decodeURIComponent(p.slice(13));
        const f = join(RESULTS_DIR, id, "scorecard.json");
        if (!NAME.test(id) || !existsSync(f)) return json(res, { error: "no such result" }, 404);
        return send(res, readFileSync(f), ".json");
      }
      if (p === "/api/leaderboard") return send(res, Buffer.from(renderLeaderboard(readScorecards(RESULTS_DIR))), ".md");
      if (p.startsWith("/api/games")) return await games(req, res, p);
      if (p.startsWith("/api/recordings")) return await recordings(req, res, p);
      if (p.startsWith("/api/store/")) return await store(req, res, p);
      if (p.startsWith("/game/")) return file(res, GAME, p.slice(6));
      if (p.startsWith("/suites/")) return file(res, SUITE_DIR, p.slice(8));
      if (p.startsWith("/results/")) return file(res, RESULTS_DIR, p.slice(9));
      return file(res, WEB, p === "/" ? "index.html" : p.slice(1));
    } catch (e) {
      if (res.headersSent) return res.end();
      return json(res, { error: e.message, detail: e.detail || undefined }, e.status && e.status < 600 ? 502 : e.message === "request too large" ? 413 : 400);
    }
  });

  server.on("upgrade", (req, socket) => {
    if (new URL(req.url, "http://x").pathname !== "/ws") return socket.destroy();
    const refused = guard(req, server.address().port, host);
    if (refused) { socket.end(`HTTP/1.1 ${refused.status} Forbidden\r\nconnection: close\r\n\r\n`); return; }
    const ws = acceptWebSocket(req, socket, {
      onMessage: async (text) => {
        let msg;
        try { msg = JSON.parse(text); } catch { return ws.send(JSON.stringify({ error: "not JSON" })); }
        try {
          ws.send(JSON.stringify({ id: msg.id, ...(await decide(msg)) }));
        } catch (e) {
          ws.send(JSON.stringify({ id: msg.id, error: e.message }));
        }
      },
    });
  });

  await new Promise((ok, no) => { server.once("error", no); server.listen(port, host, ok); });
  console.log(`PongBench app: http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${server.address().port}  (endpoint: ${app.cfg?.name || "none"})`);
  console.log("Close this window or press Ctrl+C to stop.");
  return server;
}

// ------------------------------------------------------------------ helpers
/** Why this request is refused ({status, error}), or null. See the header comment. */
function guard(req, port, bindHost) {
  const extra = (process.env.PONGBENCH_ALLOWED_HOSTS || "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  const allowed = new Set([...LOOPBACK, ...extra, ...(["0.0.0.0", "::"].includes(bindHost) ? [] : [String(bindHost).toLowerCase()])]);
  const ours = (hostname, p) => allowed.has(hostname.toLowerCase()) && Number(p || 80) === port;
  let h;
  try { h = new URL(`http://${req.headers.host || ""}`); } catch { return { status: 403, error: "bad Host header" }; }
  if (!ours(h.hostname, h.port)) return { status: 403, error: `this server answers to 127.0.0.1:${port} and localhost:${port} only` };
  const origin = req.headers.origin;
  if (origin !== undefined) {
    let o = null;
    try { o = new URL(origin); } catch { /* "null" and other opaque origins */ }
    if (!o || o.protocol !== "http:" || !ours(o.hostname, o.port)) return { status: 403, error: "requests from other websites are refused" };
  }
  if (req.headers["sec-fetch-site"] === "cross-site") return { status: 403, error: "requests from other websites are refused" };
  const hasBody = Number(req.headers["content-length"] || 0) > 0 || req.headers["transfer-encoding"] !== undefined;
  if (["POST", "PUT", "DELETE"].includes(req.method) && hasBody && !/^application\/json\b/i.test(req.headers["content-type"] || "")) {
    return { status: 415, error: "send JSON (content-type: application/json)" };
  }
  return null;
}

function clampInt(v, lo, hi, def) { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; }

function json(res, obj, status = 200) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-cache" });
  res.end(JSON.stringify(obj));
}

function send(res, buf, ext) {
  res.writeHead(200, { "content-type": TYPES[ext] || "application/octet-stream", "cache-control": "no-cache" });
  res.end(buf);
}

function file(res, base, rel) {
  const full = normalize(join(base, decodeURIComponent(rel))), root = resolve(base);
  if (!full.startsWith(root + sep) || !existsSync(full) || !statSync(full).isFile()) return json(res, { error: "not found" }, 404);
  return send(res, readFileSync(full), extname(full));
}

function body(req, limit = LIMITS.body) {
  return new Promise((ok, no) => {
    let size = 0;
    const parts = [];
    req.on("data", (c) => { size += c.length; if (size > limit) { no(new Error("request too large")); req.destroy(); } else parts.push(c); });
    req.on("end", () => {
      const text = Buffer.concat(parts).toString("utf8");
      if (!text) return ok({});
      try { ok(JSON.parse(text)); } catch { no(new Error("not JSON")); }
    });
    req.on("error", no);
  });
}

async function games(req, res, p) {
  mkdirSync(GAMES, { recursive: true });
  if (p === "/api/games" && req.method === "GET") {
    const f = join(GAMES, "index.jsonl");
    const rows = existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").filter(Boolean).slice(-60).reverse() : [];
    return json(res, rows.map((r) => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean));
  }
  const id = decodeURIComponent(p.slice("/api/games/".length));
  if (req.method !== "POST" || !NAME.test(id)) return json(res, { error: "bad game id" }, 400);
  const { lines } = await body(req, LIMITS.chunk);
  if (!Array.isArray(lines) || !lines.every((l) => l && typeof l === "object")) return json(res, { error: "lines must be objects" }, 400);
  const f = join(GAMES, `${id}.jsonl`);
  const text = lines.map((l) => `${JSON.stringify(l)}\n`).join("");
  if (existsSync(f) && statSync(f).size + text.length > LIMITS.game) return json(res, { error: "this game's log is full" }, 413);
  appendFileSync(f, text);
  for (const l of lines) if (l.k === "end" && l.index) appendFileSync(join(GAMES, "index.jsonl"), `${JSON.stringify({ id, ...l.index })}\n`);
  return json(res, { written: lines.length });
}

async function recordings(req, res, p) {
  mkdirSync(RECS, { recursive: true });
  if (p === "/api/recordings" && req.method === "GET") {
    const list = readdirSync(RECS).filter((f) => f.endsWith(".json")).map((f) => {
      try {
        const r = JSON.parse(readFileSync(join(RECS, f), "utf8"));
        return { name: f.slice(0, -5), created: r.created, seed: r.seed, seconds: r.seconds, summary: r.summary, settings: r.settings, model_name: r.model_name };
      } catch { return null; }
    }).filter(Boolean).sort((a, b) => String(b.created).localeCompare(String(a.created)));
    return json(res, list);
  }
  if (p === "/api/recordings" && req.method === "POST") {
    const rec = await body(req, LIMITS.recording);
    if (!Array.isArray(rec.snaps)) return json(res, { error: "not a recording" }, 400);
    const tag = String(rec.settings?.prompt || "run").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30) || "run";
    const stamp = String(rec.created || "").replace(/\D/g, "").slice(0, 14) || new Date().toISOString().replace(/\D/g, "").slice(0, 14);
    const name = `${stamp}_${tag}_seed${Math.abs(Math.trunc(Number(rec.seed) || 0))}`;
    const f = resolve(RECS, `${name}.json`);
    if (!NAME.test(name) || !f.startsWith(resolve(RECS) + sep)) return json(res, { error: "bad recording name" }, 400);
    writeFileSync(f, JSON.stringify(rec));
    return json(res, { name });
  }
  const name = decodeURIComponent(p.slice("/api/recordings/".length));
  const f = join(RECS, `${name}.json`);
  if (!NAME.test(name) || !existsSync(f)) return json(res, { error: "no such recording" }, 404);
  return send(res, readFileSync(f), ".json");
}

async function store(req, res, p) {
  mkdirSync(STORE, { recursive: true });
  const [kind, raw] = p.slice("/api/store/".length).split("/");
  if (!["prompts", "setups"].includes(kind)) return json(res, { error: "no such store" }, 404);
  const f = join(STORE, `${kind}.json`);
  const all = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {};
  if (!raw) return json(res, all);
  const name = decodeURIComponent(raw).trim();
  if (!name || name.length > 60 || /[\u0000-\u001f]/.test(name) || RESERVED.has(name)) return json(res, { error: "a name is 1 to 60 printable characters" }, 400);
  if (req.method === "PUT") {
    const entry = await body(req, 16 * 1024);
    if (!entry || typeof entry !== "object") return json(res, { error: "an entry is a JSON object" }, 400);
    if (!(name in all) && Object.keys(all).length >= 200) return json(res, { error: "at most 200 saved entries" }, 400);
    all[name] = entry;
  } else if (req.method === "DELETE") {
    if (!(name in all)) return json(res, { error: "no such entry" }, 404);
    delete all[name];
  } else return json(res, all[name] ?? null);
  writeFileSync(`${f}.tmp`, JSON.stringify(all, null, 1));
  renameSync(`${f}.tmp`, f);
  return json(res, { ok: true });
}
