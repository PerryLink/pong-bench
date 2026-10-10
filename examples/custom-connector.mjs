// A custom player for PongBench's "module" connector: any JavaScript you like (call your own SDK, a local process,
// a cache, a rule ...). configs/custom-module.json points here.
//
//   export function create(options) -> { decide({ state, questions }, { signal }) -> answer, close?() }
//
// The answer is either { choice: "up" | "down" | "stay" } or, better, with the model's probabilities:
//   { choice: "up", probabilities: { up: 0.7, down: 0.1, stay: 0.2 } }
// (or the full System One shape { answers: { move: { choice, probabilities } } }).
//
// This example reads interceptY and paddle.y from the state (the standard and compact tracks send both) and moves
// toward the ball, with a little doubt near the tolerance, so it shows how the scorecard treats probabilities.

export function create({ tolerance = 5 } = {}) {
  return {
    async decide({ state }) {
      const { interceptY } = state;
      const y = state.paddle?.y;
      if (interceptY === null || interceptY === undefined || typeof y !== "number") {
        return { choice: "stay", probabilities: { up: 0.05, down: 0.05, stay: 0.9 } };
      }
      const delta = interceptY - y;
      const near = Math.abs(Math.abs(delta) - tolerance) < 2;      // close to the line: less sure
      const sure = near ? 0.6 : 0.95, rest = (1 - sure) / 2;
      if (delta < -tolerance) return { choice: "up", probabilities: { up: sure, down: rest, stay: rest } };
      if (delta > tolerance) return { choice: "down", probabilities: { up: rest, down: sure, stay: rest } };
      return { choice: "stay", probabilities: { up: rest, down: rest, stay: sure } };
    },
  };
}
