// The render thread's bill, measured on the live app (npm run probe:render).
//
// Crackle on a phone is the audio render thread missing its deadline: every
// 2.67 ms quantum has to be computed in less than 2.67 ms, on a core that is
// several times slower than a desktop's. Offline renders price the DSP, but
// only the live context shows what the app actually asks of that thread, so
// this plays the built app in headless Chrome, traces the render callbacks
// (RealtimeAudioDestinationHandler::Render), and reports render time per wall
// second: the cold open, then a series of dice rolls. Math.random is seeded
// and reseeded before every roll, so every build is measured on the same
// songs and two builds compare like for like.
//
// Read ms/s as a share of one core (100 ms/s = 10%) on whatever machine runs
// it; a phone's audio core is roughly 3-4x slower than a desktop's. maxQ is
// the slowest single quantum in the window: past 2.67 ms, that quantum was
// late even here. It prints evidence and asserts nothing.
//
// Usage: npm run probe:render [-- --rolls 6] [-- --listen 5000] [-- --seed 7]

import { readFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { startPreview, wait } from "./preview.mjs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
};
const chrome = process.env.CHROME_BIN || "/usr/bin/google-chrome";
const host = process.env.PROBE_HOST || "127.0.0.1";
const port = Number(process.env.PROBE_PORT || 4299);
const url = `http://${host}:${port}/noodles/`;
const SEED = arg("seed", 7);
const ROLLS = arg("rolls", 4);
const LISTEN = arg("listen", 5000);

const SEEDED = (seed) => {
  let a = seed >>> 0;
  window.__reseed = (s) => {
    a = s >>> 0;
  };
  Math.random = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const preview = startPreview({ host, port });
const dir = mkdtempSync(join(tmpdir(), "noodles-render-"));
let browser;
let failed = false;
try {
  await preview.ready();
  browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ["--no-sandbox", "--mute-audio", "--autoplay-policy=no-user-gesture-required"],
    protocolTimeout: 600000,
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 400, height: 860, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.evaluateOnNewDocument(SEEDED, SEED);
  await page.goto(url, { waitUntil: "networkidle2" });
  await page.waitForFunction(() => !!window.__noodles);
  await wait(800);
  await page.evaluate(() => document.querySelector(".tbtn.play")?.click());
  await wait(3000);
  if (!(await page.evaluate(() => window.__noodles.audio.playing))) throw new Error("transport never started");

  const measure = async (label) => {
    const file = join(dir, `${label}.json`);
    await page.tracing.start({ path: file, categories: ["webaudio", "audio"] });
    const t0 = Date.now();
    await wait(LISTEN);
    await page.tracing.stop();
    const wall = (Date.now() - t0) / 1000;
    const trace = JSON.parse(readFileSync(file, "utf8"));
    let dur = 0;
    let max = 0;
    let n = 0;
    for (const e of trace.traceEvents || trace) {
      if (e.ph !== "X" || e.name !== "RealtimeAudioDestinationHandler::Render") continue;
      n += 1;
      dur += e.dur || 0;
      max = Math.max(max, e.dur || 0);
    }
    const info = await page.evaluate(() => {
      const { audio, song } = window.__noodles;
      const colors = ["harmony", "bass", "melody", "drums"].map((t) => audio.patch(t).color).filter((c) => c !== "none");
      return `${song.vibe?.groove}/${song.vibe?.comp} @${song.tempo} ${song.scale}, colors: ${colors.join("+") || "none"}, voices ${audio.voiceStats().voices}`;
    });
    if (!n) throw new Error("no render events traced — is the context running?");
    console.log(`  ${label.padEnd(7)} ${(dur / 1000 / wall).toFixed(1).padStart(6)} ms/s   maxQ ${(max / 1000).toFixed(2)} ms   ${info}`);
    return dur / 1000 / wall;
  };

  console.log(`\n-- render thread, ${LISTEN} ms per window, seed ${SEED} --`);
  const rows = [await measure("cold")];
  for (let r = 1; r <= ROLLS; r++) {
    await page.evaluate((s) => {
      window.__reseed(s);
      document.getElementById("dice-btn").click();
    }, SEED * 1000 + r);
    await wait(3000);
    rows.push(await measure(`roll ${r}`));
  }
  const mean = rows.reduce((a, b) => a + b, 0) / rows.length;
  console.log(`  mean ${mean.toFixed(1)} ms/s over ${rows.length} windows`);
  if (errors.length) {
    failed = true;
    console.log(`  [FAIL] page errors:\n    ${errors.join("\n    ")}`);
  }
} catch (err) {
  failed = true;
  console.error(err);
} finally {
  if (browser) await browser.close();
  await preview.stop();
  rmSync(dir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
