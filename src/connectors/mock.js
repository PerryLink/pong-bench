// Built-in players with no model behind them: reference points for the scores and a way to try PongBench without an
// endpoint. They read the same state a model gets (computing interceptY themselves on the reasoning track).
//
//   policy   "oracle"   always the rule's move (the ceiling: 100% decisions, never misses)
//            "random"   uniform over the three moves (the floor)
//            "stay"     always stay
//            "noisy"    the rule's move, wrong with probability errorRate (default 0.1)
//            "hesitant" the rule's move, but "stay" with probability nearStay when the ball will arrive just outside
//                       the tolerance (5 to 12 units away): the mistake decision models make most
//            "down"     always down (a badly biased model)
//   latencyMs, jitterMs  simulated answer time (default 0); seed  for the random draws
import { MOVES, STAY_TOLERANCE, expectedMove } from "../game/prompts.js";
import { predictIntercept, nextRandom } from "../game/engine.js";
import { ConnectorError, decision } from "./common.js";

const POLICIES = ["oracle", "random", "stay", "noisy", "hesitant", "down"];

export function create(cfg) {
  const policy = cfg.policy || "oracle";
  if (!POLICIES.includes(policy)) throw new ConnectorError(`mock policy must be one of ${POLICIES.join(", ")}`);
  let rng = (cfg.seed ?? 12345) | 0;
  const rand = () => { const r = nextRandom(rng); rng = r.state; return r.value; };
  const tol = cfg.tolerance ?? STAY_TOLERANCE;

  /** interceptY and paddle.y from whatever the state carries. */
  function read(state) {
    const py = state?.paddle?.y;
    if (typeof py !== "number") return null;
    if ("interceptY" in state) return { interceptY: state.interceptY, paddle: { y: py } };
    if ("offset" in state) return { interceptY: state.offset === null ? null : py + state.offset, paddle: { y: py } };
    if (state.ball && typeof state.ball.vx === "number") {
      const toward = state.ball.vx > 0;
      return { interceptY: toward ? predictIntercept({ ball: state.ball }, "right") : null, paddle: { y: py } };
    }
    return null;
  }

  function choose(state) {
    if (policy === "random") return MOVES[Math.floor(rand() * 3)];
    if (policy === "stay") return "stay";
    if (policy === "down") return "down";
    const s = read(state);
    const rule = s ? expectedMove(s, tol) : "stay";
    if (policy === "noisy" && rand() < (cfg.errorRate ?? 0.1)) return MOVES.filter((m) => m !== rule)[Math.floor(rand() * 2)];
    if (policy === "hesitant" && rule !== "stay") {
      const d = Math.abs(s.interceptY - s.paddle.y);
      if (d < 12 && rand() < (cfg.nearStay ?? 0.6)) return "stay";
    }
    return rule;
  }

  const wait = () => {
    const ms = (cfg.latencyMs || 0) + (cfg.jitterMs ? rand() * cfg.jitterMs : 0);
    return ms > 0 ? new Promise((ok) => setTimeout(ok, ms)) : null;
  };

  return {
    kind: "mock", url: `mock:${policy}`,
    async decide({ state }) {
      const pause = wait();
      if (pause) await pause;
      const choice = choose(state);
      const sharp = policy === "random" ? [1 / 3, 1 / 3, 1 / 3] : MOVES.map((m) => (m === choice ? 0.9 : 0.05));
      return decision(choice, sharp, "model", { usage: { input_tokens: 0, output_tokens: 0 } });
    },
  };
}
