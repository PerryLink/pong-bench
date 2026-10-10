// A System One server in Node with no model behind it: answers with one of PongBench's built-in players. Use it to
// try a System One client (or PongBench's systemone connector) end to end before your real model is up.
//
//   node examples/mock-systemone-server.mjs [--port 8000] [--policy hesitant] [--latency 20]
//   node bin/pongbench.js check --config systemone-local
import { createServer } from "node:http";
import { create } from "../src/connectors/mock.js";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const port = Number(arg("port", 8000)), policy = arg("policy", "hesitant"), latency = Number(arg("latency", 0));
const player = create({ policy, latencyMs: latency, seed: 7 });

createServer((req, res) => {
  const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
  if (req.method !== "POST" || !req.url.replace(/\/+$/, "").endsWith("/v1/systemone")) return send(404, { error: "POST /v1/systemone" });
  let raw = "";
  req.on("data", (c) => { raw += c; if (raw.length > 1 << 20) req.destroy(); });
  req.on("end", async () => {
    let body;
    try { body = JSON.parse(raw); } catch { return send(422, { detail: [{ msg: "not JSON" }] }); }
    if (!body.questions || typeof body.questions !== "object") return send(422, { detail: [{ loc: ["body", "questions"], msg: "required" }] });
    const t0 = performance.now(), answers = {};
    for (const [name, q] of Object.entries(body.questions)) {
      const d = await player.decide({ state: body.state, questions: { [name]: q } });
      const keys = Object.keys(q.criteria || {});
      answers[name] = { type: "choice", choice: d.choice, confidence: Math.max(...d.probs),
                        probabilities: Object.fromEntries(keys.map((k, i) => [k, d.probs[["up", "down", "stay"].indexOf(k)] ?? 0])) };
    }
    send(200, { model: `mock-${policy}`, answers, usage: { input_tokens: 0, output_tokens: 0 }, server_ms: performance.now() - t0 });
  });
}).listen(port, "127.0.0.1", () => console.log(`mock System One (${policy}) on http://127.0.0.1:${port}/v1/systemone`));
