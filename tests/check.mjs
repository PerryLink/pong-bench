// PongBench's checks: no GPU, no network beyond local mock servers, about ten seconds. `npm test`.
//
//   game      the lockstep engine (the rule never misses), the real-time physics (interceptY = the judged crossing,
//             the paddle moves only on answers, at the set speed), outdated answers dropped
//   suites    the frozen decisions suite matches its hash, rebuilds identically, has the right mix, no pinned states
//   prompts   the standard track is decisio's text word for word; fields; cleanPrompt; pickMove
//   connectors  mock players; systemone (bearer, basic, Workers AI envelope, errors, model field); openai (logprobs
//             with leading spaces, auto fallback to text, json mode, Azure api-key + query, Retry-After); module; config
//             safety (no inline keys, nothing secret in public configs)
//   runner    a quick run end to end, scorecard and leaderboard written, scores as expected
//   server    /api/state, the WebSocket decision channel, /api/check, a Bench run over HTTP with live events
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.PONGBENCH_RESULTS = mkdtempSync(join(tmpdir(), "pongbench-results-"));
process.env.PONGBENCH_DATA = mkdtempSync(join(tmpdir(), "pongbench-data-"));

const E = await import("../src/game/engine.js");
const { createMatch, serve, advance, decisionState, GAME_DEFAULTS } = await import("../src/game/realtime.js");
const P = await import("../src/game/prompts.js");
const { loadDecisions, buildDecisions, hashItems } = await import("../src/bench/suites.js");
const { connect } = await import("../src/connectors/index.js");
const { checkConfig, publicConfig, loadConfig } = await import("../src/config.js");
const { runBench, saveRun, inputFor } = await import("../src/bench/runner.js");
const { playRally } = await import("../src/bench/matches.js");
const { writeLeaderboard } = await import("../src/bench/report.js");
const { probsFromLogprobs } = await import("../src/connectors/openai.js");

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.stack?.split("\n").slice(0, 3).join("\n       ")}`); process.exitCode = 1; }
}
/** A local HTTP server answering with handler(req, body) -> [status, json, headers]. */
async function mockServer(handler) {
  const seen = [];
  const srv = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", async () => {
      const body = raw ? JSON.parse(raw) : null;
      seen.push({ url: req.url, headers: req.headers, body });
      const [status, out, headers = {}] = await handler(req, body, seen.length);
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(out));
    });
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  return { url: `http://127.0.0.1:${srv.address().port}`, seen, close: () => srv.close() };
}

