// Pong lanes: the court renderer and the replay timeline. Cheap by design: everything static (court, net, scanlines,
// vignette) is drawn once per size into an offscreen layer; a frame is one drawImage plus a few shapes. Glow only on
// the ball and paddles, effects off when the viewer prefers reduced motion.
import { COURT_W, COURT_H, BALL_R, PADDLE_INSET, RIGHT_PLANE, LEFT_PLANE } from "/game/engine.js";

export const COLORS = { model: "#34d3a6", you: "#f2b84b", wall: "#8b98a8", ball: "#f4fbf8", court: "#06110d" };
const REDUCED = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ------------------------------------------------------------------ replay timeline (Watch recordings) */
export const COLS = ["t", "bx", "by", "ly", "ry", "s0", "s1", "g", "m", "e", "pu", "pd", "ps", "ms", "ty", "r", "sv"];
export const toRow = (s) => COLS.map((k) => s[k]);
export const fromRow = (r, cols = COLS) => Object.fromEntries(cols.map((k, i) => [k, r[i]]));

export function indexAt(ticks, t) {
  let lo = 0, hi = ticks.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ticks[mid].t <= t) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return best;
}

/** The court at time t: positions eased between ticks (never across a point or a new game). */
export function frameAt(ticks, t) {
  const i = indexAt(ticks, t);
  if (i < 0) return null;
  const a = ticks[i], b = ticks[i + 1];
  if (!b || b.g !== a.g || b.s0 !== a.s0 || b.s1 !== a.s1 || b.t <= a.t) return a;
  const f = Math.min(1, (t - a.t) / (b.t - a.t));
  const mix = (k) => a[k] + (b[k] - a[k]) * f;
  return { ...a, bx: mix("bx"), by: mix("by"), ly: mix("ly"), ry: mix("ry") };
}

/* ------------------------------------------------------------------ the ball's path (for the guide) */
/** Points from the ball to a paddle plane, folding at the walls (null if the ball is not heading there). */
export function pathTo(ball, side) {
  const { x, y, vx, vy } = ball;
  if (!vx || (side === "right" ? vx < 0 : vx > 0)) return null;
  const plane = side === "right" ? RIGHT_PLANE : LEFT_PLANE, lo = BALL_R, hi = COURT_H - BALL_R;
  const pts = [[x, y]];
  let cx = x, cy = y, cvy = vy;
  for (let guard = 0; guard < 12; guard += 1) {
    const tPlane = (plane - cx) / vx;
    const tWall = cvy > 0 ? (hi - cy) / cvy : cvy < 0 ? (lo - cy) / cvy : Infinity;
    if (tPlane <= tWall) { pts.push([plane, cy + cvy * tPlane]); return pts; }
    cx += vx * tWall; cy = cvy > 0 ? hi : lo; cvy = -cvy;
    pts.push([cx, cy]);
  }
  return pts;
}

/* ------------------------------------------------------------------ seven-segment digits */
const SEG = { 0: "abcdef", 1: "bc", 2: "abdeg", 3: "abcdg", 4: "bcfg", 5: "acdfg", 6: "acdefg", 7: "abc", 8: "abcdefg", 9: "abcdfg" };
function digit(ctx, ch, x, y, w, h, on, off) {
  const t = w * 0.2, segs = SEG[ch] || "";
  const bars = {
    a: [x + t, y, w - 2 * t, t], d: [x + t, y + h - t, w - 2 * t, t], g: [x + t, y + h / 2 - t / 2, w - 2 * t, t],
    f: [x, y + t, t, h / 2 - t], b: [x + w - t, y + t, t, h / 2 - t], e: [x, y + h / 2, t, h / 2 - t], c: [x + w - t, y + h / 2, t, h / 2 - t],
  };
  for (const [k, r] of Object.entries(bars)) {
    ctx.fillStyle = segs.includes(k) ? on : off;
    ctx.fillRect(...r);
  }
}
function number(ctx, n, cx, y, w, h, on, off) {
  const s = String(n), gap = w * 0.35, total = s.length * w + (s.length - 1) * gap;
  [...s].forEach((ch, i) => digit(ctx, ch, cx - total / 2 + i * (w + gap), y, w, h, on, off));
}

/* ------------------------------------------------------------------ renderer */
export class Court {
  constructor(canvas, { compact = false } = {}) {
    this.cv = canvas;
    this.compact = compact;
    this.layer = null;
    this.key = "";
    this.flashes = [];
    this.trail = [];
  }

