#!/usr/bin/env node
// PongBench command line. Node 18+, no dependencies.
//
//   node bin/pongbench.js check  --config <name>        four decisions: is the endpoint wired up right?
//   node bin/pongbench.js run    --config <name> [...]  the benchmark; writes results/<run>/ and the leaderboard
//   node bin/pongbench.js serve  [--config <name>] [--open]  the app (Play, Bot match, Watch, Bench, Prompt lab, Replays)
//   node bin/pongbench.js configs                       the endpoint configs and whether their keys are found
//   node bin/pongbench.js suites [--build]              verify (or rebuild) the frozen test suites
//   node bin/pongbench.js leaderboard                   rebuild results/LEADERBOARD.md
import { loadEnv, loadConfig, listConfigs, publicConfig } from "../src/config.js";
import { connect } from "../src/connectors/index.js";
import { runBench, saveRun, inputFor, RESULTS_DIR, SUITES } from "../src/bench/runner.js";
import { loadDecisions, writeSuites } from "../src/bench/suites.js";
import { writeLeaderboard } from "../src/bench/report.js";
import { TRACKS } from "../src/game/prompts.js";
import { openBrowser } from "../src/open.js";
import { join } from "node:path";

const HELP = `PongBench: a game benchmark for decision models.

  check  --config <name|path>      four decisions (one of each kind): is the endpoint wired up right?
  run    --config <name|path>      run the benchmark and save a scorecard in results/
         --suites decisions,rally  which suites (decisions, rally, arena; default decisions,rally)
         --track standard          the prompt track (${Object.keys(TRACKS).join(", ")})
         --prompt <file.json>      a custom prompt instead of a track (see docs/PROMPTS.md)
         --quick                   a third of the decisions and two short rallies (a smoke run, not for the leaderboard)
         --concurrency 4           requests in flight (decisions suite; rally seeds run side by side)
         --bots medium,hard        arena opponents (easy, medium, hard, wall); --arena-seconds 150
         --stay-bias 0             take this off the model's p(stay) before picking (custom runs only)
         --label "<text>"          a note stored with the result; --no-save to skip writing results
  serve  [--config <name>] [--port 8800] [--host 127.0.0.1] [--open]   the app, at http://127.0.0.1:8800
                                   (--open: also open it in the default browser)
  configs                          the configs in configs/ and whether their keys are found
  suites [--build]                 verify the frozen suites (or rebuild them)
  leaderboard                      rebuild results/LEADERBOARD.md from every scorecard

Docs: README.md, docs/SPEC.md (the decision contract), docs/BENCHMARK.md (suites and scoring),
docs/CONNECTORS.md (every kind of endpoint), AGENTS.md (setup steps for coding agents).`;

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) { out._.push(a); continue; }
    const [k, inline] = a.slice(2).split("=");
    if (inline !== undefined) out[k] = inline;
    else if (argv[i + 1] && !argv[i + 1].startsWith("--")) out[k] = argv[++i];
    else out[k] = true;
  }
  return out;
}

const tty = process.stderr.isTTY;
function status(text, done = false) {
  if (tty) process.stderr.write(`\r\x1b[2K${text}${done ? "\n" : ""}`);
  else if (done) process.stderr.write(`${text}\n`);
}

async function check(opts) {
  const cfg = loadConfig(need(opts, "config"));
  const pub = publicConfig(cfg);
  console.log(`${cfg.name}: ${cfg.connector} connector, model ${cfg.model || "-"}, key ${pub.key}`);
  const connector = await connect(cfg);
  const input = inputFor(opts.track || "standard");
  const suite = loadDecisions({ quick: true });
  const sample = ["up", "down", "away", "covered"].map((k) => suite.items.find((it) => it.kind === k));
  let ok = 0, fails = 0;
  for (const it of sample) {
    try {
      const d = await connector.decide({ state: input.state(it.ds), questions: input.questions });
      const right = d.choice === it.rule;
      ok += right ? 1 : 0;
      console.log(`  ${it.kind.padEnd(8)} rule ${it.rule.padEnd(5)} answer ${d.choice.padEnd(5)} ${right ? "right" : "wrong"}  ` +
                  `${d.ms.toFixed(0)} ms  p=[${d.probs.map((p) => p.toFixed(2)).join(", ")}] (${d.probSource})`);
    } catch (e) {
      fails += 1;
      console.log(`  ${it.kind.padEnd(8)} ERROR ${e.message}${e.detail ? `\n           ${e.detail.slice(0, 200)}` : ""}`);
    }
  }
  console.log(fails ? `\nThe endpoint failed ${fails} of 4 requests: fix the config (docs/CONNECTORS.md) before a run.`
                    : `\nThe endpoint works: ${ok} of 4 right. Next: node bin/pongbench.js run --config ${cfg.id}`);
  process.exitCode = fails ? 1 : 0;
}

