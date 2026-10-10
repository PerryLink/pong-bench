// Recompute the decisions metrics and the score of saved runs from their own records (decisions.jsonl.gz), after a
// change to how metrics are computed. No model is called. Prints what changed.
//   node tools/rescore.mjs [results-dir]
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { expectedMove } from "../src/game/prompts.js";
import { loadDecisions } from "../src/bench/suites.js";
import { decisionMetrics, headline } from "../src/bench/metrics.js";
import { readScorecards, renderScorecard, writeLeaderboard } from "../src/bench/report.js";
import { RESULTS_DIR } from "../src/bench/runner.js";

const dir = process.argv[2] || RESULTS_DIR;
for (const card of readScorecards(dir)) {
  if (!card.suites?.decisions) continue;
  const folder = join(dir, card.id);
  const records = gunzipSync(readFileSync(join(folder, "decisions.jsonl.gz"))).toString("utf8").split("\n").filter(Boolean)
    .map((l) => JSON.parse(l)).filter((r) => r.suite === "decisions");
  const suite = loadDecisions({ quick: card.quick });
  if (suite.sha256 !== card.versions?.decisions?.sha256 && !card.quick) { console.log(`${card.id}: another suite version, skipped`); continue; }
  const tol = card.tolerance ?? suite.tolerance;
  const items = suite.items.map((it) => (tol === suite.tolerance ? it : { ...it, rule: expectedMove(it.ds, tol) }));
  const byId = new Map(records.map((r) => [r.id, r]));
  if (!items.every((it) => byId.has(it.id))) { console.log(`${card.id}: records do not cover the suite, skipped`); continue; }
  const decisions = decisionMetrics(items, items.map((it) => byId.get(it.id)));
  const next = { ...card, suites: { ...card.suites, decisions } };
  next.score = headline(next);
  const was = `${card.suites.decisions.macro_accuracy} / ${card.score}`, now = `${decisions.macro_accuracy} / ${next.score}`;
  writeFileSync(join(folder, "scorecard.json"), `${JSON.stringify(next, null, 1)}\n`);
  writeFileSync(join(folder, "scorecard.md"), renderScorecard(next));
  console.log(`${card.id}: macro / score ${was === now ? `${now} (same)` : `${was} -> ${now}`}`);
}
writeLeaderboard(dir);