  #fit() {
    const r = this.cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (this.cv.width !== w || this.cv.height !== h) { this.cv.width = w; this.cv.height = h; }
    const k = Math.min(w / COURT_W, h / COURT_H);
    this.g = { W: w, H: h, k, ox: (w - COURT_W * k) / 2, oy: (h - COURT_H * k) / 2 };
    const key = `${w}x${h}`;
    if (key !== this.key) { this.key = key; this.layer = this.#static(); }
  }

  #static() {
    const { W, H, k, ox, oy } = this.g;
    const off = document.createElement("canvas");
    off.width = W; off.height = H;
    const c = off.getContext("2d");
    const cw = COURT_W * k, ch = COURT_H * k;
    c.fillStyle = COLORS.court;
    c.beginPath(); c.roundRect(ox, oy, cw, ch, k * 2.5); c.fill();
    const glow = c.createRadialGradient(ox + cw / 2, oy + ch / 2, ch * 0.1, ox + cw / 2, oy + ch / 2, cw * 0.62);
    glow.addColorStop(0, "rgba(52,211,166,0.07)"); glow.addColorStop(1, "rgba(0,0,0,0.35)");
    c.fillStyle = glow; c.fill();
    if (!this.compact) {                                  // scanlines: one hairline every 3 device pixels
      c.fillStyle = "rgba(0,0,0,0.18)";
      for (let y = Math.floor(oy); y < oy + ch; y += 3) c.fillRect(ox, y, cw, 1);
    }
    c.strokeStyle = "rgba(180,255,230,0.10)"; c.lineWidth = Math.max(1, k * 0.35);
    c.beginPath(); c.roundRect(ox, oy, cw, ch, k * 2.5); c.stroke();
    c.fillStyle = "rgba(180,255,230,0.13)";                 // the net: short dashes
    for (let y = 2; y < COURT_H; y += 6) c.fillRect(ox + (COURT_W / 2 - 0.4) * k, oy + y * k, 0.8 * k, 3 * k);
    return off;
  }

  /**
   * scene: {ball:{x,y}, left:{y,h,color}, right:{y,h,color}, score:[l,r], guide:[[x,y]...]|null, target:y|null,
   *         events:[...], effects, trail, live}
   */
  draw(scene) {
    this.#fit();
    const { W, H, k, ox, oy } = this.g;
    const c = this.cv.getContext("2d");
    const X = (x) => ox + x * k, Y = (y) => oy + y * k;
    c.clearRect(0, 0, W, H);
    c.drawImage(this.layer, 0, 0);
    if (!scene) return;
    const fx = scene.effects && !REDUCED;

    if (!this.compact && scene.score) {
      const dw = k * 7, dh = k * 13;
      number(c, scene.score[0], X(COURT_W * 0.3), Y(6), dw, dh, "rgba(244,251,248,0.30)", "rgba(244,251,248,0.035)");
      number(c, scene.score[1], X(COURT_W * 0.7), Y(6), dw, dh, "rgba(244,251,248,0.30)", "rgba(244,251,248,0.035)");
    } else if (scene.score) {
      c.fillStyle = "rgba(244,251,248,0.28)"; c.font = `600 ${Math.round(k * 12)}px Bahnschrift, "DIN Alternate", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Roboto, Arial, sans-serif`;
      c.textAlign = "center"; c.textBaseline = "top";
      c.fillText(String(scene.score[0]), X(COURT_W * 0.3), Y(5)); c.fillText(String(scene.score[1]), X(COURT_W * 0.7), Y(5));
    }

    if (scene.guide && scene.guide.length > 1) {          // the ball's coming path, dotted
      c.strokeStyle = "rgba(52,211,166,0.32)"; c.lineWidth = Math.max(1, k * 0.35);
      c.setLineDash([k * 1.2, k * 1.8]);
      c.beginPath(); scene.guide.forEach(([x, y], i) => (i ? c.lineTo(X(x), Y(y)) : c.moveTo(X(x), Y(y)))); c.stroke();
      c.setLineDash([]);
    }
    if (scene.target !== null && scene.target !== undefined) {   // interceptY: where the model should be
      c.strokeStyle = scene.right.color; c.globalAlpha = 0.55; c.lineWidth = Math.max(1.5, k * 0.6);
      c.beginPath(); c.moveTo(X(RIGHT_PLANE + 1.6), Y(scene.target)); c.lineTo(X(COURT_W - 0.6), Y(scene.target)); c.stroke();
      c.globalAlpha = 1;
    }

    const pw = Math.max(2, k * 1.8);
    paddle(c, X(PADDLE_INSET) - pw, Y(scene.left.y), pw, scene.left.h * k, scene.left.color, fx);
    paddle(c, X(RIGHT_PLANE), Y(scene.right.y), pw, scene.right.h * k, scene.right.color, fx);

    const r = Math.max(2, BALL_R * k);
    if (scene.trail) {
      this.trail.push([scene.ball.x, scene.ball.y]);
      if (this.trail.length > 10) this.trail.shift();
      this.trail.forEach(([x, y], i) => {
        c.fillStyle = `rgba(244,251,248,${(0.22 * (i + 1)) / this.trail.length})`;
        c.beginPath(); c.arc(X(x), Y(y), r * (0.45 + 0.5 * (i / this.trail.length)), 0, Math.PI * 2); c.fill();
      });
    } else this.trail = [];
    if (fx) { c.shadowColor = "rgba(244,251,248,0.9)"; c.shadowBlur = r * 3; }
    c.fillStyle = COLORS.ball;
    c.beginPath(); c.arc(X(scene.ball.x), Y(scene.ball.y), r, 0, Math.PI * 2); c.fill();
    c.shadowBlur = 0;

    if (fx) this.#flashes(c, scene, X, Y, k);
  }

  /** Reset the trail (a point, a new game: the ball jumps to the centre). */
  jump() { this.trail = []; }

  #flashes(c, scene, X, Y, k) {
    const now = performance.now();
    for (const e of scene.events || []) {
      if (e.startsWith("hit")) {
        const right = e === "hit-right";
        this.flashes.push({ t: now, x: right ? RIGHT_PLANE : PADDLE_INSET, y: right ? scene.right.y : scene.left.y,
                            color: right ? scene.right.color : scene.left.color });
      }
      if (e.startsWith("miss")) this.flashes.push({ t: now, x: e === "miss-right" ? COURT_W - 3 : 3, y: COURT_H / 2, color: "#f2685b", big: true });
    }
    this.flashes = this.flashes.filter((f) => now - f.t < (f.big ? 450 : 260));
    for (const f of this.flashes) {
      const p = (now - f.t) / (f.big ? 450 : 260);
      c.strokeStyle = f.color; c.globalAlpha = 1 - p; c.lineWidth = Math.max(1, k * (f.big ? 1.2 : 0.6));
      c.beginPath(); c.arc(X(f.x), Y(f.y), k * (f.big ? 4 + 40 * p : 2 + 8 * p), 0, Math.PI * 2); c.stroke();
    }
    c.globalAlpha = 1;
  }
}

