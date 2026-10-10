// Your own code as the player: a JavaScript module that exports create(options) returning { decide(request) }.
//
//   path     the module (relative to the config file or the working directory), e.g. ./examples/custom-connector.mjs
//   options  passed to create()
//
// decide({state, questions}) must return {choice} or {choice, probabilities: {up, down, stay}}; see SPEC.md.
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { ConnectorError, decision, toProbs, argmax } from "./common.js";

export async function create(cfg, { baseDir }) {
  if (!cfg.path) throw new ConnectorError('a module connector needs "path"');
  const file = resolve(baseDir || process.cwd(), cfg.path);
  let mod;
  try {
    mod = await import(pathToFileURL(file).href);
  } catch (e) {
    throw new ConnectorError(`could not load ${file}: ${e.message}`);
  }
  const make = mod.create || mod.default;
  if (typeof make !== "function") throw new ConnectorError(`${file} must export create(options)`);
  const impl = await make(cfg.options || {});
  if (typeof impl?.decide !== "function") throw new ConnectorError(`create() in ${file} must return an object with decide()`);
  return {
    kind: "module", url: `module:${cfg.path}`,
    async decide(request, ctx) {
      const out = await impl.decide(request, ctx);
      const ans = out?.answers?.move ?? out;
      const { probs, source } = toProbs(ans?.choice, ans?.probabilities);
      return decision(ans?.choice ?? argmax(probs), probs, source, { usage: out?.usage });
    },
    close: impl.close?.bind(impl),
  };
}