async function run(opts) {
  const cfg = loadConfig(need(opts, "config"));
  const suites = String(opts.suites || "decisions,rally").split(",").map((s) => s.trim()).filter(Boolean);
  const bad = suites.filter((s) => !SUITES.includes(s));
  if (bad.length) throw new Error(`unknown suite ${bad.join(", ")} (${SUITES.join(", ")})`);
  let prompt = null;
  if (opts.prompt) {
    const { readFileSync } = await import("node:fs");
    prompt = JSON.parse(readFileSync(opts.prompt, "utf8"));
  }
  const connector = await connect(cfg);
  const ctl = new AbortController();
  process.on("SIGINT", () => { status("stopping...", true); ctl.abort(); });
  const t0 = Date.now();
  const { result, records } = await runBench({
    connector, config: cfg, suites, track: opts.track || "standard", prompt, quick: !!opts.quick,
    concurrency: Number(opts.concurrency ?? cfg.concurrency ?? 4), stayBias: Number(opts["stay-bias"] || 0),
    tol: Number(opts.tol || 5), label: typeof opts.label === "string" ? opts.label : "",
    arena: { bots: opts.bots ? String(opts.bots).split(",") : undefined, maxSeconds: Number(opts["arena-seconds"] || 150) },
    signal: ctl.signal,
    onEvent: (e) => {
      const s = `${((Date.now() - t0) / 1000).toFixed(0)} s`;
      if (e.type === "plan") status(`${cfg.name}, track ${e.track}${e.quick ? " (quick)" : ""}: ${Object.entries(e.plan).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(", ")}`, true);
      if (e.type === "progress") status(`  ${e.suite} ${e.done} / ${e.total}${e.right !== undefined ? `  (${((100 * e.right) / e.done).toFixed(1)}% right so far)` : ""}${e.note ? `  ${e.note}` : ""}  ${s}`);
      if (e.type === "suite") {
        const m = e.metrics;
        const line = e.suite === "decisions" ? `macro accuracy ${m.macro_accuracy}% (up ${m.per_move.up.accuracy}%, down ${m.per_move.down.accuracy}%, stay ${m.per_move.stay.accuracy}%), p50 ${m.latency_ms.p50} ms`
          : e.suite === "rally" ? `rally rate ${m.rally_rate}% (${m.returns} returns, ${m.misses} misses)` : `points won ${m.points_won}%`;
        status(`  ${e.suite}: ${line}`, true);
      }
    },
  });
  console.log(`\nPongBench score: ${result.score ?? "-"}  (${result.calls.calls} calls, ${result.calls.errors} errors, ${result.seconds} s)`);
  if (opts["no-save"]) return;
  const saved = saveRun({ result, records });
  writeLeaderboard(RESULTS_DIR);
  console.log(`Saved ${join(saved.dir, "scorecard.md")} (and the leaderboard: ${join("results", "LEADERBOARD.md")})`);
}

function need(opts, k) {
  if (!opts[k] || opts[k] === true) throw new Error(`--${k} is required (try: node bin/pongbench.js configs)`);
  return opts[k];
}

async function main() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 18 || (major === 18 && minor < 17)) {
    console.error(`PongBench needs Node.js 18.17 or newer (this is ${process.version}): https://nodejs.org`);
    process.exit(1);
  }
  loadEnv();
  const opts = args(process.argv.slice(2));
  const cmd = opts._[0];
  if (cmd === "check") return check(opts);
  if (cmd === "run") return run(opts);
  if (cmd === "serve") {
    const host = opts.host || "127.0.0.1";
    const server = await (await import("../src/server/server.js")).serve({ config: opts.config, port: Number(opts.port || 8800), host });
    if (opts.open) openBrowser(`http://${["0.0.0.0", "::"].includes(host) ? "127.0.0.1" : host}:${server.address().port}/`);
    return server;
  }
  if (cmd === "configs") {
    for (const c of listConfigs()) console.log(`  ${c.id.padEnd(22)} ${c.error ? `ERROR ${c.error}` : `${c.connector.padEnd(10)} ${String(c.model || c.policy || "").padEnd(28)} key ${c.key}`}`);
    return;
  }
  if (cmd === "suites") {
    if (opts.build) { const r = writeSuites(); console.log(`decisions-v1: ${r.items} states, sha256 ${r.sha256}${r.changed ? " (CHANGED: results made before are not comparable)" : r.fresh ? " (new)" : " (unchanged)"}`); }
    const s = loadDecisions();
    console.log(`${s.version}: ${s.items.length} states, ${JSON.stringify(s.counts)}, sha256 ${s.sha256.slice(0, 16)}... verified`);
    return;
  }
  if (cmd === "leaderboard") { console.log(writeLeaderboard(RESULTS_DIR)); return; }
  console.log(HELP);
}

main().catch((e) => { status("", false); console.error(`\nerror: ${e.message}`); process.exitCode = 1; });
