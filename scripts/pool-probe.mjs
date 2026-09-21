// Voice-pool receipt for the dice (npm run probe:pool).
//
// The claim this exists to back, from src/audio.js trimVoices and ROADMAP's
// performance section: a layer pool's high-water mark is per SESSION while any
// one song's working set is per SONG, so without a boundary trim every reroll
// inherits the peak of every song before it — and every pooled voice is an
// oscillator plus forever-running param ConstantSources that the phone's audio
// thread pays for per sample.
//
// Two views, because one alone misleads:
//
//   default    — the burst. Play, reroll on a cadence, settle, and report the
//                live audio-source count. This is the user-facing symptom
//                ("fine on first load, worse after a few rolls").
//   --occupancy— the pools themselves, via audio.voiceStats(): how many voices
//                exist, how many are claimed, how many sit idle. `idle` is the
//                only part a trim can reclaim, so it is what says whether a
//                remainder is working set or residue.
//
// Songs differ enormously in density, so a single run's GROWTH figure swings
// ±50. Run --runs 3 and read the settled ABSOLUTE count, which is stable; an
// earlier one-run-each comparison read this as +324 -> +149 and was luck
// dressed as precision. Nothing here asserts or exits nonzero on a number —
// the thresholds that must hold live in npm run smoke. This prints evidence.

import puppeteer from "puppeteer-core";
import { startPreview, wait } from "./preview.mjs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

const chrome = process.env.CHROME_BIN || "/usr/bin/google-chrome";
const host = process.env.PROBE_HOST || "127.0.0.1";
const port = Number(process.env.PROBE_PORT || 4298);
const url = `http://${host}:${port}/noodles/`;
const ROLLS = Number(arg("rolls", 12));
const CADENCE = Number(arg("cadence", 2500)); // a person hunting for a song
const RUNS = Number(arg("runs", 1));
const SETTLE = Number(arg("settle", 12000)); // past every scheduled boundary trim

// Count audio sources that were started and never ended. A pooled Tone voice
// keeps its oscillator running whether or not its envelope is open, so this is
// the per-sample bill, not the note count.
const INSTRUMENT = () => {
  const state = (window.__poolProbe = { live: 0, started: 0 });
  const proto = AudioScheduledSourceNode.prototype;
  const start = proto.start;
  proto.start = function (...args) {
    if (!this.__probed) {
      this.__probed = true;
      state.live += 1;
      state.started += 1;
      this.addEventListener("ended", () => {
        if (this.__probed) {
          this.__probed = false;
          state.live -= 1;
        }
      }, { once: true });
    }
    return start.apply(this, args);
  };
};

const read = () => ({
  ...window.__noodles.audio.voiceStats(),
  live: window.__poolProbe.live,
  heapMB: +((performance.memory?.usedJSHeapSize || 0) / 1048576).toFixed(1),
});

async function openPlaying() {
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    // Autoplay must be allowed: this probe needs the transport actually
    // running, unlike the offline-render harnesses (calibrate, audit).
    args: [
      "--no-sandbox",
      "--mute-audio",
      "--autoplay-policy=no-user-gesture-required",
      "--enable-precise-memory-info",
      "--disable-dev-shm-usage",
      "--js-flags=--expose-gc",
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 420, height: 900 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.evaluateOnNewDocument(INSTRUMENT);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector("#dice-btn", { timeout: 20000 });
  await wait(600);
  await page.evaluate(() => document.querySelector(".tbtn.play")?.click());
  await wait(5000);
  if (!(await page.evaluate(() => window.__noodles.audio.playing))) {
    throw new Error("transport never started — the probe measures a playing graph or nothing");
  }
  return { browser, page, errors };
}

const roll = (page) => page.evaluate(() => document.getElementById("dice-btn").click());
const gc = (page) => page.evaluate(() => window.gc?.()).catch(() => {});

const row = (label, s) =>
  console.log(
    `  ${label.padEnd(20)} voices ${String(s.voices).padStart(3)}  active ${String(s.active).padStart(3)}` +
    `  idle ${String(s.idle).padStart(3)}  of cap ${s.caps}   liveSrc ${String(s.live).padStart(4)}  heap ${s.heapMB}MB`
  );

async function occupancy(page) {
  console.log(`\n-- pool occupancy, rolling every ${CADENCE}ms --`);
  row("baseline", await page.evaluate(read));
  for (let i = 1; i <= ROLLS; i++) {
    await roll(page);
    await wait(CADENCE);
    if (i % 4 === 0) row(`after ${i} rolls`, await page.evaluate(read));
  }
  await wait(SETTLE);
  await gc(page);
  row("settled", await page.evaluate(read));
  // What a trim can still take. Read IMMEDIATELY: a voice released during any
  // wait afterwards lands back in the idle pool, which makes a trim that
  // worked perfectly look like one that did nothing. The second row is that
  // refill, and the gap between them is how fast the song reclaims its own.
  const preTrim = await page.evaluate(read);
  const postTrim = await page.evaluate(() => {
    window.__noodles.audio.trimVoices({ atBoundary: true });
    return { ...window.__noodles.audio.voiceStats(), live: window.__poolProbe.live,
             heapMB: +((performance.memory?.usedJSHeapSize || 0) / 1048576).toFixed(1) };
  });
  row("+ forced trim (now)", postTrim);
  console.log(`  -> the trim disposed ${preTrim.voices - postTrim.voices} voices (idle ${preTrim.idle} -> ${postTrim.idle})`);
  await wait(2500);
  row("  then refilled to", await page.evaluate(read));
}

async function burst(page) {
  await gc(page);
  const base = await page.evaluate(read);
  row("baseline", base);
  for (let i = 1; i <= ROLLS; i++) {
    await roll(page);
    await wait(CADENCE);
  }
  await wait(SETTLE);
  await gc(page);
  const after = await page.evaluate(read);
  row(`after ${ROLLS} rolls`, after);
  console.log(`  -> settled at ${after.live} live sources, growth +${after.live - base.live} over baseline`);
  return { base: base.live, after: after.live };
}

const preview = startPreview({ host, port });
let failed = false;
try {
  await preview.ready();
  const results = [];
  for (let run = 1; run <= RUNS; run++) {
    const { browser, page, errors } = await openPlaying();
    try {
      if (flag("occupancy")) {
        await occupancy(page);
      } else {
        console.log(`\n-- run ${run}/${RUNS}: ${ROLLS} rolls every ${CADENCE}ms, then settle --`);
        results.push(await burst(page));
      }
      if (errors.length) {
        failed = true;
        console.log(`  [FAIL] page errors:\n    ${errors.join("\n    ")}`);
      }
    } finally {
      await browser.close();
    }
  }
  if (results.length > 1) {
    const settled = results.map((r) => r.after);
    const growth = results.map((r) => r.after - r.base);
    const mean = (xs) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
    console.log(`\n-- ${results.length} runs --`);
    console.log(`  settled live sources: ${settled.join(", ")}  (mean ${mean(settled)})`);
    console.log(`  growth over baseline: ${growth.map((g) => `+${g}`).join(", ")}  (mean +${mean(growth)})`);
    console.log("  read the settled figures; growth carries the song-density noise.");
  }
} catch (err) {
  failed = true;
  console.error(err);
} finally {
  await preview.stop();
}
process.exit(failed ? 1 : 0);
