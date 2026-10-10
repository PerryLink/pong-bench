// The benchmark run, shared by the command line (bin/pongbench.js run) and the app's Bench tab (via the server).
//
//   const result = await runBench({ connector, config, suites: ["decisions", "rally"], track: "standard", onEvent })
//
// Events (for progress bars): {type: "plan"}, {type: "progress", suite, done, total, right}, {type: "suite", suite,
// metrics}, {type: "done", result}. Pass an AbortSignal to stop; partial results are not written.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { TRACKS, cleanPrompt, questionOf, stateOf, pickMove, STAY_TOLERANCE } from "../game/prompts.js";
import { loadDecisions, RALLY, RALLY_QUICK } from "./suites.js";
import { playRally, playArena } from "./matches.js";
import { decisionMetrics, rallyMetrics, arenaMetrics, headline } from "./metrics.js";
import { renderScorecard } from "./report.js";
import { publicConfig, ROOT } from "../config.js";

export const SUITES = ["decisions", "rally", "arena"];
export const RESULTS_DIR = process.env.PONGBENCH_RESULTS || join(ROOT, "results");
export const VERSION = "1.0.0";

/** The model input for a track (or a custom prompt object). */
export function inputFor(track = "standard", prompt = null, tol = STAY_TOLERANCE) {
  const p = prompt ? cleanPrompt(prompt) : TRACKS[track];
  if (!p) throw new Error(prompt ? "the custom prompt is incomplete" : `no track "${track}" (${Object.keys(TRACKS).join(", ")})`);
  return { prompt: p, questions: questionOf(p, tol), state: (ds) => stateOf(p, ds, tol), tol };
}

/** Run up to `limit` async jobs at a time over items; results in order. */
async function pool(items, limit, job, signal) {
  const out = new Array(items.length);
  let next = 0;
  async function lane() {
    while (next < items.length) {
      if (signal?.aborted) throw new DOMException("stopped", "AbortError");
      const i = next++;
      out[i] = await job(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
  return out;
}

export async function runBench({ connector, config, suites = ["decisions", "rally"], track = "standard", prompt = null,
                                  tol = STAY_TOLERANCE, stayBias = 0, quick = false, concurrency = 4, arena = {},
                                  label = "", onEvent = () => {}, signal }) {
  const input = inputFor(track, prompt, tol);
  const started = new Date();
  const rally = quick ? RALLY_QUICK : RALLY;
  const decisionsSuite = suites.includes("decisions") ? loadDecisions({ quick }) : null;
  const arenaPlan = { bots: arena.bots || ["medium", "hard"], maxSeconds: arena.maxSeconds ?? 150, game: arena.game || {} };
  const plan = {
    decisions: decisionsSuite ? decisionsSuite.items.length : 0,
    rally: suites.includes("rally") ? rally.seeds.length * rally.decisions : 0,
    arena: suites.includes("arena") ? arenaPlan.bots.length : 0,
  };
  onEvent({ type: "plan", plan, track: input.prompt.name, quick });
  const result = {
    pongbench: VERSION, created: started.toISOString(), label,
    model: { name: config.name, connector: config.connector, model: config.model || "", endpoint: connector.url },
    config: publicConfig(config), track: prompt ? "custom" : track, prompt: input.prompt, tolerance: tol, stay_bias: stayBias,
    quick, concurrency, suites: {}, versions: {},
  };
  const allRecords = [];

  if (decisionsSuite) {
    let done = 0, right = 0;
    const items = decisionsSuite.items;
    const records = await pool(items, concurrency, async (it) => {
      let rec;
      try {
        const d = await connector.decide({ state: input.state(it.ds), questions: input.questions }, { signal });
        const choice = stayBias ? pickMove(d.probs, stayBias) : d.choice;
        rec = { suite: "decisions", id: it.id, kind: it.kind, rule: it.rule, choice, raw: choice !== d.choice ? d.choice : undefined,
                probs: d.probs, probSource: d.probSource, ms: d.ms, serverMs: d.serverMs, usage: d.usage };
      } catch (e) {
        if (e.name === "AbortError") throw e;
        rec = { suite: "decisions", id: it.id, kind: it.kind, rule: it.rule, choice: null, probs: [0, 0, 0], ms: NaN, error: e.message };
      }
      done += 1;
      right += rec.choice === it.rule ? 1 : 0;
      if (done % 10 === 0 || done === items.length) onEvent({ type: "progress", suite: "decisions", done, total: items.length, right });
      return rec;
    }, signal);
    result.suites.decisions = decisionMetrics(items, records);
    result.versions.decisions = { version: decisionsSuite.version, sha256: decisionsSuite.sha256 };
    allRecords.push(...records);
    onEvent({ type: "suite", suite: "decisions", metrics: result.suites.decisions });
    if (records.every((r) => r.error)) throw new Error(`every decision failed: ${records[0].error}`);
  }

  if (plan.rally) {
    let done = 0;
    const matches = await pool(rally.seeds, concurrency, (seed) => playRally({
      connector, input, seed, decisions: rally.decisions, signal, stayBias,
      onDecision: () => { done += 1; if (done % 10 === 0 || done === plan.rally) onEvent({ type: "progress", suite: "rally", done, total: plan.rally }); },
    }), signal);
    result.suites.rally = rallyMetrics(matches);
    result.versions.rally = { version: rally.version, seeds: rally.seeds, decisions: rally.decisions };
    allRecords.push(...matches.flatMap((mm) => mm.records));
    onEvent({ type: "suite", suite: "rally", metrics: result.suites.rally });
  }

  if (plan.arena) {
    const games = [];
    for (const [i, bot] of arenaPlan.bots.entries()) {
      onEvent({ type: "progress", suite: "arena", done: i, total: arenaPlan.bots.length, note: `playing the ${bot} bot` });
      games.push(await playArena({ connector, input, bot, game: arenaPlan.game, maxSeconds: arenaPlan.maxSeconds, seed: 500 + i,
                                   signal, stayBias }));
    }
    result.suites.arena = arenaMetrics(games);
    result.versions.arena = { bots: arenaPlan.bots, maxSeconds: arenaPlan.maxSeconds, game: arenaPlan.game,
                              note: "real time: depends on latency and hardware" };
    allRecords.push(...games.flatMap((g) => g.records));
    onEvent({ type: "progress", suite: "arena", done: arenaPlan.bots.length, total: arenaPlan.bots.length });
    onEvent({ type: "suite", suite: "arena", metrics: result.suites.arena });
  }

  result.score = headline(result);
  result.seconds = Math.round((Date.now() - started.getTime()) / 100) / 10;
  result.calls = { ...connector.stats };
  onEvent({ type: "done", result });
  return { result, records: allRecords };
}

/** Write results/<stamp>_<config>_<track>/: scorecard.json, scorecard.md, decisions.jsonl.gz, config.json. */
export function saveRun({ result, records }, dir = RESULTS_DIR) {
  const stamp = result.created.replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const id = `${stamp}_${result.config.id}_${result.track}${result.quick ? "-quick" : ""}`.replace(/[^A-Za-z0-9_.-]/g, "-");
  const out = join(dir, id);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "scorecard.json"), `${JSON.stringify({ id, ...result }, null, 1)}\n`);
  writeFileSync(join(out, "scorecard.md"), renderScorecard({ id, ...result }));
  writeFileSync(join(out, "decisions.jsonl.gz"), gzipSync(records.map((r) => JSON.stringify(r)).join("\n")));
  return { id, dir: out };
}
