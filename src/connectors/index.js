// One door to every kind of model: connect(config) -> a player with decide({state, questions}) that times every call,
// counts calls, errors and tokens, and keeps to an optional call budget (maxCalls).
import { resolveKey } from "../config.js";
import { ConnectorError } from "./common.js";
import * as systemone from "./systemone.js";
import * as openai from "./openai.js";
import * as anthropic from "./anthropic.js";
import * as mock from "./mock.js";
import * as moduleConnector from "./module.js";

const KINDS = { systemone, openai, anthropic, mock, module: moduleConnector };

export async function connect(cfg) {
  const kind = KINDS[cfg.connector];
  if (!kind) throw new ConnectorError(`unknown connector "${cfg.connector}"`);
  const impl = await kind.create(cfg, { key: resolveKey(cfg), baseDir: cfg.baseDir });
  const stats = { calls: 0, errors: 0, inputTokens: 0, outputTokens: 0, lastError: "" };
  return {
    id: cfg.id, name: cfg.name, kind: impl.kind, url: impl.url, model: cfg.model || "", stats,
    /** One decision: {choice, probs, probSource, ms, serverMs?, usage?}. Throws ConnectorError (or AbortError). */
    async decide(request, ctx = {}) {
      if (cfg.maxCalls && stats.calls >= cfg.maxCalls) throw new ConnectorError(`the call budget (maxCalls ${cfg.maxCalls}) is used up`);
      stats.calls += 1;
      const t0 = performance.now();
      try {
        const d = await impl.decide(request, ctx);
        d.ms = performance.now() - t0;
        stats.inputTokens += d.usage?.input_tokens || 0;
        stats.outputTokens += d.usage?.output_tokens || 0;
        return d;
      } catch (e) {
        if (e.name !== "AbortError") { stats.errors += 1; stats.lastError = e.message; }
        throw e;
      }
    },
    async close() { await impl.close?.(); },
  };
}

export { ConnectorError };
