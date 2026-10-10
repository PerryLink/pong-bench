// The model's side in real time (Play and Bot match): it keeps asking about the current state and the paddle follows
// its latest answer. Nothing here plays for the model: the paddle moves only on the model's own answers, the rule only
// scores them. Knobs: requests in flight, a decision cap, added latency, and a minimum confidence (below it the
// paddle keeps its previous move).
import { expectedMove, pickMove } from "/game/prompts.js";
import { sleep } from "./watch.js";

/** At most 125 decisions a second in real time: physics changes from frame to frame, so faster only floods the logs
 *  (an instant endpoint would otherwise run thousands per second). The Decisions and Rally suites have no cap. */
const MIN_GAP_MS = 8;

export class ModelDriver {
  /**
   * decider: client.js Decider. input() -> {questions, state(ds), tol}. snapshot() -> {playing, ds, epoch}: the game
   * now; an answer is used only if the epoch (the rally) is still the one its state came from.
   * cfg() -> {inflight, maxRate, addedMs, minConf}. onAnswer(info), onError(err).
   */
  constructor({ decider, input, snapshot, cfg, onAnswer, onError }) {
    Object.assign(this, { decider, input, snapshot, cfg, onAnswer, onError });
    this.ctl = null;
    this.seq = 0;
    this.applied = 0;
    this.lastSend = 0;
    this.inFlight = 0;
    this.stale = 0;
    this.outdated = 0;
  }

  get running() { return !!this.ctl; }

  start() {
    if (this.ctl) return;
    this.ctl = new AbortController();
    const n = Math.max(1, Math.min(2, Number(this.cfg().inflight) || 1));
    for (let i = 0; i < n; i += 1) this.#loop(this.ctl.signal, i * 4);
  }

  stop() {
    this.ctl?.abort();
    this.ctl = null;
    this.inFlight = 0;
  }

  restart() {
    const was = this.running;
    this.stop();
    if (was) this.start();
  }

  async #loop(signal, offsetMs) {
    try {
      if (offsetMs) await sleep(offsetMs, signal);       // the second lane starts a few ms later, so sends interleave
      while (!signal.aborted) {
        let snap = this.snapshot();
        if (!snap.playing) { await sleep(8, signal); continue; }
        const { maxRate, addedMs, minConf, stayBias } = this.cfg();
        const gap = Math.max(maxRate ? 1000 / maxRate : 0, MIN_GAP_MS);
        const wait = this.lastSend + gap - performance.now();
        if (wait > 0) { await sleep(wait, signal); snap = this.snapshot(); if (!snap.playing) continue; }
        const inp = this.input();
        const seq = (this.seq += 1);
        this.lastSend = performance.now();
        this.inFlight += 1;
        const sent = inp.state(snap.ds);
        let a;
        try {
          a = await this.decider.ask(sent, inp.questions, signal);
        } finally {
          this.inFlight -= 1;
        }
        if (addedMs) await sleep(addedMs, signal);
        if (seq < this.applied) { this.stale += 1; continue; }   // an older answer after a newer one: never used
        if (this.snapshot().epoch !== snap.epoch) { this.outdated += 1; continue; }   // its rally ended or paused
        this.applied = seq;
        const choice = pickMove(a.probs, stayBias);
        this.onAnswer({ ...a, choice, raw: a.choice, ds: snap.ds, sent, rule: expectedMove(snap.ds, inp.tol), seq, held: a.conf < minConf,
                        appliedAt: performance.now(), age: performance.now() - a.sentAt });
      }
    } catch (e) {
      if (e.name === "AbortError") return;
      this.onError(e);
      this.stop();
    }
  }
}
