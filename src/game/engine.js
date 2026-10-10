// Pong lanes: the game engine, ported line for line from decisio v0.10.0 examples/demos/pong/lib/game/engine.ts
// (itself a modified copy of jev-pong by Ably Labs, Apache-2.0; see ATTRIBUTION.md). Changed from upstream: plain
// JavaScript instead of TypeScript; nothing else. Pure functions: the same seed and moves give the same game.
//
// The mechanic: one model decision = one tick = the ball advances exactly SEGMENT_X along x (eight per crossing),
// the model's paddle moves at most MODEL_PADDLE_STEP. A slow model is a slow ball. The left paddle is a scripted
// wall that provably never misses, so every point conceded is the model's.

export const COURT_W = 160;
export const COURT_H = 100;
export const PADDLE_H = 20;
export const BALL_R = 1.5;
export const PADDLE_INSET = 4;
export const LEFT_PLANE = PADDLE_INSET;
export const RIGHT_PLANE = COURT_W - PADDLE_INSET;
export const CROSSING_X = RIGHT_PLANE - LEFT_PLANE;
export const SEGMENTS_PER_CROSSING = 8;
export const SEGMENT_X = CROSSING_X / SEGMENTS_PER_CROSSING;
export const MODEL_PADDLE_STEP = 12;
export const POINTS_TO_WIN = 5;

export const CENTRE_X = COURT_W / 2;
export const CENTRE_Y = COURT_H / 2;
export const PADDLE_MIN_Y = PADDLE_H / 2;
export const PADDLE_MAX_Y = COURT_H - PADDLE_H / 2;
const BALL_MIN_Y = BALL_R;
const BALL_MAX_Y = COURT_H - BALL_R;
const MAX_ANGLE_DEG = 35;
const MAX_VY = SEGMENT_X * Math.tan((MAX_ANGLE_DEG * Math.PI) / 180);
export const PADDLE_REACH = PADDLE_H / 2 + BALL_R;
const WALL_STEP = 2 * MODEL_PADDLE_STEP;
const EPS = 1e-9;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function r1(n) {
  const v = Math.round(n * 10) / 10;
  return v === 0 ? 0 : v;
}

/** mulberry32: the drawn value and the next cursor (kept in the state, not a closure). */
export function nextRandom(state) {
  const a = (state + 0x6d2b79f5) | 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, state: a };
}

function fold(y, lo, hi) {
  const span = hi - lo;
  if (span <= 0) return { y: lo, flipped: false };
  const period = 2 * span;
  let m = (y - lo) % period;
  if (m < 0) m += period;
  if (m <= span) return { y: lo + m, flipped: false };
  return { y: lo + (period - m), flipped: true };
}

export function createEngine(seed, serveDir = 1) {
  return {
    seed, rng: seed | 0, tick: 0,
    ball: { x: CENTRE_X, y: CENTRE_Y, vx: 0, vy: 0 },
    leftY: CENTRE_Y, rightY: CENTRE_Y, score: [0, 0], status: "idle", serveDir,
  };
}

export function serve(state) {
  if (state.status === "over") return state;
  const { value, state: rng } = nextRandom(state.rng);
  const angle = (value * 2 - 1) * ((MAX_ANGLE_DEG * Math.PI) / 180);
  return {
    ...state, rng,
    ball: { x: CENTRE_X, y: CENTRE_Y, vx: state.serveDir * SEGMENT_X, vy: SEGMENT_X * Math.tan(angle) },
    leftY: CENTRE_Y, rightY: CENTRE_Y, status: "playing",
  };
}

export function predictIntercept(state, side) {
  const { x, y, vx, vy } = state.ball;
  if (!Number.isFinite(vx) || vx === 0) return null;
  const toward = side === "right" ? vx > 0 : vx < 0;
  if (!toward) return null;
  const plane = side === "right" ? RIGHT_PLANE : LEFT_PLANE;
  const t = (plane - x) / vx;
  if (t < 0) return null;
  return fold(y + vy * t, BALL_MIN_Y, BALL_MAX_Y).y;
}

