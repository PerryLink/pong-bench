// Real-time Pong for Play (you vs the model) and Bot match. The upstream engine (engine.js) is lockstep: one decision =
// one tick, which is a fair benchmark but far too fast for a person at ~24 decisions/s (a crossing in 0.33 s). Here the
// ball runs on a clock at a speed you choose, and the model steers its paddle with its latest answer, so its latency
// becomes its reaction time. Same court, sizes and bounce rule (offset from the paddle centre sets the angle, up to
// 35 degrees) as engine.js. Pure functions over plain objects, fixed 1/240 s physics substeps (no tunnelling).
import {
  COURT_W, COURT_H, BALL_R, CENTRE_X, CENTRE_Y, LEFT_PLANE, RIGHT_PLANE, CROSSING_X, SEGMENT_X,
  clamp, nextRandom, predictIntercept,
} from "./engine.js";

export const STEP_S = 1 / 240;
const MAX_ANGLE = (35 * Math.PI) / 180;

export const GAME_DEFAULTS = {
  crossingS: 1.6,        // seconds for a served ball to cross the court
  speedUp: 0.05,         // each paddle hit makes the ball this much faster ...
  maxSpeed: 2.5,         // ... up to this multiple of the serve speed
  paddleH: 20,           // paddle height (court units; the court is 160 x 100)
  paddleSpeed: 110,      // the model's paddle, court units per second (yours too when "fair paddles" is on)
  pointsToWin: 5,
};

/** A new match. serveDir 1 serves toward the right (the model), -1 toward the left. */
export function createMatch(seed, cfg = GAME_DEFAULTS) {
  return {
    cfg: { ...GAME_DEFAULTS, ...cfg }, rng: seed | 0, t: 0, status: "ready", serveDir: 1,
    ball: { x: CENTRE_X, y: CENTRE_Y, vx: 0, vy: 0 },
    left: { y: CENTRE_Y, v: 0 }, right: { y: CENTRE_Y, v: 0 },
    score: [0, 0], hits: [0, 0], rally: 0, longest: 0, events: [], info: [],
  };
}

const baseSpeed = (cfg) => CROSSING_X / cfg.crossingS;

export function serve(m) {
  if (m.status === "over") return m;
  const { value, state: rng } = nextRandom(m.rng);
  const a = (value * 2 - 1) * MAX_ANGLE, v = baseSpeed(m.cfg);
  return {
    ...m, rng, status: "playing", rally: 0, events: [],
    ball: { x: CENTRE_X, y: CENTRE_Y, vx: m.serveDir * v, vy: v * Math.tan(a) },
  };
}

/** Move a paddle toward a control: {dir: -1|0|1} or {target: y}, at most `speed` units per second. */
function movePaddle(p, ctl, speed, half, dt) {
  let v = 0;
  if (ctl && ctl.target !== undefined && ctl.target !== null) {
    const d = ctl.target - p.y;
    v = clamp(d / dt, -speed, speed);
  } else if (ctl && ctl.dir) v = ctl.dir * speed;
  const y = clamp(p.y + v * dt, half, COURT_H - half);
  return { y, v: (y - p.y) / dt };
}

