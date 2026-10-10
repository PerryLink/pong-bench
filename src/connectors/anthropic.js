// Claude through Anthropic's official SDK (npm install @anthropic-ai/sdk; loaded only when this connector is used, so
// the rest of PongBench stays dependency-free). Structured output with an enum of the three moves.
//
//   model      default claude-opus-5-5 (any Claude model: claude-sonnet-5-5, claude-haiku-5-5, ...)
//   effort     output_config.effort ("low" suits a one-word decision; omit for the model's default)
//   maxTokens  default 1024 (room for the model's thinking before the one-word answer)
//   apiKeyEnv  optional: the SDK itself finds ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN or an `ant auth login` profile
//
// No server-side model fallbacks: a benchmark must measure one model, so a refusal is recorded as an error instead of
// being answered by another model. Probabilities are one-hot (the Messages API returns no distribution).
import { CHAT_SYSTEM, ConnectorError, decision, parseChoiceText, renderChat } from "./common.js";
import { MOVES } from "../game/prompts.js";

const SCHEMA = { type: "object", properties: { move: { type: "string", enum: MOVES } }, required: ["move"], additionalProperties: false };

export async function create(cfg, { key }) {
  let Anthropic;
  try {
    ({ default: Anthropic } = await import("@anthropic-ai/sdk"));
  } catch {
    throw new ConnectorError("the anthropic connector needs Anthropic's SDK: run `npm install @anthropic-ai/sdk` in this folder");
  }
  const client = new Anthropic({ ...(key ? { apiKey: key } : {}), maxRetries: cfg.retries ?? 4, timeout: cfg.timeoutMs ?? 120000,
                                 ...(cfg.baseUrl ? { baseURL: cfg.baseUrl } : {}) });
  const model = cfg.model || "claude-opus-5-5";
  return {
    kind: "anthropic", url: "https://api.anthropic.com/v1/messages",
    async decide({ state, questions }, { signal } = {}) {
      const q = questions.move ?? Object.values(questions)[0];
      let msg;
      try {
        msg = await client.messages.create({
          model, max_tokens: cfg.maxTokens ?? 1024, system: CHAT_SYSTEM,
          messages: [{ role: "user", content: renderChat(state, q, { json: true }) }],
          output_config: { format: { type: "json_schema", schema: SCHEMA }, ...(cfg.effort ? { effort: cfg.effort } : {}) },
          ...(cfg.extraBody || {}),
        }, { signal });
      } catch (e) {
        if (e.name === "AbortError" || signal?.aborted) throw new DOMException("stopped", "AbortError");
        throw new ConnectorError(e.message || "the Messages API failed", { status: e.status || 0 });
      }
      if (msg.stop_reason === "refusal") throw new ConnectorError(`the model declined (${msg.stop_details?.category || "no category"})`);
      const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
      let move;
      try { move = JSON.parse(text).move; } catch { move = parseChoiceText(text); }
      return decision(move, MOVES.map((m) => (m === move ? 1 : 0)), "one-hot",
                      { usage: { input_tokens: msg.usage?.input_tokens, output_tokens: msg.usage?.output_tokens }, model: msg.model });
    },
  };
}
