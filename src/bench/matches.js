// The two ways the benchmark plays real games.
//
// Rally (lockstep, the upstream mechanic): one decision moves the ball one step, against a wall that never misses.
// Time plays no part, so a model that answers in 2 s and one that answers in 2 ms get the same game for the same
// answers. Every point lost is the model's.
//
// Arena (real time): the ball runs on a clock and a bot plays the other side; the model steers with its latest
// answer, so its latency is its reaction time. Physics is advanced to the moment each state is sent and each answer
// lands; an answer about a rally that has ended is dropped.
import * as E from "../game/engine.js";
import { createMatch, serve, advance, decisionState, botControl, BOT_LEVELS, GAME_DEFAULTS } from "../game/realtime.js";
import { expectedMove, pickMove } from "../game/prompts.js";

const MIN_GAP_MS = 8;
const sleep = (ms, signal) => new Promise((ok, no) => {
  if (signal?.aborted) return no(new DOMException("stopped", "AbortError"));
  const id = setTimeout(ok, ms);
  signal?.addEventListener("abort", () => { clearTimeout(id); no(new DOMException("stopped", "AbortError")); }, { once: true });
});

/** Ask once; an error plays "stay" and is recorded (the match goes on). */
async function ask(connector, input, ds, { signal, stayBias }) {
  const sent = input.state(ds);
  try {
    const d = await connector.decide({ state: sent, questions: input.questions }, { signal });
    return { ...d, raw: d.choice, choice: stayBias ? pickMove(d.probs, stayBias) : d.choice };
  } catch (e) {
    if (e.name === "AbortError") throw e;
    return { choice: "stay", probs: [0, 0, 1], probSource: "error", ms: NaN, error: e.message };
  }
}

const short = (ds) => ({ bx: ds.ball.x, by: ds.ball.y, vx: ds.ball.vx, vy: ds.ball.vy, py: ds.paddle.y, ph: ds.paddle.h, iy: ds.interceptY, dir: ds.dir });

/** One lockstep match: `decisions` answers from a fixed seed (new games start as needed). */
export async function playRally({ connector, input, seed, decisions, signal, stayBias = 0, onDecision }) {
  let game = E.serve(E.createEngine(seed)), g = 0, rally = 0, longest = 0, returns = 0, misses = 0;
  const records = [];
  for (let i = 0; i < decisions; i += 1) {
    const ds = E.toDecisionState(game, "right");
    const rule = expectedMove(ds, input.tol);
    const d = await ask(connector, input, ds, { signal, stayBias });
    const before = game;
    game = E.applyTick(game, d.choice);
    const returned = before.ball.vx > 0 && game.ball.vx < 0;
    const missed = game.score[0] > before.score[0];
    if (returned) { returns += 1; rally += 1; longest = Math.max(longest, rally); }
    if (missed) { misses += 1; rally = 0; }
    const rec = { suite: "rally", seed, i, game: g, ds: short(ds), rule, choice: d.choice, raw: d.raw !== d.choice ? d.raw : undefined,
                  probs: d.probs, probSource: d.probSource, ms: d.ms, serverMs: d.serverMs, usage: d.usage, error: d.error,
                  returned: returned || undefined, missed: missed || undefined };
    records.push(rec);
    onDecision?.(rec);
    if (game.status === "over") { g += 1; game = E.serve(E.createEngine(seed * 1000 + g)); }
    else if (game.status === "point") game = E.serve(game);
  }
  return { seed, records, returns, misses, longest, games: g + 1 };
}

/** One real-time game against a bot: first to pointsToWin, or maxSeconds. */
export async function playArena({ connector, input, bot = "medium", game = {}, maxSeconds = 150, seed = 7, signal, stayBias = 0,
                                  onDecision, onEvent }) {
  const cfg = { ...GAME_DEFAULTS, ...game };
  const level = BOT_LEVELS[bot] || BOT_LEVELS.medium;
  let m = serve(createMatch(seed, cfg));
  let last = performance.now(), dir = 0, epoch = 0, botErr = 0, rngBot = seed | 0, serveAt = 0;
  const seen = [{ t: last, m }];
  const start = last;
  const out = { bot, score: [0, 0], returns: 0, misses: 0, decisions: 0, errors: 0, outdated: 0, reaction: [], activeSeconds: 0,
                finished: false, seconds: 0, records: [] };
  const randBot = () => { const r = E.nextRandom(rngBot); rngBot = r.state; return (r.value * 2 - 1) * level.err; };
  botErr = randBot();

  function step(now = performance.now()) {
    const dt = (now - last) / 1000;
    if (dt <= 0) return;
    last = now;
    if (m.status !== "playing") {
      if (m.status === "point" && now >= serveAt) { m = serve(m); epoch += 1; dir = 0; }
      return;
    }
    seen.push({ t: now, m });
    while (seen.length > 2 && seen[1].t <= now - level.lagS * 1000) seen.shift();
    m = advance(m, dt, { left: botControl(m, seen[0].m, botErr), right: { dir } },
                { left: cfg.paddleSpeed * level.speed, right: cfg.paddleSpeed });
    out.activeSeconds += dt;
    for (const ev of m.events) {
      if (ev === "hit-right") out.returns += 1;
      if (ev.startsWith("hit")) botErr = randBot();
      if (ev === "miss-right") out.misses += 1;
      if (ev.startsWith("miss")) {
        epoch += 1; dir = 0; serveAt = now + 900;
        onEvent?.({ type: "point", score: m.score });
      }
    }
  }

  const timer = setInterval(() => step(), 4);
  try {
    while (!signal?.aborted && m.status !== "over" && performance.now() - start < maxSeconds * 1000) {
      step();
      if (m.status !== "playing") { await sleep(5, signal); continue; }
      const ds = decisionState(m), myEpoch = epoch, sentAt = performance.now();
      const d = await ask(connector, input, ds, { signal, stayBias });
      const spent = performance.now() - sentAt;
      if (spent < MIN_GAP_MS) await sleep(MIN_GAP_MS - spent, signal);   // at most 125 decisions/s, as in the app
      step();
      out.decisions += 1;
      if (d.error) out.errors += 1;
      if (myEpoch !== epoch) { out.outdated += 1; continue; }
      dir = d.choice === "up" ? -1 : d.choice === "down" ? 1 : 0;
      out.reaction.push(performance.now() - sentAt);
      const rec = { suite: "arena", bot, t: Math.round(performance.now() - start), ds: short(ds), rule: expectedMove(ds, input.tol),
                    choice: d.choice, probs: d.probs, probSource: d.probSource, ms: d.ms, serverMs: d.serverMs, usage: d.usage, error: d.error };
      out.records.push(rec);
      onDecision?.(rec);
    }
  } finally {
    clearInterval(timer);
  }
  out.score = m.score;
  out.finished = m.status === "over";
  out.seconds = (performance.now() - start) / 1000;
  return out;
}
