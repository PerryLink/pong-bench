// OpenAI-compatible chat completions: OpenAI, Azure OpenAI, Gemini's OpenAI endpoint, OpenRouter, Groq, Together,
// vLLM, SGLang, llama.cpp server, LM Studio, Ollama's /v1, and PongBench's own examples/python/hf_server.py.
//
//   baseUrl    up to /v1 (https://api.openai.com/v1, http://localhost:8000/v1, Azure: .../openai/v1 or
//              .../openai/deployments/<name>)
//   model      the model (Azure deployments: the deployment name)
//   answer     "auto" (default): logprobs, falling back to text by itself; "logprobs"; "json" (strict JSON schema with
//              an enum of the three moves); "text" (parse the reply)
//   auth       "bearer" (default), "api-key" (Azure's header), "none";  apiKeyEnv / apiKeyFile
//   query      extra URL parameters ({"api-version": "2024-10-21"} for Azure deployment URLs)
//   temperature (default 0; null leaves it out, for models that reject it), maxTokens, maxTokensField
//   extraBody  merged into every request (reasoning_effort, provider routing, seed, ...)
//
// Probabilities: with logprobs they are the model's own (the first answer token's top alternatives, matched to the
// three keys); otherwise one-hot on the parsed answer, marked as such in every result.
import { CHAT_SYSTEM, ConnectorError, decision, parseChoiceText, postJson, renderChat, withRetry } from "./common.js";
import { MOVES } from "../game/prompts.js";

const SCHEMA = { type: "object", properties: { move: { type: "string", enum: MOVES } }, required: ["move"], additionalProperties: false };

export function create(cfg, { key }) {
  if (!cfg.baseUrl) throw new ConnectorError('an openai connector needs "baseUrl" (for example https://api.openai.com/v1)');
  if (!cfg.model && !/deployments\//.test(cfg.baseUrl)) throw new ConnectorError('an openai connector needs "model"');
  const auth = cfg.auth || (key ? "bearer" : "none");
  if (auth !== "none" && !key) throw new ConnectorError(`no API key: set ${cfg.apiKeyEnv || "OPENAI_API_KEY"} (or "auth": "none")`);
  const headers = { ...(cfg.headers || {}) };
  if (auth === "bearer") headers.authorization = `Bearer ${key}`;
  else if (auth === "api-key") headers["api-key"] = key;
  const qs = cfg.query ? `?${new URLSearchParams(cfg.query)}` : "";
  const url = `${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions${qs}`;
  let mode = cfg.answer || "auto";

  function body(state, question) {
    const json = mode === "json";
    const b = {
      ...(cfg.model ? { model: cfg.model } : {}),
      messages: [{ role: "system", content: CHAT_SYSTEM }, { role: "user", content: renderChat(state, question, { json }) }],
      [cfg.maxTokensField || "max_tokens"]: cfg.maxTokens ?? (json ? 20 : 4),
      ...(cfg.temperature === null ? {} : { temperature: cfg.temperature ?? 0 }),
    };
    if (mode === "auto" || mode === "logprobs") Object.assign(b, { logprobs: true, top_logprobs: cfg.topLogprobs ?? 10 });
    if (json) b.response_format = { type: "json_schema", json_schema: { name: "decision", strict: true, schema: SCHEMA } };
    return { ...b, ...(cfg.extraBody || {}) };
  }

  async function call(state, question, signal) {
    try {
      return await withRetry(() => postJson(url, body(state, question), { headers, timeoutMs: cfg.timeoutMs ?? 120000, signal }),
                             { retries: cfg.retries ?? 4, signal });
    } catch (e) {
      // a server that refuses logprobs (reasoning models, some hosts): drop to text for good, once
      if (mode === "auto" && e.status === 400 && /logprob/i.test(e.detail)) { mode = "text"; return call(state, question, signal); }
      throw e;
    }
  }

  return {
    kind: "openai", url,
    get mode() { return mode; },
    async decide({ state, questions }, { signal } = {}) {
      const q = questions.move ?? Object.values(questions)[0];
      const { body: out } = await call(state, q, signal);
      const msg = out?.choices?.[0];
      if (!msg) throw new ConnectorError("no choices in the answer", { detail: JSON.stringify(out).slice(0, 300) });
      const text = msg.message?.content ?? msg.text ?? "";
      const usage = out.usage ? { input_tokens: out.usage.prompt_tokens, output_tokens: out.usage.completion_tokens } : undefined;
      if (mode === "json") {
        let move = null;
        try { move = JSON.parse(text).move; } catch { move = parseChoiceText(text); }
        return decision(move, MOVES.map((m) => (m === move ? 1 : 0)), "one-hot", { usage, model: out.model });
      }
      const fromLogprobs = probsFromLogprobs(msg.logprobs?.content);
      if (fromLogprobs) {
        const choice = parseChoiceText(text) ?? MOVES[fromLogprobs.indexOf(Math.max(...fromLogprobs))];
        return decision(choice, fromLogprobs, "logprobs", { usage, model: out.model });
      }
      if (mode === "auto" && !msg.logprobs) mode = "text";      // the server ignores logprobs: stop asking
      const choice = parseChoiceText(text);
      return decision(choice, MOVES.map((m) => (m === choice ? 1 : 0)), "one-hot", { usage, model: out.model });
    },
  };
}

/** [up, down, stay] from the first answer token's top logprobs (skipping leading quotes and spaces); null if none fit. */
export function probsFromLogprobs(content) {
  if (!Array.isArray(content)) return null;
  const tok = content.find((c) => /[a-z]/i.test(c.token || ""));
  if (!tok?.top_logprobs?.length) return null;
  const mass = [0, 0, 0];
  for (const alt of tok.top_logprobs) {
    const t = String(alt.token || "").toLowerCase().replace(/[^a-z]/g, "");
    if (t.length < 2) continue;
    const hits = MOVES.map((m, i) => (m === t || m.startsWith(t) ? i : -1)).filter((i) => i >= 0);
    if (hits.length === 1) mass[hits[0]] += Math.exp(alt.logprob);
  }
  const sum = mass[0] + mass[1] + mass[2];
  return sum > 0 ? mass.map((v) => v / sum) : null;
}
