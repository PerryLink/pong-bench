// Remove the timing from saved runs (latency, decisions per second, run time, per-decision ms), for results measured
// on hardware you would rather not report on. Scores are unchanged: they never depend on speed.
//   node tools/strip-timing.mjs <run-id> [<run-id> ...] [--label "<text>"] [--note "<text>"]
// --label replaces the run's label; --note replaces the config's note (both are shown with the result).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { renderScorecard, stripRecordTiming, stripTiming, writeLeaderboard } from "../src/bench/report.js";
import { RESULTS_DIR } from "../src/bench/runner.js";

const argv = process.argv.slice(2);
const flag = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv.splice(i, 2)[1] : undefined; };
const label = flag("label"), note = flag("note");
if (!argv.length) { console.error("usage: node tools/strip-timing.mjs <run-id> [...] [--label text] [--note text]"); process.exit(2); }

for (const id of argv) {
  const dir = join(RESULTS_DIR, id);
  if (!/^[A-Za-z0-9_.-]+$/.test(id) || !existsSync(join(dir, "scorecard.json"))) { console.error(`${id}: no such run`); process.exitCode = 1; continue; }
  let card = stripTiming(JSON.parse(readFileSync(join(dir, "scorecard.json"), "utf8")));
  if (label !== undefined) card = { ...card, label };
  if (note !== undefined) card = { ...card, config: { ...card.config, note } };
  const gz = join(dir, "decisions.jsonl.gz");
  if (existsSync(gz)) {
    const lines = gunzipSync(readFileSync(gz)).toString("utf8").split("\n").filter(Boolean);
    writeFileSync(gz, gzipSync(lines.map((l) => JSON.stringify(stripRecordTiming(JSON.parse(l)))).join("\n")));
  }
  writeFileSync(join(dir, "scorecard.json"), `${JSON.stringify(card, null, 1)}\n`);
  writeFileSync(join(dir, "scorecard.md"), renderScorecard(card));
  console.log(`${id}: timing removed (score ${card.score})`);
}
writeLeaderboard(RESULTS_DIR);
