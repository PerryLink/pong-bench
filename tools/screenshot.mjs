// Screenshots of the app for the docs, with a headless Chrome over the DevTools protocol (Node 22+, for its WebSocket).
//
//   node tools/screenshot.mjs <url> <out.png> [--size 1500x940] [--wait 3000] [--js "<expression>"] [--after 1000]
//
// --js may be given several times; each expression runs in the page (awaited) before the shot.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const argv = process.argv.slice(2);
const [url, out] = argv;
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i > 0 ? argv[i + 1] : d; };
const scripts = argv.flatMap((a, i) => (a === "--js" ? [argv[i + 1]] : []));
const [w, h] = opt("size", "1500x940").split("x");
const CHROME = [process.env.CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium", "/usr/bin/microsoft-edge"].find((p) => p && existsSync(p));
if (!url || !out || !CHROME) { console.error("usage: node tools/screenshot.mjs <url> <out.png> (needs Chrome; set CHROME=...)"); process.exit(2); }
if (typeof WebSocket !== "function") { console.error("needs Node 22+ (global WebSocket)"); process.exit(2); }

const port = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "pb-shot-"))}`,
  "--no-first-run", `--window-size=${w},${h}`, "--force-device-scale-factor=1", "--hide-scrollbars", url], { stdio: "ignore" });
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
try {
  let target;
  for (let i = 0; i < 100 && !target; i += 1) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch { await sleep(150); }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok) => { ws.onopen = ok; });
  let n = 0;
  const waiting = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); waiting.get(m.id)?.(m.result); waiting.delete(m.id); };
  const call = (method, params = {}) => new Promise((ok) => { n += 1; waiting.set(n, ok); ws.send(JSON.stringify({ id: n, method, params })); });
  await sleep(Number(opt("wait", 3000)));
  for (const js of scripts) {
    const r = await call("Runtime.evaluate", { expression: js, awaitPromise: true, returnByValue: true });
    if (r?.result?.value !== undefined) console.log("js:", JSON.stringify(r.result.value).slice(0, 300));
    await sleep(Number(opt("after", 1000)));
  }
  const shot = await call("Page.captureScreenshot", { format: "png" });
  writeFileSync(out, Buffer.from(shot.data, "base64"));
  console.log("saved", out);
  ws.close();
} finally {
  chrome.kill();
}
