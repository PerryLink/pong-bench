// Human-readable output: one scorecard per run, and the leaderboard over every scorecard in results/.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const v = (x, unit = "") => (x === null || x === undefined ? "-" : `${x}${unit}`);
const row = (cells) => `| ${cells.join(" | ")} |`;

export function renderScorecard(r) {
  const d = r.suites.decisions, ra = r.suites.rally, ar = r.suites.arena;
  const lines = [
    `# PongBench scorecard: ${r.model.name}`, "",
    `- Model: \`${r.model.model || "-"}\` via the ${r.model.connector} connector (${r.model.endpoint})`,
    `- Track: ${r.track} (${r.prompt.name})${r.quick ? ", quick run" : ""}; tolerance ${r.tolerance}; stay handicap ${r.stay_bias || "off"}`,
    `- Run: ${r.created}, ${r.seconds} s, ${r.calls?.calls ?? "?"} calls, ${r.calls?.errors ?? 0} errors; PongBench ${r.pongbench}`, "",
    `## PongBench score: ${v(r.score)}`, "",
    "The mean of decision accuracy (macro over up, down and stay) and rally rate. Both are independent of speed.", "",
  ];
  if (d) {
    lines.push("## Decisions", "", row(["", "right", "accuracy"]), row(["---", "---", "---"]),
      ...["up", "down", "stay"].map((m) => row([m, `${d.per_move[m].right} / ${d.per_move[m].of}`, v(d.per_move[m].accuracy, "%")])),
      row(["**macro**", "", `**${v(d.macro_accuracy, "%")}**`]), "",
      "Where it matters:", "", row(["slice", "right", "accuracy"]), row(["---", "---", "---"]),
      ...Object.entries(d.bands).map(([k, b]) => row([`move needed, ball arrives ${k} units off centre`, `${b.right} / ${b.of}`, v(b.accuracy, "%")])),
      row(["up toward the top edge (interceptY < 10)", `${d.edges.top.right} / ${d.edges.top.of}`, v(d.edges.top.accuracy, "%")]),
      row(["down toward the bottom edge (interceptY > 90)", `${d.edges.bottom.right} / ${d.edges.bottom.of}`, v(d.edges.bottom.accuracy, "%")]),
      row(["ball moving away", `${d.per_kind.away.right} / ${d.per_kind.away.of}`, v(d.per_kind.away.accuracy, "%")]),
      row(["paddle already covers it", `${d.per_kind.covered.right} / ${d.per_kind.covered.of}`, v(d.per_kind.covered.accuracy, "%")]), "",
      "Confusion (rows: the rule; columns: the answer):", "", row(["", "up", "down", "stay", "error"]), row(["---", "---", "---", "---", "---"]),
      ...["up", "down", "stay"].map((m) => row([m, ...["up", "down", "stay", "error"].map((a) => d.confusion[m][a])])), "");
    lines.push(d.calibration
      ? `Calibration (the model's own probabilities): Brier ${d.calibration.brier}, log loss ${d.calibration.log_loss}, ECE ${d.calibration.ece}.`
      : "Calibration: not measured (the endpoint returns one answer, no probabilities).", "",
      `Latency: p50 ${v(d.latency_ms.p50, " ms")}, p95 ${v(d.latency_ms.p95, " ms")}${d.tokens ? `; ${d.tokens.per_decision_input} input tokens per decision` : ""}; ${d.errors} errors.`, "");
  }
  if (ra) {
    lines.push("## Rally (lockstep against the wall)", "",
      `Rally rate **${v(ra.rally_rate, "%")}**: ${ra.returns} returns, ${ra.misses} misses over ${ra.decisions} decisions ` +
      `(${v(ra.misses_per_100_returns)} misses per 100 returns, longest rally ${ra.longest_rally}); the answers matched the rule ${v(ra.rule_match, "%")} of the time.`, "",
      row(["seed", "returns", "misses", "rally rate"]), row(["---", "---", "---", "---"]),
      ...ra.per_seed.map((s) => row([s.seed, s.returns, s.misses, v(s.rally_rate, "%")])), "");
  }
  if (ar) {
    lines.push("## Arena (real time against bots; depends on latency and hardware)", "",
      `Points won: **${v(ar.points_won, "%")}**`, "", row(["bot", "score (bot:model)", "finished", "decisions/s", "reaction p50", "returns", "misses"]),
      row(["---", "---", "---", "---", "---", "---", "---"]),
      ...ar.games.map((g) => row([g.bot, g.score, g.finished ? "yes" : `no (${g.seconds} s cap)`, v(g.decisions_per_s), v(g.reaction_p50_ms, " ms"), g.returns, g.misses])), "");
  }
  lines.push("## Reproduce", "", "```bash",
    `node bin/pongbench.js run --config ${r.config.id} --track ${r.track}${r.quick ? " --quick" : ""}${r.suites.arena ? " --suites decisions,rally,arena" : ""}`,
    "```", "", `Suites: ${Object.entries(r.versions).map(([k, x]) => `${k} ${x.version || ""}`).join(", ")}.`, "");
  return lines.join("\n");
}

/** Every scorecard in results/, best first. */
export function readScorecards(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory())
    .map((e) => join(dir, e.name, "scorecard.json")).filter(existsSync)
    .map((f) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; } }).filter(Boolean);
}

export function renderLeaderboard(cards) {
  const best = new Map();                                       // the best full (not quick) run per model and track
  for (const c of cards) {
    if (c.quick || c.score == null) continue;
    const k = `${c.model.name}|${c.track}`;
    if (!best.has(k) || best.get(k).score < c.score) best.set(k, c);
  }
  const list = [...best.values()].sort((a, b) => b.score - a.score);
  const lines = ["# PongBench leaderboard", "",
    "Full runs only, the best per model and track. Score = mean of decision accuracy (macro) and rally rate; both are speed-independent.",
    "Latency depends on the machine and network it was measured on.", "",
    row(["#", "model", "track", "score", "decisions (macro)", "up", "down", "stay", "rally rate", "misses / 100 returns", "probabilities", "p50 latency", "run"]),
    row(Array(13).fill("---"))];
  list.forEach((c, i) => {
    const d = c.suites.decisions, r = c.suites.rally;
    lines.push(row([i + 1, c.model.name, c.track, `**${c.score}**`, v(d?.macro_accuracy, "%"), v(d?.per_move.up.accuracy, "%"),
      v(d?.per_move.down.accuracy, "%"), v(d?.per_move.stay.accuracy, "%"), v(r?.rally_rate, "%"), v(r?.misses_per_100_returns),
      d?.calibration ? "model" : "one-hot", v(d?.latency_ms.p50, " ms"), `[${c.id}](${c.id}/scorecard.md)`]));
  });
  if (!list.length) lines.push("", "No full runs yet.");
  return `${lines.join("\n")}\n`;
}

export function writeLeaderboard(dir) {
  const md = renderLeaderboard(readScorecards(dir));
  writeFileSync(join(dir, "LEADERBOARD.md"), md);
  return md;
}
