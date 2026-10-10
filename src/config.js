// Endpoint configs: one small JSON file per model in configs/ (or anywhere). Keys never live in them: a config names
// the environment variable (apiKeyEnv) or a file (apiKeyFile) that holds the key, and a .env file in the repository
// root is read at start (it is git-ignored).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const CONFIG_DIR = join(ROOT, "configs");
export const CONNECTORS = ["systemone", "openai", "anthropic", "mock", "module"];
const DEFAULT_KEY_ENV = { systemone: "SYSTEM_ONE_API_KEY", openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY" };

/** KEY=value lines from .env into process.env (existing variables win). */
export function loadEnv(file = join(ROOT, ".env")) {
  if (!existsSync(file)) return 0;
  let n = 0;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    const v = m[2].replace(/^(['"])(.*)\1$/, "$2");
    if (!(m[1] in process.env)) { process.env[m[1]] = v; n += 1; }
  }
  return n;
}

/** A config by path or by name (configs/<name>.json). */
export function loadConfig(ref) {
  const candidates = [ref, `${ref}.json`, join(CONFIG_DIR, ref), join(CONFIG_DIR, `${ref}.json`)].map((p) => resolve(p));
  const file = candidates.find((p) => existsSync(p) && p.endsWith(".json"));
  if (!file) throw new Error(`no config "${ref}" (looked for ${candidates.slice(0, 4).join(", ")})`);
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`${file} is not valid JSON: ${e.message}`);
  }
  return checkConfig(cfg, file);
}

export function checkConfig(cfg, file = "") {
  if (!cfg || typeof cfg !== "object") throw new Error("a config is a JSON object");
  if (!CONNECTORS.includes(cfg.connector)) throw new Error(`"connector" must be one of ${CONNECTORS.join(", ")} (${file || "config"})`);
  if ("apiKey" in cfg) throw new Error('put keys in an environment variable ("apiKeyEnv") or a file ("apiKeyFile"), never in the config');
  const id = file ? basename(file, ".json") : cfg.id || cfg.connector;
  return { ...cfg, id, name: cfg.name || id, file, baseDir: file ? dirname(file) : process.cwd() };
}

/** The key for a config, or undefined. */
export function resolveKey(cfg) {
  if (cfg.apiKeyFile) {
    const f = resolve(cfg.baseDir || ROOT, cfg.apiKeyFile);
    if (!existsSync(f)) throw new Error(`apiKeyFile ${f} does not exist`);
    return readFileSync(f, "utf8").trim();
  }
  const env = cfg.apiKeyEnv || DEFAULT_KEY_ENV[cfg.connector];
  return env ? process.env[env] || undefined : undefined;
}

/** A config with nothing secret in it, for pages, logs and result files. */
export function publicConfig(cfg) {
  const out = {};
  for (const [k, v] of Object.entries(cfg)) {
    if (["baseDir", "apiKeyFile"].includes(k)) continue;
    if (k === "headers") out.headers = Object.fromEntries(Object.keys(v || {}).map((h) => [h, "(set)"]));
    else if (k === "file") out.file = v ? basename(v) : "";
    else out[k] = v;
  }
  let keyState = "not needed";
  try {
    const needs = cfg.connector !== "mock" && cfg.connector !== "module" && cfg.auth !== "none";
    if (needs) keyState = resolveKey(cfg) ? "found" : cfg.connector === "anthropic" ? "left to the SDK" : "missing";
  } catch {
    keyState = "missing";
  }
  return { ...out, key: keyState };
}

/** Every config in configs/ (for the app's endpoint picker). */
export function listConfigs(dir = CONFIG_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => {
    try {
      return publicConfig(loadConfig(join(dir, f)));
    } catch (e) {
      return { id: basename(f, ".json"), file: f, error: e.message };
    }
  });
}
