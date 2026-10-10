// Rebuild the reference results table from results/*/scorecard.json and write it between
// <!-- results:start --> and <!-- results:end --> in README.md and docs/BENCHMARK.md.
//   node tools/results-table.mjs
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readScorecards } from "../src/bench/report.js";
import { ROOT } from "../src/config.js";

const cards = readScorecards(join(ROOT, "results"));
const best = new Map();
for (const c of cards) {
  if (c.score == null) continue;
  const k = `${c.model.name}|${c.track}|${c.quick ? "q" : "f"}`;
  if (!best.has(k) || best.get(k).created < c.created) best.set(k, c);
}
const isModel = (c) => !["mock", "module"].includes(c.config?.connector);
const byScore = (a, b) => b.score - a.score;
const all = [...best.values()];
const full = all.filter((c) => isModel(c) && !c.quick).sort(byScore);
const quick = all.filter((c) => isModel(c) && c.quick).sort(byScore);
const baselines = all.filter((c) => c.config?.connector === "mock" && !c.quick).sort(byScore);
const pct = (v) => (v == null ? "–" : `${v}%`);
const row = (c) => {
  const d = c.suites.decisions, r = c.suites.rally;
  const name = isModel(c) ? c.model.name : `*${c.model.name}*`;
  return `| ${name} | ${c.track}${c.quick ? " (quick)" : ""} | **${c.score}** | ${pct(d?.macro_accuracy)} | ${pct(d?.per_move.up.accuracy)} | ${pct(d?.per_move.down.accuracy)} | ${pct(d?.per_move.stay.accuracy)} | ${pct(r?.rally_rate)} | ${r ? r.misses : "–"} | ${d?.calibration ? "yes" : "one-hot"} | ${isModel(c) && d?.latency_ms?.p50 != null ? `${d.latency_ms.p50} ms` : "–"} |`;
};
const table = [
  "| Model | Track | Score | Decisions (macro) | up | down | stay | Rally rate | Misses | Probabilities | p50 latency |",
  "|---|---|---|---|---|---|---|---|---|---|---|",
  ...full.map(row),
  ...quick.map(row),
  ...baselines.map(row),
].join("\n");
const block = `<!-- results:start -->\n${table}\n<!-- results:end -->`;
for (const f of ["README.md", "docs/BENCHMARK.md"]) {
  const p = join(ROOT, f);
  if (!existsSync(p)) { console.log(`${f}: missing, skipped`); continue; }
  const s = readFileSync(p, "utf8");
  if (!s.includes("<!-- results:start -->")) { console.log(`${f}: no markers, skipped`); continue; }
  writeFileSync(p, s.replace(/<!-- results:start -->[\s\S]*?<!-- results:end -->/, block));
  console.log(`${f}: ${full.length} full runs, ${quick.length} quick, ${baselines.length} baselines`);
}