console.log("game");
await t("the rule never misses in lockstep play (1,200 decisions)", async () => {
  const oracle = await connect(checkConfig({ connector: "mock", policy: "oracle" }));
  const input = inputFor("standard");
  for (const seed of [101, 102, 103, 104]) {
    const m = await playRally({ connector: oracle, input, seed, decisions: 300 });
    assert.equal(m.misses, 0);
    assert.ok(m.returns >= 15);
  }
});
await t("interceptY as the model sees it is where the real-time game judges the ball", async () => {
  let worst = 0, n = 0;
  for (const crossingS of [0.6, 1.6, 3]) {
    for (let seed = 1; seed <= 40; seed += 1) {
      let m = serve(createMatch(seed, { ...GAME_DEFAULTS, crossingS, paddleH: 10 }));
      m = advance(m, 0.05, { left: { dir: 0 }, right: { dir: 0 } }, { left: 0, right: 0 });
      const predicted = E.predictIntercept({ ball: m.ball }, "right");
      if (predicted === null) continue;
      const away = predicted < 50 ? 95 : 5;
      for (let i = 0; i < 300 && m.status === "playing"; i += 1) {
        m = advance(m, 1 / 60, { left: { target: 50 }, right: { target: away } }, { left: 400, right: 400 });
        const miss = m.info.find((x) => x.type === "miss-right");
        if (miss) { worst = Math.max(worst, Math.abs(miss.y - predicted)); n += 1; }
      }
    }
  }
  assert.ok(n > 80, `only ${n} crossings`);
  assert.ok(worst < 0.011, `judged ${worst} units away`);
});
await t("the model's paddle moves only on answers, at exactly the set speed, and stops at the wall", async () => {
  let m = serve(createMatch(4, GAME_DEFAULTS));
  const y0 = m.right.y;
  for (let i = 0; i < 300; i += 1) {
    m = advance(m, 1 / 60, { left: { target: E.predictIntercept({ ball: m.ball }, "left") ?? 50 }, right: { dir: 0 } }, { left: 400, right: 110 });
    if (m.status !== "playing") m = serve(m);
    assert.equal(m.right.y, y0);
  }
  m = serve(createMatch(4, GAME_DEFAULTS));
  const before = m.right.y;
  for (let i = 0; i < 5; i += 1) m = advance(m, 0.05, { left: { dir: 0 }, right: { dir: -1 } }, { left: 0, right: 110 });
  assert.ok(Math.abs(before - m.right.y - 27.5) < 1e-6);
  for (let i = 0; i < 20; i += 1) m = advance(m, 0.1, { left: { dir: 0 }, right: { dir: -1 } }, { left: 0, right: 110 });
  assert.equal(m.right.y, m.cfg.paddleH / 2);
});
await t("the real-time state sent matches the game", () => {
  const m = serve(createMatch(11, GAME_DEFAULTS));
  const ds = decisionState(m);
  assert.deepEqual(Object.keys(ds), ["court", "ball", "paddle", "interceptY", "dir"]);
  assert.equal(Math.abs(ds.ball.vx), 19);
  assert.ok(Math.abs(ds.interceptY - E.predictIntercept({ ball: m.ball }, "right")) <= 0.05);
});

console.log("suites");
await t("decisions-v1 matches its hash, rebuilds identically, and has the right mix", () => {
  const s = loadDecisions();
  assert.equal(s.items.length, 900);
  assert.equal(hashItems(s.items), s.sha256);
  assert.equal(buildDecisions().sha256, s.sha256);
  const kinds = Object.fromEntries(["up", "down", "away", "covered"].map((k) => [k, s.items.filter((x) => x.kind === k).length]));
  assert.deepEqual(kinds, { up: 300, down: 300, away: 150, covered: 150 });
  for (const it of s.items) {
    assert.equal(P.expectedMove(it.ds), it.rule);
    if (it.rule === "up") assert.ok(it.ds.paddle.y > it.ds.paddle.h / 2 + 0.05, "a pinned state slipped in");
  }
  assert.equal(new Set(s.items.map((x) => JSON.stringify(x.ds))).size, 900, "duplicate states");
  assert.equal(loadDecisions({ quick: true }).items.length, 300);
});

console.log("prompts");
await t("the standard track is decisio's prompt word for word", () => {
  const q = P.questionOf(P.TRACKS.standard).move;
  assert.ok(q.instructions.startsWith("You control the right paddle in a game of Pong."));
  assert.ok(q.instructions.includes("Treat the paddle as already covering it when paddle.y is within 5 units of interceptY."));
  assert.equal(q.criteria.up, "interceptY is more than 5 units above paddle.y (interceptY < paddle.y - 5). Moving up decreases paddle.y.");
  assert.deepEqual(Object.keys(q.criteria), ["up", "down", "stay"]);
});
await t("track states carry exactly their fields", () => {
  const ds = loadDecisions().items[0].ds;
  assert.deepEqual(Object.keys(P.stateOf(P.TRACKS.standard, ds)), ["court", "ball", "paddle", "interceptY", "dir"]);
  assert.deepEqual(Object.keys(P.stateOf(P.TRACKS.compact, ds)), ["paddle", "interceptY", "dir"]);
  assert.ok(!("interceptY" in P.stateOf(P.TRACKS.reasoning, ds)));
  assert.equal(P.cleanPrompt({ instructions: "x", criteria: { up: "a", down: "b" } }), null);
  assert.equal(P.pickMove([0.37, 0.13, 0.5], 0), "stay");
  assert.equal(P.pickMove([0.37, 0.13, 0.5], 0.2), "up");
});

