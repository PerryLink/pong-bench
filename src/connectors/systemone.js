// System One: POST {state, questions[, model]} -> {answers: {move: {choice, probabilities, confidence}}, usage}.
// TypeSafe's wire format, also served by Databricks (ai-gateway), Cloudflare Workers AI (Clef), Ollama 0.35+, decisio's
// gateway and local servers for open-weight decision models. The request is passed through untouched.
//
//   url        the endpoint (https://api.typesafe.ai/v1/systemone), or baseUrl + /v1/systemone;
//              default SYSTEM_ONE_BASE_URL (Pydantic AI's convention)
//   model      sent as "model" when set (jev-latest, clef-flash, system.ai.openjev-qwen35-4b, ...)
//   auth       "bearer" (default with a key), "basic" (Databricks: token:<key>), "header" (authHeader: <key>), "none"
//   apiKeyEnv  the environment variable holding the key (default SYSTEM_ONE_API_KEY), or apiKeyFile
import { ConnectorError, decision, postJson, toProbs, withRetry, argmax } from "./common.js";

export function create(cfg, { key }) {
  const base = cfg.url || (cfg.baseUrl || process.env.SYSTEM_ONE_BASE_URL || "").replace(/\/+$/, "");
  if (!base) throw new ConnectorError('a systemone connector needs "url" (or "baseUrl", or SYSTEM_ONE_BASE_URL)');
  const url = cfg.url ? cfg.url : /\/v1\/systemone$/.test(base) ? base : `${base.replace(/\/v1$/, "")}/v1/systemone`;
  const auth = cfg.auth || (key ? "bearer" : "none");
  const headers = { ...(cfg.headers || {}) };
  if (auth !== "none" && !key) throw new ConnectorError(`no API key: set ${cfg.apiKeyEnv || "SYSTEM_ONE_API_KEY"} (or "auth": "none")`);
  if (auth === "bearer") headers.authorization = `Bearer ${key}`;
  else if (auth === "basic") headers.authorization = `Basic ${Buffer.from(`${cfg.basicUser || "token"}:${key}`).toString("base64")}`;
  else if (auth === "header") headers[cfg.authHeader || "x-api-key"] = key;

  return {
    kind: "systemone", url,
    async decide({ state, questions }, { signal } = {}) {
      const body = JSON.stringify({ ...(cfg.extraBody || {}), ...(cfg.model ? { model: cfg.model } : {}), state, questions });
      const { body: out, headers: h } = await withRetry(
        () => postJson(url, body, { headers, timeoutMs: cfg.timeoutMs ?? 60000, signal }),
        { retries: cfg.retries ?? 4, signal });
      const root = out?.answers ? out : out?.result?.answers ? out.result : null;   // Workers AI wraps it in {result}
      if (!root) throw new ConnectorError("the answer has no \"answers\"", { detail: JSON.stringify(out).slice(0, 300) });
      const a = root.answers.move ?? Object.values(root.answers)[0];
      if (!a) throw new ConnectorError("the answer has no move");
      const { probs, source } = toProbs(a.choice, a.probabilities);
      const serverMs = Number(out.server_ms ?? h.get("x-server-ms") ?? h.get("x-gateway-upstream-ms")) || undefined;
      return decision(a.choice ?? argmax(probs), probs, source, { usage: root.usage, model: root.model, serverMs });
    },
  };
}