/** One physics substep. ctl: {left, right} paddle controls; speeds: {left, right} units per second. */
function substep(m, ctl, speeds, dt) {
  const half = m.cfg.paddleH / 2, reach = half + BALL_R;
  const left = movePaddle(m.left, ctl.left, speeds.left, half, dt);
  const right = movePaddle(m.right, ctl.right, speeds.right, half, dt);
  let { x, y, vx, vy } = m.ball;
  x += vx * dt;
  y += vy * dt;
  const events = [...m.events], info = [...m.info];
  const r = (v) => Math.round(v * 100) / 100, rel = (v) => r(Math.abs(v) / baseSpeed(m.cfg));
  if (y < BALL_R) { y = 2 * BALL_R - y; vy = -vy; events.push("wall"); info.push({ type: "wall", x: r(x), y: 0 }); }
  if (y > COURT_H - BALL_R) { y = 2 * (COURT_H - BALL_R) - y; vy = -vy; events.push("wall"); info.push({ type: "wall", x: r(x), y: COURT_H }); }
  let { score, hits, rally, longest, status, serveDir } = m;
  const side = vx > 0 && x >= RIGHT_PLANE ? 1 : vx < 0 && x <= LEFT_PLANE ? 0 : -1;
  if (side >= 0) {
    const paddleY = side ? right.y : left.y;
    const plane = side ? RIGHT_PLANE : LEFT_PLANE;
    // where the ball crossed the paddle's line (not where it is after the step, up to vx/240 past it), computed by the
    // same function that gives H2O its interceptY, from the ball at the start of the step: a wall bounce inside the
    // step is folded in, and the game judges exactly the point H2O was told about
    y = predictIntercept({ ball: m.ball }, side ? "right" : "left") ?? y;
    if (Math.abs(y - paddleY) <= reach) {
      const speed = Math.min(Math.abs(vx) * (1 + m.cfg.speedUp), baseSpeed(m.cfg) * m.cfg.maxSpeed);
      const offset = clamp((y - paddleY) / half, -1, 1);
      const rest = Math.abs(x - plane);                  // the part of the step after the crossing
      x = plane - Math.sign(vx) * rest;
      vx = (side ? -1 : 1) * speed;
      vy = speed * Math.tan(offset * MAX_ANGLE);
      hits = side ? [hits[0], hits[1] + 1] : [hits[0] + 1, hits[1]];
      rally += 1;
      longest = Math.max(longest, rally);
      events.push(side ? "hit-right" : "hit-left");
      info.push({ type: side ? "hit-right" : "hit-left", y: r(y), paddleY: r(paddleY), offset: r(offset), speed: rel(speed),
                  rally });
    } else {
      score = side ? [score[0] + 1, score[1]] : [score[0], score[1] + 1];
      serveDir = side ? 1 : -1;                      // the side that missed is served to again
      status = Math.max(...score) >= m.cfg.pointsToWin ? "over" : "point";
      events.push(side ? "miss-right" : "miss-left");
      info.push({ type: side ? "miss-right" : "miss-left", y: r(y), paddleY: r(paddleY), gap: r(Math.abs(y - paddleY) - reach),
                  paddleV: r(side ? right.v : left.v), speed: rel(vx), rally, score });
      return { ...m, t: m.t + dt, left, right, score, hits, rally, longest, status, serveDir, events, info,
               ball: { x: CENTRE_X, y: CENTRE_Y, vx: 0, vy: 0 } };
    }
  }
  return { ...m, t: m.t + dt, left, right, score, hits, rally, longest, status, serveDir, events, info, ball: { x, y, vx, vy } };
}

/** Advance by dt seconds (fixed substeps; the remainder carries over in m.acc). Paddles still move between points. */
export function advance(m, dt, ctl, speeds) {
  let acc = (m.acc || 0) + Math.min(dt, 0.1), s = { ...m, events: [], info: [] };
  while (acc >= STEP_S) {
    if (s.status === "playing") s = substep(s, ctl, speeds, STEP_S);
    else {
      const half = s.cfg.paddleH / 2;
      s = { ...s, left: movePaddle(s.left, ctl.left, speeds.left, half, STEP_S),
            right: movePaddle(s.right, ctl.right, speeds.right, half, STEP_S) };
    }
    acc -= STEP_S;
  }
  return { ...s, acc };
}

const r1 = (n) => { const v = Math.round(n * 10) / 10; return v === 0 ? 0 : v; };

/** The decision state for the right paddle, in upstream's shape and units: velocities per segment (19 = serve speed
 *  along x, as in the lockstep game), one decimal. paddle.x is extra (only the no-interceptY variant reads it). */
export function decisionState(m) {
  const k = SEGMENT_X / baseSpeed(m.cfg);
  const toward = m.ball.vx > 0;
  const intercept = m.status === "playing" ? predictIntercept({ ball: m.ball }, "right") : null;
  return {
    court: { w: COURT_W, h: COURT_H },
    ball: { x: r1(m.ball.x), y: r1(m.ball.y), vx: r1(m.ball.vx * k), vy: r1(m.ball.vy * k) },
    paddle: { x: RIGHT_PLANE, y: r1(m.right.y), h: m.cfg.paddleH },
    interceptY: intercept === null ? null : r1(intercept),
    dir: toward ? "toward" : "away",
  };
}

/** The bot's control for the left paddle: track where the ball will arrive, seen `lagS` late, off by up to `err`. */
export function botControl(m, seen, err) {
  if (!seen || seen.status !== "playing" || seen.ball.vx >= 0) return { target: CENTRE_Y };
  const y = predictIntercept({ ball: seen.ball }, "left");
  return { target: y === null ? CENTRE_Y : y + err };
}

export const BOT_LEVELS = {
  easy: { label: "Easy", lagS: 0.22, err: 9, speed: 0.6 },
  medium: { label: "Medium", lagS: 0.14, err: 6, speed: 0.8 },
  hard: { label: "Hard", lagS: 0.07, err: 3, speed: 1 },
  wall: { label: "Perfect", lagS: 0, err: 0, speed: 2 },
};
