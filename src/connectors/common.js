// What every connector shares: errors that know whether a retry can help, retries with backoff (honouring
// Retry-After), timeouts, turning an answer into probabilities over [up, down, stay], and the chat prompt used for
// models that do not speak System One.
import { MOVES } from "../game/prompts.js";

export class ConnectorError extends Error {
  constructor(message, { status = 0, retryable = false, detail = "" } = {}) {
    super(message);
    this.name = "ConnectorError";
    this.status = status;
    this.retryable = retryable;
    this.detail = detail;
  }
}

const RETRYABLE = new Set([408, 409, 425, 429, 500, 502, 503, 504, 520, 522, 524, 529]);
export const isRetryableStatus = (s) => RETRYABLE.has(s);
const sleep = (ms, signal) => new Promise((ok, no) => {
  if (signal?.aborted) return no(new DOMException("stopped", "AbortError"));
  const id = setTimeout(ok, ms);
  signal?.addEventListener("abort", () => { clearTimeout(id); no(new DOMException("stopped", "AbortError")); }, { once: true });
});

/** Run fn with retries on retryable errors: 0.5 s, 1 s, 2 s, 4 s ... (plus jitter), or the server's Retry-After. */
export async function withRetry(fn, { retries = 4, signal, onRetry } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (e) {
      if (e.name === "AbortError" || !e.retryable || attempt >= retries) throw e;
      const wait = e.retryAfterMs ?? Math.min(30000, 500 * 2 ** attempt) * (0.8 + 0.4 * Math.random());
      onRetry?.(e, attempt + 1, wait);
      await sleep(wait, signal);
    }
  }
}

/** POST JSON with a timeout; non-2xx becomes a ConnectorError carrying the status and a short body excerpt. */
export async function postJson(url, body, { headers = {}, timeoutMs = 60000, signal } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new DOMException("timed out", "TimeoutError")), timeoutMs);
  const onAbort = () => ctl.abort(signal.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  let r;
  try {
    r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers },
                           body: typeof body === "string" ? body : JSON.stringify(body), signal: ctl.signal });
  } catch (e) {
    if (signal?.aborted) throw new DOMException("stopped", "AbortError");
    const timedOut = ctl.signal.reason?.name === "TimeoutError";
    throw new ConnectorError(timedOut ? `no answer within ${timeoutMs} ms` : `could not reach ${hostOf(url)}: ${e.cause?.code || e.message}`,
                             { retryable: true });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
  const text = await r.text();
  if (!r.ok) {
    const err = new ConnectorError(`${hostOf(url)} answered ${r.status}`, { status: r.status, retryable: isRetryableStatus(r.status),
                                                                            detail: text.slice(0, 500) });
    const ra = Number(r.headers.get("retry-after"));
    if (Number.isFinite(ra) && ra > 0) err.retryAfterMs = Math.min(60000, ra * 1000);
    throw err;
  }
  try {
    return { body: JSON.parse(text), headers: r.headers };
  } catch {
    throw new ConnectorError(`${hostOf(url)} did not answer with JSON`, { detail: text.slice(0, 300) });
  }
}

export const hostOf = (url) => { try { return new URL(url).host; } catch { return String(url); } };

/** Probabilities [up, down, stay] from a {name: p} map (normalised), or one-hot on the choice when there is none. */
export function toProbs(choice, probabilities) {
  if (probabilities && typeof probabilities === "object") {
    const p = MOVES.map((m) => Math.max(0, Number(probabilities[m]) || 0));
    const sum = p.reduce((a, b) => a + b, 0);
    if (sum > 0) return { probs: p.map((v) => v / sum), source: "model" };
  }
  return { probs: MOVES.map((m) => (m === choice ? 1 : 0)), source: "one-hot" };
}

/** The decision a connector returns, checked. */
export function decision(choice, probs, source, extra = {}) {
  if (!MOVES.includes(choice)) throw new ConnectorError(`the model answered "${String(choice).slice(0, 40)}", not up, down or stay`);
  return { choice, probs, probSource: source, ...extra };
}

/** The pick from probabilities when a model returns them without a choice. */
export const argmax = (probs) => MOVES[probs.indexOf(Math.max(...probs))];

// ------------------------------------------------------------------ the chat prompt (models without System One)
export const CHAT_SYSTEM = "You make one decision about the state given. Answer with the key of exactly one option, and nothing else.";

/** One user message in decisio's gateway layout: the state, the question, its options, then the answer format. */
export function renderChat(state, question, { json = false } = {}) {
  const options = Object.entries(question.criteria).map(([k, v]) => `- ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join("\n");
  const keys = Object.keys(question.criteria).join(", ");
  return [
    "State:", typeof state === "string" ? state : JSON.stringify(state), "",
    `Question: ${typeof question.instructions === "string" ? question.instructions : JSON.stringify(question.instructions)}`,
    "Options:", options, "",
    json ? `Answer as JSON: {"move": one of ${keys}}.` : `Answer with one of: ${keys}.`,
  ].join("\n");
}

/** The first option key that appears as a whole word in a model's text answer. */
export function parseChoiceText(text, keys = MOVES) {
  const t = String(text || "").toLowerCase();
  let best = null, at = Infinity;
  for (const k of keys) {
    const m = new RegExp(`(^|[^a-z])${k}([^a-z]|$)`).exec(t);
    if (m && m.index < at) { best = k; at = m.index; }
  }
  return best;
}
