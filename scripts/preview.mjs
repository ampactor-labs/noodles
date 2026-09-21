// Shared boot for the headless harnesses (smoke, calibrate, audit): build a
// production preview server and drive it with a real Chrome. Every harness
// judges the app the way DECISIONS says to — on the production build, never on
// the dev server.

import { spawn } from "node:child_process";
import puppeteer from "puppeteer-core";

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// `npm run preview` is a shell that spawns vite as a GRANDCHILD, and that one
// fact broke every harness's exit. Killing the npm process left vite running:
// it held the port, and — because it inherited npm's stdout/stderr pipes — it
// held the read ends of those pipes open on our side too, so Node's event loop
// never drained and the harness hung after its last assertion. `npm run smoke`
// exited 124 under a timeout wrapper every single run, and a session of runs
// left dozens of orphaned servers behind.
//
// So the child is spawned `detached`, which makes it a process-group leader,
// and stop() signals the whole group (note the negative pid) rather than just
// the shell. The streams are then destroyed explicitly, because a pipe whose
// writer is gone still counts as a live handle until it is.
export function startPreview({ host, port, cwd = process.cwd() } = {}) {
  const child = spawn("npm", ["run", "preview", "--", "--host", host, "--port", String(port), "--strictPort"], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let output = "";
  const append = (chunk) => (output += chunk.toString());
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const alive = () => child.exitCode === null && child.signalCode === null;
  const killGroup = (signal) => {
    try {
      process.kill(-child.pid, signal); // the group: npm AND the vite it spawned
    } catch {
      try { child.kill(signal); } catch { /* already gone */ }
    }
  };
  return {
    child,
    async ready() {
      const started = Date.now();
      while (Date.now() - started < 8000) {
        if (!alive()) throw new Error(`preview exited early\n${output}`);
        if (output.includes("Local:")) return;
        await wait(100);
      }
      throw new Error(`preview did not become ready\n${output}`);
    },
    async stop() {
      if (alive()) {
        killGroup("SIGTERM");
        await Promise.race([exited, wait(1500)]);
        if (alive()) {
          killGroup("SIGKILL");
          await Promise.race([exited, wait(500)]);
        }
      }
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.unref();
    },
  };
}

// A page on the built app, with pageerror collection wired up. The caller gets
// the errors array so it can fail loudly instead of measuring a broken page.
export async function openApp({ chrome, url, protocolTimeout = 3_600_000 }) {
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ["--no-sandbox", "--mute-audio"],
    protocolTimeout,
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url, { waitUntil: "networkidle2" });
  await page.waitForFunction(() => !!window.__noodles);
  return { browser, page, errors };
}
