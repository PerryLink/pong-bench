// The fixed test material. Everything is generated from seeds with the game's own engine and frozen into suites/*.json
// (with a SHA-256 of the items), so every model in every language answers byte-identical questions.
//
//   decisions-v1   900 decision states: 300 where the rule says up, 300 down, 150 with the ball moving away, 150 with
//                  the paddle already covering it. Drawn from seeded games where the paddle follows the rule only 60%
//                  of the time (so it is often off target), shuffled with a fixed seed. States where the rule points
//                  into a wall the paddle already touches are left out ("stay" is as good there).
//   rally-v1       lockstep matches against the wall on four fixed seeds, 300 decisions each (the upstream mechanic:
//                  one decision moves the ball one step, so the result does not depend on speed)
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as E from "../game/engine.js";
import { MOVES, STAY_TOLERANCE, expectedMove } from "../game/prompts.js";
import { ROOT } from "../config.js";

export const SUITE_DIR = join(ROOT, "suites");
export const DECISIONS_VERSION = "decisions-v1";
export const RALLY = { version: "rally-v1", seeds: [101, 102, 103, 104], decisions: 300 };
export const RALLY_QUICK = { version: "rally-v1-quick", seeds: [101, 102], decisions: 150 };
const COUNTS = { up: 300, down: 300, away: 150, covered: 150 };
const POOL_SEED = 20261010, SHUFFLE_SEED = 99;

const pinned = (ds, rule) => (rule === "up" && ds.paddle.y <= ds.paddle.h / 2 + 0.05)
  || (rule === "down" && ds.paddle.y >= ds.court.h - ds.paddle.h / 2 - 0.05);

export function kindOf(ds, tol = STAY_TOLERANCE) {
  const rule = expectedMove(ds, tol);
  return rule === "stay" ? (ds.interceptY === null ? "away" : "covered") : rule;
}

/** Build decisions-v1 from scratch (deterministic). */
export function buildDecisions() {
  const pool = [];
  let rng = POOL_SEED;
  for (let seed = 1; pool.length < 12000; seed += 1) {
    let g = E.serve(E.createEngine(seed));
    for (let i = 0; i < 300 && g.status !== "over"; i += 1) {
      const ds = E.toDecisionState(g, "right");
      pool.push(ds);
      const r = E.nextRandom(rng); rng = r.state;
      g = E.applyTick(g, r.value < 0.6 ? expectedMove(ds) : MOVES[Math.floor(r.value * 997) % 3]);
      if (g.status === "point") g = E.serve(g);
    }
  }
  let s = SHUFFLE_SEED;
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const r = E.nextRandom(s); s = r.state;
    const j = Math.floor(r.value * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const want = Object.fromEntries(Object.keys(COUNTS).map((k) => [k, []]));
  const seen = new Set();
  for (const ds of pool) {
    const rule = expectedMove(ds);
    if (pinned(ds, rule)) continue;
    const key = JSON.stringify(ds);
    if (seen.has(key)) continue;                                  // no duplicate states
    const k = kindOf(ds);
    if (want[k].length < COUNTS[k]) { want[k].push(ds); seen.add(key); }
    if (Object.keys(COUNTS).every((c) => want[c].length >= COUNTS[c])) break;
  }
  const items = [];
  for (const k of Object.keys(COUNTS)) {
    if (want[k].length < COUNTS[k]) throw new Error(`the pool ran out of "${k}" states`);
    want[k].forEach((ds, i) => items.push({ id: `${k}-${String(i + 1).padStart(3, "0")}`, kind: k, rule: expectedMove(ds), ds }));
  }
  return { version: DECISIONS_VERSION, tolerance: STAY_TOLERANCE, counts: COUNTS, items, sha256: hashItems(items) };
}

export const hashItems = (items) => createHash("sha256").update(JSON.stringify(items)).digest("hex");

/** The frozen suite (verified against its hash); quick = the first third of each kind. */
export function loadDecisions({ quick = false } = {}) {
  const file = join(SUITE_DIR, `${DECISIONS_VERSION}.json`);
  if (!existsSync(file)) throw new Error(`${file} is missing: run \`node bin/pongbench.js suites --build\``);
  const suite = JSON.parse(readFileSync(file, "utf8"));
  if (hashItems(suite.items) !== suite.sha256) throw new Error(`${file} does not match its sha256: it was edited`);
  if (!quick) return suite;
  const keep = Object.fromEntries(Object.entries(suite.counts).map(([k, n]) => [k, Math.ceil(n / 3)]));
  const items = suite.items.filter((it) => Number(it.id.split("-")[1]) <= keep[it.kind]);
  return { ...suite, version: `${suite.version}-quick`, counts: keep, items };
}

/** Write the frozen files (and say whether they changed). */
export function writeSuites() {
  const d = buildDecisions();
  const file = join(SUITE_DIR, `${DECISIONS_VERSION}.json`);
  const before = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).sha256 : null;
  writeFileSync(file, `${JSON.stringify(d)}\n`);
  writeFileSync(join(SUITE_DIR, "rally-v1.json"), `${JSON.stringify({ ...RALLY, quick: RALLY_QUICK, engine: "engine.js (decisio v0.10.0 port)",
    tolerance: STAY_TOLERANCE }, null, 1)}\n`);
  return { items: d.items.length, sha256: d.sha256, changed: before !== null && before !== d.sha256, fresh: before === null };
}
