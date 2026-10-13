// Phocinae: the open Phocinae-Largha decision model served by phocinae-server (github.com/Phocinae/phocinae-server).
// The same System One contract as ./systemone.js, with two shape differences, both translated here:
//   - request:  `questions` is a list of {id, type, options}; the criteria descriptions become the options
//   - response: `answers[id]` is the 0-based option index; per-option probabilities arrive in `option_scores[id]`
//
//   url        the endpoint (http://127.0.0.1:8155/v1/systemone), or baseUrl + /v1/systemone
//   model      sent as "model" (default Phocinae-Largha-150M-v1)
//   auth       "none" by default; "bearer" with apiKeyEnv / apiKeyFile when the server sets PHOC_BEARER_TOKEN
import { ConnectorError, decision, postJson, toProbs, withRetry } from "./common.js";

const DEFAULT_MODEL = "Phocinae-Largha-150M-v1";

export function create(cfg, { key } = {}) {
  const base = (cfg.url || cfg.baseUrl || "").replace(/\/+$/, "");
  if (!base) throw new ConnectorError('a phocinae connector needs "url" (or "baseUrl")');
  const url = cfg.url ? cfg.url : /\/v1\/systemone$/.test(base) ? base : `${base.replace(/\/v1$/, "")}/v1/systemone`;
  const auth = cfg.auth || (key ? "bearer" : "none");
  const headers = { ...(cfg.headers || {}) };
  if (auth === "bearer") {
    if (!key) throw new ConnectorError(`no API key: set ${cfg.apiKeyEnv || "PHOCINAE_API_KEY"} (or "auth": "none")`);
    headers.authorization = `Bearer ${key}`;
  }

  return {
    kind: "phocinae", url,
    async decide({ state, questions }, { signal } = {}) {
      const [qid, question] = Object.entries(questions)[0] ?? [];
      const criteria = question?.criteria ?? {};
      const keys = Object.keys(criteria);
      if (!qid || keys.length === 0) throw new ConnectorError("phocinae needs one choice question with criteria");
      const body = JSON.stringify({
        ...(cfg.extraBody || {}),
        model: cfg.model || DEFAULT_MODEL,
        // phocinae-server takes `state` as a string; other servers here accept the structured object as-is
        state: typeof state === "string" ? state : JSON.stringify(state),
        questions: [{
          id: qid,
          type: question.type || "choice",
          options: keys.map((k) => (typeof criteria[k] === "string" ? criteria[k] : JSON.stringify(criteria[k]))),
        }],
      });
      const { body: out, headers: h } = await withRetry(
        () => postJson(url, body, { headers, timeoutMs: cfg.timeoutMs ?? 60000, signal }),
        { retries: cfg.retries ?? 4, signal });
      if (!out?.answers) throw new ConnectorError('the answer has no "answers"', { detail: JSON.stringify(out).slice(0, 300) });
      const idx = out.answers[qid];
      if (!Number.isInteger(idx) || idx < 0 || idx >= keys.length) {
        throw new ConnectorError(`the answer for "${qid}" is ${JSON.stringify(idx)}, not an option index`,
                                 { detail: JSON.stringify(out).slice(0, 300) });
      }
      const choice = keys[idx];
      const scores = Array.isArray(out.option_scores?.[qid]) ? out.option_scores[qid] : [];
      const probabilities = Object.fromEntries(keys.map((k, i) => [k, Number(scores[i]) || 0]));
      const { probs, source } = toProbs(choice, probabilities);
      const serverMs = Number(out.server_ms ?? h.get("x-server-ms")) || undefined;
      return decision(choice, probs, source, { usage: out.usage, model: out.model, serverMs });
    },
  };
}
