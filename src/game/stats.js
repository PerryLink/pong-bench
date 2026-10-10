// Small shared maths: percentiles, a rolling window, and the totals of a lane's ticks.

export function percentile(values, q) {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

const one = (v) => Math.round(v * 10) / 10;

/** The last `size` values (latencies and the like). */
export class Ring {
  constructor(size) { this.size = size; this.values = []; }
  push(v) { this.values.push(v); if (this.values.length > this.size) this.values.shift(); }
  clear() { this.values = []; }
  q(p) { return percentile(this.values, p); }
  get last() { return this.values.at(-1); }
  get length() { return this.values.length; }
}

/** Events per second, from the median gap between the events of the last `ms` milliseconds: a pause (after a point,
 *  a paused game) is one long gap and does not move the median, for a 25 ms model or a 2 s one alike. */
export class Rate {
  constructor(ms = 6000) { this.ms = ms; this.times = []; }
  hit(now = performance.now()) {
    this.times.push(now);
    while (this.times.length && this.times[0] < now - this.ms) this.times.shift();
  }
  clear() { this.times = []; }
  get perSecond() {
    const t = this.times;
    if (t.length < 3) return NaN;
    const gaps = t.slice(1).map((v, i) => v - t[i]).sort((a, b) => a - b);
    const mid = gaps[Math.floor(gaps.length / 2)];
    return mid > 0 ? 1000 / mid : NaN;
  }
}

/** Totals over a lane's ticks (decision ticks have m >= 0; serves and starts are -1). */
export function summarize(ticks, seconds) {
  const d = ticks.filter((s) => s.m >= 0);
  const ms = d.map((s) => s.ms), sv = d.map((s) => s.sv || 0), over = d.map((s) => s.ms - (s.sv || 0));
  let returns = 0, misses = 0, wallMisses = 0, games = 1;
  for (let i = 1; i < ticks.length; i += 1) {
    const a = ticks[i - 1], b = ticks[i];
    if (b.g !== a.g) { games += 1; continue; }
    if (b.s0 > a.s0) misses += 1;
    if (b.s1 > a.s1) wallMisses += 1;
    returns += b.r || 0;
  }
  return {
    decisions: d.length, seconds: one(seconds), dps: one(d.length / seconds),
    p50: one(percentile(ms, 0.5)), p95: one(percentile(ms, 0.95)),
    model_p50: one(percentile(sv, 0.5)), overhead_p50: one(percentile(over, 0.5)),
    agree: d.length ? Math.round((1000 * d.filter((s) => s.m === s.e).length) / d.length) / 10 : 0,
    returns, misses, wall_misses: wallMisses, games,
  };
}
