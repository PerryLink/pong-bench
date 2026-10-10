// Scoring. Every number in a scorecard comes from here, from the per-decision records alone (so a scorecard can be
// recomputed from its decisions file).
import { MOVES } from "../game/prompts.js";

const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
const round = (v, d = 1) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);

export function quantile(values, q) {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

export function latency(records) {
  const ms = records.filter((r) => !r.error).map((r) => r.ms);
  const sv = records.filter((r) => !r.error && Number.isFinite(r.serverMs)).map((r) => r.serverMs);
  return { p50: round(quantile(ms, 0.5)), p95: round(quantile(ms, 0.95)), mean: round(ms.reduce((a, b) => a + b, 0) / (ms.length || 1)),
           server_p50: sv.length ? round(quantile(sv, 0.5)) : null };
}

export function tokens(records) {
  let input = 0, output = 0, seen = false;
  for (const r of records) {
    if (r.usage) { seen = true; input += r.usage.input_tokens || 0; output += r.usage.output_tokens || 0; }
  }
  return seen ? { input, output, per_decision_input: Math.round(input / (records.length || 1)) } : null;
}

/** The decisions suite: accuracy per move (and its macro average), the hard bands, the edges, calibration. */
export function decisionMetrics(items, records) {
  const by = (pred) => {
    let ok = 0, n = 0;
    items.forEach((it, i) => { if (pred(it)) { n += 1; ok += records[i].choice === it.rule ? 1 : 0; } });
    return { right: ok, of: n, accuracy: pct(ok, n) };
  };
  const off = (it) => (it.ds.interceptY === null ? null : Math.abs(it.ds.interceptY - it.ds.paddle.y));
  const perMove = { up: by((it) => it.rule === "up"), down: by((it) => it.rule === "down"), stay: by((it) => it.rule === "stay") };
  const share = (m) => (m.of ? m.right / m.of : 0);                         // from the counts, not the rounded percentages
  const macro = round((100 * (share(perMove.up) + share(perMove.down) + share(perMove.stay))) / 3, 2);
  const confusion = Object.fromEntries(MOVES.map((r) => [r, Object.fromEntries([...MOVES, "error"].map((a) => [a, 0]))]));
  items.forEach((it, i) => { confusion[it.rule][records[i].error ? "error" : records[i].choice] += 1; });

  const graded = records.some((r) => r.probSource && r.probSource !== "one-hot");
  let calibration = null;
  if (graded) {
    let brier = 0, nll = 0, n = 0;
    const bins = Array.from({ length: 10 }, () => ({ conf: 0, ok: 0, n: 0 }));
    items.forEach((it, i) => {
      const r = records[i];
      if (r.error || r.probSource === "one-hot") return;              // calibration only where the model gave probabilities
      const y = MOVES.map((m) => (m === it.rule ? 1 : 0));
      brier += r.probs.reduce((s, p, k) => s + (p - y[k]) ** 2, 0);
      nll += -Math.log(Math.max(1e-6, r.probs[MOVES.indexOf(it.rule)]));
      const conf = Math.max(...r.probs), b = bins[Math.min(9, Math.floor(conf * 10))];
      b.conf += conf; b.ok += r.choice === it.rule ? 1 : 0; b.n += 1;
      n += 1;
    });
    const ece = bins.reduce((s, b) => s + (b.n ? (b.n / n) * Math.abs(b.ok / b.n - b.conf / b.n) : 0), 0);
    calibration = {
      n, brier: round(brier / n, 4), log_loss: round(nll / n, 4), ece: round(ece, 4),
      by_confidence: bins.map((b, k) => ({ from: k / 10, to: (k + 1) / 10, n: b.n, accuracy: pct(b.ok, b.n) })).filter((b) => b.n),
    };
  }
  return {
    macro_accuracy: macro, accuracy: by(() => true).accuracy, per_move: perMove,
    per_kind: { away: by((it) => it.kind === "away"), covered: by((it) => it.kind === "covered") },
    bands: {
      "5-8": by((it) => it.rule !== "stay" && off(it) < 8),
      "8-12": by((it) => it.rule !== "stay" && off(it) >= 8 && off(it) < 12),
      "12+": by((it) => it.rule !== "stay" && off(it) >= 12),
    },
    edges: { top: by((it) => it.rule === "up" && it.ds.interceptY < 10), bottom: by((it) => it.rule === "down" && it.ds.interceptY > 90) },
    confusion, calibration,
    probabilities: graded ? "model" : "one-hot (the endpoint returns no distribution)",
    errors: records.filter((r) => r.error).length, latency_ms: latency(records), tokens: tokens(records),
  };
}

/** The rally suite: returns and misses over lockstep matches; rally rate = returns / (returns + misses). */
export function rallyMetrics(matches) {
  const all = matches.flatMap((m) => m.records);
  const returns = matches.reduce((s, m) => s + m.returns, 0), misses = matches.reduce((s, m) => s + m.misses, 0);
  return {
    rally_rate: pct(returns, returns + misses), returns, misses, decisions: all.length,
    misses_per_100_returns: returns ? round((100 * misses) / returns, 1) : null,
    rule_match: pct(all.filter((r) => r.choice === r.rule).length, all.length),
    longest_rally: Math.max(0, ...matches.map((m) => m.longest)),
    per_seed: matches.map((m) => ({ seed: m.seed, returns: m.returns, misses: m.misses, rally_rate: pct(m.returns, m.returns + m.misses) })),
    errors: all.filter((r) => r.error).length, latency_ms: latency(all), tokens: tokens(all),
  };
}

/** The arena suite (real time, depends on latency): points won against each bot. */
export function arenaMetrics(games) {
  return {
    points_won: pct(games.reduce((s, g) => s + g.score[1], 0), games.reduce((s, g) => s + g.score[0] + g.score[1], 0)),
    games: games.map((g) => ({
      bot: g.bot, score: `${g.score[0]}:${g.score[1]}`, model_won: g.finished ? g.score[1] > g.score[0] : null, finished: g.finished,
      seconds: round(g.seconds, 1), returns: g.returns, misses: g.misses, decisions: g.decisions,
      decisions_per_s: round(g.decisions / Math.max(1e-9, g.activeSeconds), 1), reaction_p50_ms: round(quantile(g.reaction, 0.5)),
      outdated: g.outdated,
    })),
    errors: games.reduce((s, g) => s + g.errors, 0),
  };
}

/** The headline: the mean of decision accuracy (macro) and rally rate, both speed-independent, 0 to 100. */
export function headline(result) {
  const a = result.suites.decisions?.macro_accuracy, b = result.suites.rally?.rally_rate;
  if (a == null || b == null) return null;
  return round((a + b) / 2, 1);
}
