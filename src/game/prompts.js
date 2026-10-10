// What the model is asked. A prompt is plain data: instructions and the three answers' criteria as templates ({tol} is
// the stay tolerance), an optional context line, and which state fields the model gets. Shared by the browser app and
// the Node runner, so both ask exactly the same thing.
//
// The "standard" prompt is word for word decisio v0.10.0 examples/demos/pong/lib/decide/prompt.ts (default variant;
// Apache-2.0, see ATTRIBUTION.md) with its exact state: it is the benchmark's official track. "compact", "minimal" and
// "reasoning" are PongBench's own tracks. Changed from upstream: plain JavaScript, the tolerance is a parameter,
// prompts are data, the extra tracks.

export const MOVES = ["up", "down", "stay"];
export const STAY_TOLERANCE = 5;

/** State fields a prompt can send. paddle.y is always sent (no move can be judged without it). */
export const FIELDS = [
  ["court", "Court size", "court.w, court.h"],
  ["ballPos", "Ball position", "ball.x, ball.y"],
  ["ballVel", "Ball velocity", "ball.vx, ball.vy"],
  ["paddleX", "Paddle x", "paddle.x (156: the right paddle's plane)"],
  ["paddleH", "Paddle height", "paddle.h"],
  ["intercept", "interceptY", "where the ball will reach the paddle (null when moving away)"],
  ["offset", "Offset", "offset = interceptY - paddle.y (null when moving away)"],
  ["window", "Stay window", "window.from / window.to = paddle.y - / + the tolerance"],
  ["dir", "Direction", 'dir: "toward" or "away"'],
];

/** The built-in prompts: the benchmark's tracks. */
export const TRACKS = {
  standard: {
    name: "Standard", builtin: true,
    note: "decisio's own Pong prompt and state, word for word: the official track (comparable with the original demo)",
    instructions: [
      "You control the right paddle in a game of Pong.",
      "The state is a JSON object of numbers: the court size, the ball position and velocity,",
      "your paddle (paddle.y is its CENTRE, paddle.h its height), interceptY, and dir.",
      'y = 0 is the top edge and y grows downward, so "up" DECREASES y and "down" INCREASES y.',
      "interceptY is the y value where the ball will cross your paddle plane after any wall bounces;",
      "it is null when the ball is moving away from you.",
      "Move so that paddle.y covers interceptY. Treat the paddle as already covering it when paddle.y is within {tol} units of interceptY.",
      "Answer with one move only.",
    ].join(" "),
    criteria: {
      up: "interceptY is more than {tol} units above paddle.y (interceptY < paddle.y - {tol}). Moving up decreases paddle.y.",
      down: "interceptY is more than {tol} units below paddle.y (interceptY > paddle.y + {tol}). Moving down increases paddle.y.",
      stay: "interceptY is null, or paddle.y is already within {tol} units of interceptY.",
    },
    context: "", fields: ["court", "ballPos", "ballVel", "paddleH", "intercept", "dir"], decimals: 1,
  },
  compact: {
    name: "Compact", builtin: true,
    note: "the same rule in about half the words, and only the fields the rule needs",
    instructions: [
      "Pong: you move the right paddle. y = 0 is the top edge and y grows downward.",
      "interceptY is where the ball will reach your paddle (null when the ball moves away).",
      "Compare interceptY with paddle.y and answer with one move (within {tol} units counts as covered).",
    ].join(" "),
    criteria: {
      up: "interceptY < paddle.y - {tol}: the ball will arrive above the paddle.",
      down: "interceptY > paddle.y + {tol}: the ball will arrive below the paddle.",
      stay: "interceptY is null, or within {tol} units of paddle.y.",
    },
    context: "", fields: ["intercept", "dir"], decimals: 1,
  },
  minimal: {
    name: "Minimal", builtin: true,
    note: "one line of instructions and bare comparisons: how much does the model need to be told?",
    instructions: "Right Pong paddle. y grows downward.",
    criteria: { up: "interceptY < paddle.y - {tol}", down: "interceptY > paddle.y + {tol}", stay: "otherwise, or interceptY is null" },
    context: "", fields: ["intercept"], decimals: 1,
  },
  reasoning: {
    name: "Reasoning", builtin: true,
    note: "no interceptY: the model gets the ball's position and velocity and must work out the bounce itself",
    instructions: [
      "You control the right paddle in a game of Pong. The court is court.w wide and court.h tall;",
      'y = 0 is the top edge and y grows downward, so "up" DECREASES y and "down" INCREASES y.',
      "The ball moves by (ball.vx, ball.vy) each step and bounces off the top and bottom edges.",
      "Your paddle (paddle.y is its centre) sits at x = paddle.x. When ball.vx > 0 the ball is coming to you:",
      "work out the y where it will reach x = paddle.x and move so that paddle.y is within {tol} units of it.",
      "When ball.vx < 0 the ball is moving away. Answer with one move only.",
    ].join(" "),
    criteria: {
      up: "The ball is coming and will reach your paddle more than {tol} units above paddle.y.",
      down: "The ball is coming and will reach your paddle more than {tol} units below paddle.y.",
      stay: "The ball is moving away, or it will reach your paddle within {tol} units of paddle.y.",
    },
    context: "", fields: ["court", "ballPos", "ballVel", "paddleX", "paddleH"], decimals: 1,
  },
};