console.log("connectors");
await t("mock players", async () => {
  const item = loadDecisions().items.find((x) => x.kind === "up");
  const input = inputFor("standard");
  for (const [policy, want] of [["oracle", "up"], ["stay", "stay"], ["down", "down"]]) {
    const c = await connect(checkConfig({ connector: "mock", policy }));
    assert.equal((await c.decide({ state: input.state(item.ds), questions: input.questions })).choice, want);
  }
  const reasoning = inputFor("reasoning");
  const c = await connect(checkConfig({ connector: "mock", policy: "oracle" }));
  assert.equal((await c.decide({ state: reasoning.state(item.ds), questions: reasoning.questions })).choice, "up", "the oracle cannot read the reasoning track");
});
await t("systemone: bearer key, model field, probabilities, usage", async () => {
  process.env.TEST_S1_KEY = "secret-1";
  const srv = await mockServer((req, body) => [200, { model: "m", answers: { move: { type: "choice", choice: "down", probabilities: { up: 0.1, down: 0.7, stay: 0.2 } } },
                                                      usage: { input_tokens: 123, output_tokens: 0 } }]);
  const c = await connect(checkConfig({ connector: "systemone", url: `${srv.url}/v1/systemone`, model: "jev-latest", apiKeyEnv: "TEST_S1_KEY" }));
  const d = await c.decide({ state: { a: 1 }, questions: { move: { type: "choice", instructions: "i", criteria: { up: "u", down: "d", stay: "s" } } } });
  assert.equal(d.choice, "down");
  assert.deepEqual(d.probs.map((p) => Math.round(p * 10) / 10), [0.1, 0.7, 0.2]);
  assert.equal(d.probSource, "model");
  assert.equal(d.usage.input_tokens, 123);
  assert.equal(srv.seen[0].headers.authorization, "Bearer secret-1");
  assert.equal(srv.seen[0].body.model, "jev-latest");
  srv.close();
});
await t("systemone: Databricks basic auth and the Workers AI envelope", async () => {
  process.env.TEST_DB = "dapi-1";
  const srv = await mockServer(() => [200, { result: { answers: { move: { choice: "up", probabilities: { up: 1, down: 0, stay: 0 } } } }, success: true }]);
  const c = await connect(checkConfig({ connector: "systemone", url: `${srv.url}/ai/run/x`, auth: "basic", apiKeyEnv: "TEST_DB" }));
  assert.equal((await c.decide({ state: {}, questions: { move: { criteria: { up: 1, down: 1, stay: 1 } } } })).choice, "up");
  assert.equal(srv.seen[0].headers.authorization, `Basic ${Buffer.from("token:dapi-1").toString("base64")}`);
  srv.close();
});
await t("systemone: 422 fails at once, 429 is retried after Retry-After", async () => {
  const srv = await mockServer((req, body, n) => (n === 1 ? [429, { error: "slow down" }, { "retry-after": "0.05" }]
    : n === 2 ? [200, { answers: { move: { choice: "stay" } } }] : [422, { detail: [{ loc: ["body", "questions"] }] }]));
  const c = await connect(checkConfig({ connector: "systemone", url: srv.url, auth: "none" }));
  const d = await c.decide({ state: {}, questions: { move: {} } });
  assert.equal(d.choice, "stay");
  assert.equal(d.probSource, "one-hot");
  await assert.rejects(c.decide({ state: {}, questions: { move: {} } }), (e) => e.status === 422 && !e.retryable);
  assert.equal(srv.seen.length, 3);
  srv.close();
});
await t("openai: logprobs give probabilities (leading spaces and quotes are skipped)", async () => {
  const lp = probsFromLogprobs([{ token: "\"", top_logprobs: [] }, { token: " up", top_logprobs: [
    { token: " up", logprob: Math.log(0.6) }, { token: "Up", logprob: Math.log(0.1) }, { token: " stay", logprob: Math.log(0.2) },
    { token: " down", logprob: Math.log(0.05) }, { token: "x", logprob: Math.log(0.05) }] }]);
  assert.deepEqual(lp.map((p) => Math.round(p * 100)), [74, 5, 21]);
  const srv = await mockServer((req, body) => [200, { model: "m", usage: { prompt_tokens: 50, completion_tokens: 1 }, choices: [{ message: { content: "up" },
    logprobs: { content: [{ token: "up", logprob: -0.2, top_logprobs: [{ token: "up", logprob: -0.2 }, { token: "stay", logprob: -1.8 }] }] } }] }]);
  const c = await connect(checkConfig({ connector: "openai", baseUrl: `${srv.url}/v1`, model: "m", auth: "none" }));
  const d = await c.decide({ state: { s: 1 }, questions: P.questionOf(P.TRACKS.compact) });
  assert.equal(d.choice, "up");
  assert.equal(d.probSource, "logprobs");
  assert.equal(srv.seen[0].body.logprobs, true);
  assert.equal(srv.seen[0].body.temperature, 0);
  assert.ok(srv.seen[0].body.messages[1].content.includes("Options:\n- up:"));
  assert.equal(d.usage.input_tokens, 50);
  srv.close();
});
await t("openai: a server that rejects logprobs gets text from then on; json mode; Azure api-key and query", async () => {
  const srv = await mockServer((req, body) => (body.logprobs ? [400, { error: { message: "logprobs is not supported for this model" } }]
    : [200, { choices: [{ message: { content: body.response_format ? "{\"move\":\"down\"}" : "I would say: stay." } }] }]));
  process.env.TEST_AZ = "az-key";
  const c = await connect(checkConfig({ connector: "openai", baseUrl: `${srv.url}/openai/deployments/dep`, auth: "api-key", apiKeyEnv: "TEST_AZ",
                                        query: { "api-version": "2024-10-21" } }));
  const d = await c.decide({ state: {}, questions: P.questionOf(P.TRACKS.minimal) });
  assert.equal(d.choice, "stay");
  assert.equal(d.probSource, "one-hot");
  assert.equal(srv.seen.at(-1).headers["api-key"], "az-key");
  assert.ok(srv.seen[0].url.endsWith("/openai/deployments/dep/chat/completions?api-version=2024-10-21"));
  const j = await connect(checkConfig({ connector: "openai", baseUrl: srv.url, model: "m", auth: "none", answer: "json" }));
  assert.equal((await j.decide({ state: {}, questions: P.questionOf(P.TRACKS.minimal) })).choice, "down");
  assert.equal(srv.seen.at(-1).body.response_format.json_schema.schema.properties.move.enum.join(), "up,down,stay");
  srv.close();
});
await t("module connector and config safety", async () => {
  const c = await connect(loadConfig("custom-module"));
  const it = loadDecisions().items.find((x) => x.kind === "down");
  const input = inputFor("standard");
  assert.equal((await c.decide({ state: input.state(it.ds), questions: input.questions })).choice, "down");
  assert.throws(() => checkConfig({ connector: "openai", apiKey: "sk-123" }), /never in the config/);
  process.env.TEST_PUB = "sk-very-secret";
  const pub = publicConfig(checkConfig({ connector: "openai", baseUrl: "x", model: "m", apiKeyEnv: "TEST_PUB", headers: { "x-org": "org-1" } }));
  assert.ok(!JSON.stringify(pub).includes("sk-very-secret") && !JSON.stringify(pub).includes("org-1"));
  assert.equal(pub.key, "found");
});