/** Exactly what a model sees: numbers only, 1 decimal, about 125 bytes of JSON. */
export function toDecisionState(state, side) {
  const intercept = predictIntercept(state, side);
  const toward = side === "right" ? state.ball.vx > 0 : state.ball.vx < 0;
  return {
    court: { w: COURT_W, h: COURT_H },
    ball: { x: r1(state.ball.x), y: r1(state.ball.y), vx: r1(state.ball.vx), vy: r1(state.ball.vy) },
    paddle: { y: r1(side === "right" ? state.rightY : state.leftY), h: PADDLE_H },
    interceptY: intercept === null ? null : r1(intercept),
    dir: toward ? "toward" : "away",
  };
}

const moveDelta = (move, step) => (move === "up" ? -step : move === "down" ? step : 0);

function autoLeftY(s) {
  const target = predictIntercept(s, "left");
  const goal = clamp(target === null ? CENTRE_Y : target, PADDLE_MIN_Y, PADDLE_MAX_Y);
  const step = target === null ? MODEL_PADDLE_STEP : WALL_STEP;
  const d = clamp(goal - s.leftY, -step, step);
  return clamp(s.leftY + d, PADDLE_MIN_Y, PADDLE_MAX_Y);
}

function advanceSegment(s) {
  let { x, y, vx, vy } = s.ball;
  let remaining = SEGMENT_X;
  let [leftScore, rightScore] = s.score;
  let serveDir = s.serveDir;
  let conceded = false;
  for (let guard = 0; remaining > EPS && guard < 64; guard += 1) {
    const dir = vx > 0 ? 1 : -1;
    const plane = dir > 0 ? RIGHT_PLANE : LEFT_PLANE;
    const distToPlane = Math.max(0, (plane - x) * dir);
    const crosses = distToPlane <= remaining + EPS;
    const step = Math.min(distToPlane, remaining);
    const folded = fold(y + vy * (step / Math.abs(vx)), BALL_MIN_Y, BALL_MAX_Y);
    y = folded.y;
    if (folded.flipped) vy = -vy;
    x = crosses ? plane : x + dir * step;
    remaining -= step;
    if (!crosses) break;
    const paddleY = dir > 0 ? s.rightY : s.leftY;
    if (Math.abs(y - paddleY) <= PADDLE_REACH + EPS) {
      const offset = clamp((y - paddleY) / (PADDLE_H / 2), -1, 1);
      vx = -dir * SEGMENT_X;
      vy = offset * MAX_VY;
    } else {
      if (dir > 0) leftScore += 1;
      else rightScore += 1;
      serveDir = dir;
      conceded = true;
      break;
    }
  }
  if (conceded) {
    const over = leftScore >= POINTS_TO_WIN || rightScore >= POINTS_TO_WIN;
    return { ...s, ball: { x: CENTRE_X, y: CENTRE_Y, vx: 0, vy: 0 }, score: [leftScore, rightScore],
             status: over ? "over" : "point", serveDir };
  }
  return { ...s, ball: { x, y, vx, vy } };
}

/** One decision = one tick: paddles move first (clamped), then the ball advances one segment. */
export function applyTick(state, rightMove, leftMove = "auto") {
  if (state.status === "over") return state;
  const served = state.status === "playing" ? state : serve(state);
  const rightY = clamp(served.rightY + moveDelta(rightMove, MODEL_PADDLE_STEP), PADDLE_MIN_Y, PADDLE_MAX_Y);
  const leftY = leftMove === "auto" ? autoLeftY(served)
    : clamp(served.leftY + moveDelta(leftMove, MODEL_PADDLE_STEP), PADDLE_MIN_Y, PADDLE_MAX_Y);
  return advanceSegment({ ...served, leftY, rightY, tick: served.tick + 1 });
}