const fill = (text, tol) => String(text).replaceAll("{tol}", String(tol));
const validOrder = (o) => Array.isArray(o) && o.length === 3 && MOVES.every((m) => o.includes(m));

/** The question a prompt asks at a tolerance (its answers in prompt.order when it sets one). */
export function questionOf(prompt, tol = STAY_TOLERANCE) {
  const order = validOrder(prompt.order) ? prompt.order : MOVES;
  return { move: { type: "choice", instructions: fill(prompt.instructions, tol),
                   criteria: Object.fromEntries(order.map((m) => [m, fill(prompt.criteria[m], tol)])) } };
}

const round = (d) => (n) => {
  const k = 10 ** d, v = Math.round(n * k) / k;
  return v === 0 ? 0 : v;
};

/** The state a prompt sends, built from the full decision state `ds` (upstream's field order kept). */
export function stateOf(prompt, ds, tol = STAY_TOLERANCE) {
  const f = new Set(prompt.fields), r = round(prompt.decimals ?? 1);
  const out = {};
  if (prompt.context) out.context = prompt.context;
  if (f.has("court")) out.court = { w: ds.court.w, h: ds.court.h };
  if (f.has("ballPos") || f.has("ballVel")) {
    out.ball = {};
    if (f.has("ballPos")) Object.assign(out.ball, { x: r(ds.ball.x), y: r(ds.ball.y) });
    if (f.has("ballVel")) Object.assign(out.ball, { vx: r(ds.ball.vx), vy: r(ds.ball.vy) });
  }
  out.paddle = {};
  if (f.has("paddleX")) out.paddle.x = ds.paddle.x ?? 156;
  out.paddle.y = r(ds.paddle.y);
  if (f.has("paddleH")) out.paddle.h = ds.paddle.h;
  if (f.has("intercept")) out.interceptY = ds.interceptY === null ? null : r(ds.interceptY);
  if (f.has("offset")) out.offset = ds.interceptY === null ? null : r(ds.interceptY - ds.paddle.y);
  if (f.has("window")) out.window = { from: r(ds.paddle.y - tol), to: r(ds.paddle.y + tol) };
  if (f.has("dir")) out.dir = ds.dir;
  return out;
}

/** A track by name, or null. */
export const track = (name) => TRACKS[name] || null;

/** A prompt from untrusted JSON (a saved preset, a config file): every field checked, defaults filled in. */
export function cleanPrompt(p) {
  if (!p || typeof p !== "object") return null;
  const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
  const criteria = Object.fromEntries(MOVES.map((m) => [m, str(p.criteria?.[m], 600)]));
  if (!str(p.instructions, 4000).trim() || MOVES.some((m) => !criteria[m].trim())) return null;
  const known = new Set(FIELDS.map(([k]) => k));
  return {
    name: str(p.name, 60) || "Untitled", note: str(p.note, 200), instructions: str(p.instructions, 4000), criteria,
    context: str(p.context, 2000), fields: Array.isArray(p.fields) ? p.fields.filter((k) => known.has(k)) : [],
    decimals: p.decimals === 0 ? 0 : 1, ...(validOrder(p.order) ? { order: [...p.order] } : {}),
  };
}

/** The move played from a model's probabilities [up, down, stay]: the most likely one after `stayBias` is taken off
 *  "stay" (0 = the plain top answer, which official runs use). */
export function pickMove(probs, stayBias = 0) {
  const q = [probs[0], probs[1], probs[2] - (stayBias || 0)];
  return MOVES[q.indexOf(Math.max(...q))];
}

/** The move the rule asks for. Every answer is scored against it; nothing ever plays it. */
export function expectedMove(s, tol = STAY_TOLERANCE) {
  if (s.interceptY === null) return "stay";
  const delta = s.interceptY - s.paddle.y;
  if (Math.abs(delta) <= tol) return "stay";
  return delta < 0 ? "up" : "down";
}

/** The tracks under the name the app uses for its built-in prompts. */
export const BUILTINS = TRACKS;