function paddle(c, x, cy, w, h, color, fx) {
  if (fx) { c.shadowColor = color; c.shadowBlur = w * 3; }
  c.fillStyle = color;
  c.beginPath(); c.roundRect(x, cy - h / 2, w, h, w / 2); c.fill();
  c.shadowBlur = 0;
}

/** Latency sparkline: round trip (line) over model time (fill), the last values, scaled to at least 50 ms. */
export function drawSpark(cv, trip, model, color) {
  const dpr = Math.min(2, window.devicePixelRatio || 1), r = cv.getBoundingClientRect();
  const W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr));
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const c = cv.getContext("2d"), pad = 4 * dpr;
  c.clearRect(0, 0, W, H);
  if (trip.length < 2) return;
  const top = Math.max(50, ...trip) * 1.1;
  const px = (i) => pad + (i / (trip.length - 1)) * (W - 2 * pad), py = (v) => H - pad - (v / top) * (H - 2 * pad);
  c.fillStyle = "rgba(52,211,166,0.16)";
  c.beginPath(); c.moveTo(px(0), H - pad);
  model.forEach((v, i) => c.lineTo(px(i), py(v)));
  c.lineTo(px(model.length - 1), H - pad); c.fill();
  c.strokeStyle = color; c.lineWidth = 1.5 * dpr;
  c.beginPath(); trip.forEach((v, i) => (i ? c.lineTo(px(i), py(v)) : c.moveTo(px(i), py(v)))); c.stroke();
}
