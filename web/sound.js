// Tiny game sounds (off by default): one short oscillator blip per event, nothing loaded.
let ctx = null;
const TONES = { "hit-left": [440, 0.05], "hit-right": [587, 0.05], wall: [294, 0.035], "miss-left": [147, 0.22], "miss-right": [147, 0.22] };

export function blip(kind) {
  const tone = TONES[kind];
  if (!tone) return;
  try {
    ctx ||= new AudioContext();
    const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
    o.type = "square";
    o.frequency.value = tone[0];
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + tone[1]);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + tone[1] + 0.02);
  } catch { /* no audio device or blocked: the game stays silent */ }
}
