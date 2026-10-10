// Open a page in the default browser on Windows, macOS or Linux (serve --open).
import { spawn } from "node:child_process";

/** [command, args] that opens url on this platform. */
export function openCommand(url, platform = process.platform) {
  if (platform === "darwin") return ["open", [url]];
  if (platform === "win32") return ["cmd", ["/c", "start", '""', url]];
  return ["xdg-open", [url]];                                   // Linux, the BSDs
}

/** Try to open url; if there is no browser (a server, SSH, WSL without one), just say where the app is. */
export function openBrowser(url) {
  const [cmd, args] = openCommand(url);
  const hint = () => console.log(`Open ${url} in your browser.`);
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true, windowsVerbatimArguments: cmd === "cmd" });
    child.on("error", hint);
    child.unref();
  } catch {
    hint();
  }
}