console.log("runner");
await t("a quick run end to end: scores, scorecard, leaderboard", async () => {
  const cfg = checkConfig({ connector: "mock", policy: "noisy", errorRate: 0.2, seed: 3 }, "noisy.json");
  const out = await runBench({ connector: await connect(cfg), config: cfg, quick: true, concurrency: 4 });
  const r = out.result;
  assert.ok(r.suites.decisions.macro_accuracy > 70 && r.suites.decisions.macro_accuracy < 90);
  assert.ok(r.suites.rally.misses > 0);
  assert.equal(r.score, Math.round(((r.suites.decisions.macro_accuracy + r.suites.rally.rally_rate) / 2) * 10) / 10);
  assert.equal(out.records.length, 600);
  const saved = saveRun(out);
  for (const f of ["scorecard.json", "scorecard.md", "decisions.jsonl.gz"]) assert.ok(existsSync(join(saved.dir, f)));
  assert.ok(readFileSync(join(saved.dir, "scorecard.md"), "utf8").includes("PongBench score"));
  assert.ok(writeLeaderboard(process.env.PONGBENCH_RESULTS).includes("No full runs yet"));     // quick runs stay off it
});

console.log("server");
await t("the app's server: state, WebSocket decisions, check, a Bench run with live events", async () => {
  const { serve: start } = await import("../src/server/server.js");
  const server = await start({ config: "mock-oracle", port: 0, host: "127.0.0.1" });
  const base = `http://127.0.0.1:${server.address().port}`;
  const st = await (await fetch(`${base}/api/state`)).json();
  assert.equal(st.config.id, "mock-oracle");
  const item = loadDecisions().items.find((x) => x.kind === "up"), input = inputFor("standard");
  if (typeof WebSocket === "function") {                   // Node 22+ (browsers always have it)
    const ws = new WebSocket(`${base.replace("http", "ws")}/ws`);
    await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
    const answer = await new Promise((ok) => { ws.onmessage = (e) => ok(JSON.parse(e.data)); ws.send(JSON.stringify({ id: 7, state: input.state(item.ds), questions: input.questions })); });
    assert.equal(answer.id, 7);
    assert.equal(answer.choice, "up");
    ws.close();
  } else console.log("       (no WebSocket client in this Node: the channel is checked over HTTP only)");
  const viaHttp = await (await fetch(`${base}/api/decide`, { method: "POST", body: JSON.stringify({ state: input.state(item.ds), questions: input.questions }) })).json();
  assert.equal(viaHttp.choice, "up");
  const chk = await (await fetch(`${base}/api/check`, { method: "POST", body: "{}" })).json();
  assert.equal(chk.rows.filter((r) => r.right).length, 4);
  const events = [];
  const ctl = new AbortController();
  const sse = fetch(`${base}/api/bench/events`, { signal: ctl.signal }).then(async (r) => {
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value);
      for (const part of buf.split("\n\n").slice(0, -1)) events.push(JSON.parse(part.replace(/^data: /, "")));
      buf = buf.split("\n\n").at(-1);
      if (events.some((e) => e.type === "saved" || e.type === "error")) break;
    }
  }).catch(() => {});
  await new Promise((ok) => setTimeout(ok, 100));
  const go = await (await fetch(`${base}/api/bench/start`, { method: "POST", body: JSON.stringify({ suites: ["decisions"], quick: true }) })).json();
  assert.equal(go.started, true);
  for (let i = 0; i < 100 && !events.some((e) => e.type === "saved" || e.type === "error"); i += 1) await new Promise((ok) => setTimeout(ok, 50));
  ctl.abort();
  await sse;
  const saved = events.find((e) => e.type === "saved");
  assert.ok(saved, `no saved event: ${JSON.stringify(events.filter((e) => e.type !== "progress"))}`);
  assert.ok(events.some((e) => e.type === "progress"));
  const list = await (await fetch(`${base}/api/results`)).json();
  assert.ok(list.some((x) => x.id === saved.id));
  server.close();
});

console.log(process.exitCode ? "\nSOME CHECKS FAILED" : `\nall ${passed} checks passed`);
process.exit(process.exitCode || 0);
