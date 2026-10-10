// Watch: the upstream benchmark. One decision = one tick (engine.js), strictly in sequence, against a wall that never
// misses: the ball moves exactly as fast as the model answers, and every point lost is the model's.
import * as E from "/game/engine.js";
import { MOVES, expectedMove, pickMove } from "/game/prompts.js";

export const WARMUP = 12;                // untimed decisions first: CUDA graphs are captured on a shape's 2nd sighting
export const POINT_PAUSE_MS = 500;       // the court rests after a point (the same for every run)
const GAME_PAUSE_MS = 1000;

export const sleep = (ms, signal) => new Promise((ok, no) => {
  if (signal?.aborted) { no(new DOMException("stopped", "AbortError")); return; }
  const id = setTimeout(ok, ms);
  signal?.addEventListener("abort", () => { clearTimeout(id); no(new DOMException("stopped", "AbortError")); }, { once: true });
});

const tickOf = (t, g, game, move, expect, a, ds, returned = 0) => ({
  t: Math.round(t * 10) / 10, bx: game.ball.x, by: game.ball.y, ly: game.leftY, ry: game.rightY,
  s0: game.score[0], s1: game.score[1], g, m: move, e: expect,
  pu: a ? a.probs[0] : 0, pd: a ? a.probs[1] : 0, ps: a ? a.probs[2] : 0,
  ms: a ? Math.round(a.ms * 100) / 100 : 0, ty: ds ? ds.interceptY : null, r: returned,
  sv: a ? Math.round(a.server * 100) / 100 : 0,
});

/**
 * Play one lane. input() -> {questions, state(ds), tol}: read every decision, so a prompt applied mid-run is used at
 * once. hooks.tick(tick, extra) after every tick; hooks.status(text) while warming up. seconds: Infinity until
 * stopped. Returns the ticks (the timed part) and the wall time.
 */
export async function playLane({ seed, seconds = Infinity, signal, decider, input, hooks, bias = () => 0 }) {
  let warm = E.serve(E.createEngine(seed + 7919));
  for (let i = 0; i < WARMUP; i += 1) {
    const inp = input();
    const a = await decider.ask(inp.state(E.toDecisionState(warm, "right")), inp.questions, signal);
    warm = E.applyTick(warm, pickMove(a.probs, bias()));
    if (warm.status !== "playing") warm = E.serve(warm.status === "over" ? E.createEngine(seed + 7919 + i) : warm);
    hooks.status(`Warming up ${i + 1} / ${WARMUP}`);
  }
  hooks.status("");

  let g = 0, game = E.serve(E.createEngine(seed));
  const t0 = performance.now(), now = () => performance.now() - t0;
  const ticks = [tickOf(0, g, game, -1, -1, null, null)];
  hooks.tick(ticks[0], { t0 });
  while (now() < seconds * 1000) {
    const inp = input();
    const ds = E.toDecisionState(game, "right");
    const expect = MOVES.indexOf(expectedMove(ds, inp.tol));
    const sent = inp.state(ds);
    const raw = await decider.ask(sent, inp.questions, signal);
    const a = { ...raw, choice: pickMove(raw.probs, bias()), raw: raw.choice };   // the move played: the model's, read with the stay handicap
    const before = game;
    game = E.applyTick(game, a.choice);
    const returned = before.ball.vx > 0 && game.ball.vx < 0 ? 1 : 0;      // the model's paddle sent it back
    const tick = tickOf(now(), g, game, MOVES.indexOf(a.choice), expect, a, ds, returned);
    ticks.push(tick);
    hooks.tick(tick, { t0, answer: a, sent, ds });
    if (game.status === "point" || game.status === "over") {
      await sleep(game.status === "over" ? GAME_PAUSE_MS : POINT_PAUSE_MS, signal);
      if (game.status === "over") { g += 1; game = E.createEngine(seed + g); }
      game = E.serve(game);
      const serve = tickOf(now(), g, game, -1, -1, null, null);
      ticks.push(serve);
      hooks.tick(serve, { t0 });
    }
  }
  return { ticks, seconds: now() / 1000 };
}
