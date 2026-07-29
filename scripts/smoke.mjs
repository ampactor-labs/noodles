import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import puppeteer from "puppeteer-core";

const cwd = process.cwd();
const chrome = process.env.CHROME_BIN || "/usr/bin/google-chrome";
const host = process.env.SMOKE_HOST || "127.0.0.1";
const port = Number(process.env.SMOKE_PORT || 4173);
const url = process.env.SMOKE_URL || `http://${host}:${port}/noodles/`;
const exportTimeout = Number(process.env.SMOKE_EXPORT_TIMEOUT || 60000);
const outDir = path.join(cwd, ".tmp");
const shotPath = path.join(outDir, "smoke.png");
const propsShotPath = path.join(outDir, "smoke-clip-props.png");
const mixerShotPath = path.join(outDir, "smoke-mixer.png");
const exportShotPath = path.join(outDir, "smoke-export.png");
const circleShotPath = path.join(outDir, "smoke-circle.png");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startPreview() {
  const child = spawn("npm", ["run", "preview", "--", "--host", host, "--port", String(port), "--strictPort"], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const append = (chunk) => {
    output += chunk.toString();
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  return {
    child,
    async ready() {
      const started = Date.now();
      while (Date.now() - started < 8000) {
        if (child.exitCode !== null) throw new Error(`preview exited early\n${output}`);
        if (output.includes("Local:") || output.includes(url)) return;
        await wait(100);
      }
      throw new Error(`preview did not become ready\n${output}`);
    },
    async stop() {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      await wait(200);
      if (child.exitCode === null) child.kill("SIGKILL");
    },
  };
}

async function longPress(page, selector, ms = 650) {
  const handle = await page.waitForSelector(selector, { visible: true });
  const box = await handle.boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await wait(ms);
  await page.mouse.up();
}

async function tap(page, selector) {
  const handle = await page.waitForSelector(selector, { visible: true });
  await handle.click();
}

async function closeSheet(page) {
  await page.waitForSelector(".sheet-bar .close", { visible: true });
  const closed = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll(".sheet-bar .close")];
    buttons.at(-1)?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    return buttons.length > 0;
  });
  if (!closed) throw new Error("no sheet close button");
}

async function clickAction(page, action) {
  const selector = `[data-action="${action}"]`;
  await page.waitForSelector(selector, { visible: true });
  const clicked = await page.evaluate((selector) => {
    const node = document.querySelector(selector);
    node?.click();
    return !!node;
  }, selector);
  if (!clicked) throw new Error(`missing action ${action}`);
}

// Dispatch pointer events straight at the cell: coordinate taps race the
// editor's auto-scroll-to-notes and miss ~1 run in 3.
async function tapPianoCell(page, row, step) {
  const ok = await page.evaluate(({ row, step }) => {
    const cell = document.querySelectorAll(".prow")[row]?.querySelectorAll(".pcell")[step];
    if (!cell) return false;
    const opts = { bubbles: true, cancelable: true, pointerId: 1, pointerType: "touch" };
    cell.dispatchEvent(new PointerEvent("pointerdown", opts));
    cell.dispatchEvent(new PointerEvent("pointerup", opts));
    return true;
  }, { row, step });
  if (!ok) throw new Error(`missing piano cell row ${row} step ${step}`);
  await wait(150);
}

async function tapAt(page, x, y) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
}

function assertState(ok, msg) {
  if (!ok) throw new Error(msg);
}

await mkdir(outDir, { recursive: true });
const preview = process.env.SMOKE_URL ? null : startPreview();
let browser;

try {
  if (preview) await preview.ready();
  browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--mute-audio",
      // Fake mic so the beatbox-capture path runs headless.
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 800, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console:${msg.text()}`);
  });

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForSelector("#transport", { visible: true });
  await wait(500);

  // The PWA must actually register: without a live service worker there is no
  // install prompt and no offline. (Full offline proof: .tmp/dbg-pwa.mjs.)
  const sw = await page.evaluate(async () => {
    if (!navigator.serviceWorker) return { ok: false, why: "no serviceWorker API" };
    const reg = await Promise.race([
      navigator.serviceWorker.ready.then(() => true),
      new Promise((r) => setTimeout(() => r(false), 10000)),
    ]);
    const manifest = document.querySelector('link[rel="manifest"]')?.href;
    return { ok: !!reg, manifest };
  });
  assertState(sw.ok, `service worker did not register: ${sw.why ?? "timed out"}`);
  assertState(!!sw.manifest, "no manifest link in the document");

  const initial = await page.evaluate(() => ({
    transport: !!document.querySelector("#transport"),
    clips: document.querySelectorAll(".clip.filled").length,
    drums: !!document.querySelector('.clip.filled[data-track="drums"]'),
    sceneTag: document.querySelector(".scenecell[data-scene='0']")?.textContent ?? "",
  }));
  assertState(initial.transport, "transport missing");
  assertState(initial.clips >= 4, `expected at least 4 filled clips, got ${initial.clips}`);
  assertState(initial.drums, "drum clip missing");
  assertState(initial.sceneTag.includes("✨"), `default scene was not magic-generated: ${initial.sceneTag}`);
  await tap(page, "#bpm");
  await page.waitForFunction(() => document.querySelector(".sheet-bar .title")?.textContent === "Tempo");
  await page.$eval(".tempo-input", (el) => { el.value = "104"; });
  await closeSheet(page);
  await page.waitForFunction(() => !document.querySelector("#sheet")?.classList.contains("open"));
  const typedTempo = await page.$eval("#bpm", (el) => el.textContent);
  assertState(typedTempo.includes("104"), `typed tempo did not apply: ${typedTempo}`);

  await tap(page, '.clip.filled[data-track="melody"]');
  await page.waitForFunction(() => document.querySelector(".sheet-bar .title")?.textContent === "Piano Roll");
  let stackedNotes = 0;
  for (const row of [2, 4, 6, 8, 10]) {
    await tapPianoCell(page, row, 1);
    stackedNotes = await page.evaluate(() =>
      [...document.querySelectorAll(".prow")].filter((row) => row.querySelectorAll(".pcell")[1]?.classList.contains("on")).length
    );
    if (stackedNotes >= 2) break;
  }
  assertState(stackedNotes >= 2, `expected layered notes in one step, got ${stackedNotes}`);
  // One gesture: press an empty cell and drag right — the note must grow under
  // the finger (regression: the drag mutated an orphaned clone, so a new
  // note's length always snapped back to 1 and only a second press worked).
  const dragLen = await page.evaluate(async () => {
    const tick = () => new Promise((r) => setTimeout(r, 60));
    const row = [...document.querySelectorAll(".prow")].find((r) =>
      [4, 5, 6, 7].every((s) => !r.querySelectorAll(".pcell")[s]?.classList.contains("on"))
    );
    const cells = row.querySelectorAll(".pcell");
    const at = (cell) => {
      const r = cell.getBoundingClientRect();
      return { bubbles: true, cancelable: true, pointerId: 3, pointerType: "touch", clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    };
    cells[4].dispatchEvent(new PointerEvent("pointerdown", at(cells[4])));
    await tick();
    cells[4].dispatchEvent(new PointerEvent("pointermove", at(cells[7])));
    await tick();
    cells[4].dispatchEvent(new PointerEvent("pointerup", at(cells[7])));
    await tick();
    return Math.max(...(window.__noodles.song.scenes[0].melody[4] || []).map((n) => n.len), 0);
  });
  assertState(dragLen === 4, `press-drag did not stretch the new note to 4 steps (got len ${dragLen})`);
  // The roll staff painted, and the motion-lane picker cycles + clears.
  const rollStaffOk = await page.evaluate(() => {
    const s = document.querySelector(".rollstaff");
    return !!s && s.width > 0;
  });
  assertState(rollStaffOk, "roll staff missing or unpainted");
  const laneOk = await page.evaluate(() => {
    window.__noodles.song.scenes[0].motion ||= {};
    // A patch lane and a send ride together: the picker lists both kinds.
    window.__noodles.song.scenes[0].motion.melody = { x: new Array(64).fill(0.3), verb: new Array(64).fill(0.5) };
    const vkey = document.querySelector(".vkey-pick");
    vkey.click();
    const picked = vkey.textContent;
    // Scoped to the picker's own strip: the D19 grid pager also wears
    // .lane-bar chips, and a four-bar melody (D21) shows four of those too.
    const chips = document.querySelectorAll(".lane-bars .lane-bar").length;
    vkey.click();
    const pickedRide = vkey.textContent;
    document.querySelector(".lane-clear").click();
    const rideCleared = !window.__noodles.song.scenes[0].motion.melody?.verb;
    vkey.click();
    document.querySelector(".lane-clear").click();
    const cleared = !window.__noodles.song.scenes[0].motion?.melody;
    return { picked, chips, pickedRide, rideCleared, cleared, back: vkey.textContent };
  });
  assertState(
    laneOk.picked === "x" && laneOk.chips === 4 && laneOk.pickedRide === "verb" && laneOk.rideCleared && laneOk.cleared && laneOk.back === "vel",
    `motion lane picker misbehaved: ${JSON.stringify(laneOk)}`
  );
  // Editor dice: rolled melody notes stay inside a 2-octave in-scale window
  // between octave 2 and octave 5 (the old roll scattered across ~8 octaves).
  await page.evaluate(() => [...document.querySelectorAll(".tfbtn")].find((b) => b.textContent === "🎲")?.click());
  const rolledMidis = await page.evaluate(() => window.__noodles.song.scenes[0].melody.flatMap((slot) => (slot || []).map((n) => n.midi)));
  assertState(rolledMidis.length > 0 && rolledMidis.every((m) => m >= 36 && m <= 83), `melody dice rolled out of range: ${JSON.stringify(rolledMidis)}`);
  await closeSheet(page);
  await page.waitForFunction(() => !document.querySelector("#sheet")?.classList.contains("open"));

  // The chord editor's voice-leading threads: the strip exists and painted.
  await tap(page, '.clip.filled[data-track="harmony"]');
  await page.waitForFunction(() => document.querySelector(".sheet-bar .title")?.textContent === "Chords");
  await page.waitForFunction(() => {
    const s = document.querySelector(".staffview");
    const w = document.querySelector("#sheet .editor-scroll .circle-canvas");
    // width > 0 is vacuous for the wheel - a virgin canvas is born 300 wide.
    // Sized-by-resize means inline style.width is set and hit geometry lives.
    return s && s.width > 0 && w && w.style.width !== "";
  });
  // The wheel is the palette: a strum across it paints bars in a row. Slots
  // pre-set to the dim degree (no outer wedge writes it), and the strum runs
  // stations H+3..H+5 — always outside the sector, and never near the door
  // knob, whose 15 px zone caught a station-0 strum whenever the rolled key
  // put an inner-ring home there (A minor, E dorian: three flakes' worth).
  const strummed = await page.evaluate(() => {
    // Scene-agnostic: the editor edits whichever scene its clip belongs to,
    // so pre-set EVERY scene's harmony and accept a write landing anywhere.
    for (const sc of window.__noodles.song.scenes) if (sc.harmony?.length) sc.harmony = sc.harmony.map(() => 6);
    const snap = window.__noodles.song.scenes.map((sc) => JSON.stringify(sc.harmony));
    // The editor's wheel mounts inside .editor-scroll; the key sheet's
    // full-size instance lands directly under #sheet — target the editor's.
    const canvas = document.querySelector("#sheet .editor-scroll .circle-canvas");
    const r = canvas.getBoundingClientRect();
    const H = window.__noodlesCircle.home();
    const at = (station) => {
      const a = (station * Math.PI) / 6 - Math.PI / 2;
      return {
        x: r.left + r.width / 2 + Math.cos(a) * (r.width / 2) * 0.66,
        y: r.top + r.height / 2 + Math.sin(a) * (r.height / 2) * 0.66,
      };
    };
    const o = (p, id) => ({ bubbles: true, cancelable: true, pointerId: id, pointerType: "touch", clientX: p.x, clientY: p.y });
    canvas.dispatchEvent(new PointerEvent("pointerdown", o(at(H + 3), 81)));
    canvas.dispatchEvent(new PointerEvent("pointermove", o(at(H + 4), 81)));
    canvas.dispatchEvent(new PointerEvent("pointermove", o(at(H + 5), 81)));
    canvas.dispatchEvent(new PointerEvent("pointerup", o(at(H + 5), 81)));
    const r2 = canvas.getBoundingClientRect();
    const changedScene = window.__noodles.song.scenes.findIndex((sc, i) => JSON.stringify(sc.harmony) !== snap[i]);
    return {
      changed: changedScene >= 0,
      changedScene,
      after: window.__noodles.song.scenes.map((sc) => JSON.stringify(sc.harmony)).join(" | "),
      H,
      key: window.__noodles.song.key,
      scale: window.__noodles.song.scale,
      rect: { w: r.width, top: Math.round(r.top) },
      moved: r.top !== r2.top || r.width !== r2.width,
      canvases: [...document.querySelectorAll(".circle-canvas")].map((cv) => ({
        w: cv.getBoundingClientRect().width,
        styleW: cv.style.width,
        buf: cv.width,
        parent: cv.parentElement?.parentElement?.className || cv.parentElement?.className,
        inSheet: !!cv.closest("#sheet"),
      })),
      keySheetSize: window.__noodlesCircle.size(),
    };
  });
  assertState(strummed.changed, `the editor wheel's strum wrote no bars: ${JSON.stringify(strummed)}`);
  // Voicing chips: "9" on a degree slot writes the five-tone stack and the
  // slot face names it; "triad" collapses a diatonic stack back to its
  // degree number, so it keeps following the key.
  const rung = await page.evaluate(() => {
    window.__noodles.song.scenes[0].harmony[0] = 4;
    document.querySelectorAll(".cslot")[0].click(); // reselect: chip rows rebuild on the degree entry
    document.querySelector('[data-action="rung-9"]').click();
    const e = window.__noodles.song.scenes[0].harmony[0];
    const face = document.querySelectorAll(".cslot")[0].textContent;
    document.querySelector('[data-action="rung-triad"]').click();
    const e2 = window.__noodles.song.scenes[0].harmony[0];
    return { five: !!(e?.pcs && e.pcs.length === 5), face, collapsed: e2 === 4 };
  });
  assertState(rung.five && rung.face.includes("9") && rung.collapsed, `voicing chips misbehaved: ${JSON.stringify(rung)}`);
  await closeSheet(page);
  await page.waitForFunction(() => !document.querySelector("#sheet")?.classList.contains("open"));

  await tap(page, ".tbtn.play");
  await page.waitForFunction(() => document.querySelectorAll(".clip.playing").length >= 4);
  const playOn = await page.$eval(".tbtn.play", (el) => el.classList.contains("on"));
  assertState(playOn, "play button did not enter playing state");
  // The pie timers must actually fill: the pump writes --pct on the .pie leaf
  // inside each playing clip (never on the clip — an inherited write there
  // invalidated the whole cell's subtree per frame).
  await page.waitForFunction(() => {
    const pie = document.querySelector(".clip.playing .pie");
    return pie && parseFloat(getComputedStyle(pie).getPropertyValue("--pct")) > 0;
  }, { timeout: 15000 });

  // --- The circle of fifths, while the loop plays: tap wedges (they sound
  // and trail), arm ● and punch a chord into the playing clip, travel one
  // station up the rim, then undo the whole excursion. The outer H and H+1
  // wedges are diatonic in every mode (the sector theorem), so two taps on
  // different degrees guarantee at least one armed write lands.
  await tap(page, "#key-btn");
  await page.waitForFunction(() => document.querySelector(".sheet-bar .title")?.textContent === "Circle");
  await wait(700); // let a chord event land so the trail has an entry
  const circleGeom = await page.evaluate(() => {
    const r = document.querySelector(".circle-canvas").getBoundingClientRect();
    const C = window.__noodlesCircle;
    const H = C.home();
    return { left: r.left, top: r.top, a: C.point("outer", H), b: C.point("outer", (H + 1) % 12), c: C.point("outer", (H + 3) % 12), rim: C.rimPoint(H), rim2: C.rimPoint((H + 1) % 12) };
  });
  const cPoint = (p) => [circleGeom.left + p.x, circleGeom.top + p.y];
  // Pre-set every scene's harmony to a nonsense BORROWED entry no diatonic
  // tap can ever equal. A degree pre-set can tie: in every minor key the
  // outer H+1 wedge IS degree 6, so 6s let tap-b write the pre-set value
  // straight back over tap-a's slot — net zero, three "flakes" of it. A
  // {pcs} sentinel never equals a degree write, so two sector taps always
  // leave a visible change, in whichever scene is playing.
  const readHarmony = () => page.evaluate(() => window.__noodles.song.scenes.map((sc) => JSON.stringify(sc.harmony)).join("|"));
  await page.evaluate(() => {
    for (const sc of window.__noodles.song.scenes) if (sc.harmony?.length) sc.harmony = sc.harmony.map(() => ({ pcs: [1, 2, 3] }));
  });
  const harmonyBefore = await readHarmony();
  // Armed taps write into the PLAYING clip, and the cold open rolls launch
  // modes per clip — a one-shot harmony clip plays once and its track goes
  // silent while the transport runs on (forensics: taps hit the wheel
  // dead-on, armed, with nowhere to land). Pin scene 0 to loop/none, then
  // relaunch it (quantized) and wait for its playing badge.
  await page.evaluate(() => {
    const sc = window.__noodles.song.scenes[0];
    sc.launch ||= {};
    for (const t of ["harmony", "drums", "bass", "melody"]) {
      sc.launch[t] = { ...(sc.launch[t] || {}), mode: "loop", follow: "none" };
    }
    window.__noodles.audio.launchScene(0);
  });
  await page.waitForFunction(() => document.querySelector('.clip.playing[data-track="harmony"]'), { timeout: 15000 });
  await wait(250); // the badge leads the audible bar by a hair; let the write clock settle
  await clickAction(page, "circle-arm");
  await page.touchscreen.tap(...cPoint(circleGeom.a));
  await wait(150);
  await page.touchscreen.tap(...cPoint(circleGeom.b));
  await wait(250);
  const harmonyAfter = await readHarmony();
  if (harmonyAfter === harmonyBefore) {
    const diag = await page.evaluate(
      ({ a, b }) => ({
        underA: document.elementFromPoint(a[0], a[1])?.className || document.elementFromPoint(a[0], a[1])?.tagName,
        underB: document.elementFromPoint(b[0], b[1])?.className || document.elementFromPoint(b[0], b[1])?.tagName,
        rectNow: document.querySelector(".circle-canvas").getBoundingClientRect().top,
        key: window.__noodles.song.key,
        scale: window.__noodles.song.scale,
        home: window.__noodlesCircle.home(),
        size: window.__noodlesCircle.size(),
        sheetKids: [...document.querySelector("#sheet").children].map((k) => `${k.className}:${Math.round(k.getBoundingClientRect().height)}`),
        wheels: document.querySelectorAll(".circle-canvas").length,
        playing: window.__noodles.audio.playing,
        mode: window.__noodles.audio.mode,
        playingHarmScene: document.querySelector('.clip.playing[data-track="harmony"]')?.dataset.scene ?? "none",
      }),
      { a: cPoint(circleGeom.a), b: cPoint(circleGeom.b) }
    );
    assertState(false, `armed circle tap did not land in the playing clip: ${JSON.stringify({ ...diag, geomTop: circleGeom.top })}`);
  };
  // A borrowed chord lands as {pcs} (D13): outer H+3 sits outside every
  // mode's sector, so this tap is chromatic by construction.
  await page.touchscreen.tap(...cPoint(circleGeom.c));
  await wait(250);
  const borrowedStored = await page.evaluate(() => window.__noodles.song.scenes[0].harmony.some((e) => typeof e === "object" && Array.isArray(e?.pcs)));
  assertState(borrowedStored, "armed borrowed tap did not store a {pcs} entry");
  await clickAction(page, "circle-arm"); // disarm before traveling
  const keyBeforeTravel = await page.evaluate(() => window.__noodles.song.key);
  const [crx, cry] = cPoint(circleGeom.rim);
  const [cr2x, cr2y] = cPoint(circleGeom.rim2);
  await page.touchscreen.touchStart(crx, cry);
  for (let i = 1; i <= 3; i++) {
    await page.touchscreen.touchMove(crx + ((cr2x - crx) * i) / 3, cry + ((cr2y - cry) * i) / 3);
    await wait(50);
  }
  await page.touchscreen.touchEnd();
  await page.waitForFunction((want) => window.__noodles.song.key === want, {}, (keyBeforeTravel + 7) % 12);
  // The travel is a key commit, which RESETS the trail (a stale line lies
  // once the context rewrites — the dice-roll bug). Playback must regrow
  // one within a bar, which asserts both the reset and the rebuild.
  await page.waitForFunction(() => window.__noodlesCircle.trailLength() >= 1, { timeout: 15000 });
  // The front door: drag the knob to another in-sector wedge. The mode
  // renames; the stored notes hold still — that stillness IS the assertion.
  const doorFrom = await page.evaluate(() => ({
    scale: window.__noodles.song.scale,
    bass: JSON.stringify(window.__noodles.song.scenes[0].bass),
  }));
  const doorTargetScale = doorFrom.scale === "minor" ? "major" : "minor";
  const doorGeom = await page.evaluate((ring) => {
    const C = window.__noodlesCircle;
    return { d: C.doorPoint(), t: C.point(ring, C.home()) };
  }, doorTargetScale === "major" ? "outer" : "inner");
  const [ddx, ddy] = cPoint(doorGeom.d);
  const [dtx, dty] = cPoint(doorGeom.t);
  await page.touchscreen.touchStart(ddx, ddy);
  // First move right away, like a real finger's 60Hz stream: a synthetic
  // gap over the knob's hold beat would convert the grab into the home
  // bloom (the knob-hold affordance) and eat the drag.
  await page.touchscreen.touchMove(ddx + (dtx - ddx) * 0.15, ddy + (dty - ddy) * 0.15);
  for (let i = 1; i <= 3; i++) {
    await page.touchscreen.touchMove(ddx + ((dtx - ddx) * i) / 3, ddy + ((dty - ddy) * i) / 3);
    await wait(50);
  }
  await page.touchscreen.touchEnd();
  await page.waitForFunction((want) => window.__noodles.song.scale === want, {}, doorTargetScale);
  const doorAfterBass = await page.evaluate(() => JSON.stringify(window.__noodles.song.scenes[0].bass));
  assertState(doorAfterBass === doorFrom.bass, "the door drag moved notes — re-mode must be a pure renaming");
  // The mirror, via synthetic pointers (CDP can't hold two real touches
  // reliably in a long run): a finger on the hole reflects the next tap.
  const mirrored = await page.evaluate(() => {
    const canvas = document.querySelector(".circle-canvas");
    const r = canvas.getBoundingClientRect();
    const C = window.__noodlesCircle;
    const opts = (x, y, id) => ({ bubbles: true, cancelable: true, pointerId: id, pointerType: "touch", clientX: r.left + x, clientY: r.top + y });
    const before = C.trailLength();
    canvas.dispatchEvent(new PointerEvent("pointerdown", opts(C.size() / 2, C.size() / 2, 71)));
    const during = C.mirrorOn();
    const v = C.point("outer", (C.home() + 1) % 12);
    canvas.dispatchEvent(new PointerEvent("pointerdown", opts(v.x, v.y, 72)));
    canvas.dispatchEvent(new PointerEvent("pointerup", opts(v.x, v.y, 72)));
    canvas.dispatchEvent(new PointerEvent("pointerup", opts(C.size() / 2, C.size() / 2, 71)));
    return { during, after: C.mirrorOn(), grew: C.trailLength() > before };
  });
  assertState(mirrored.during && !mirrored.after && mirrored.grew, `mirror hold misbehaved: ${JSON.stringify(mirrored)}`);
  await page.screenshot({ path: circleShotPath });
  await closeSheet(page);
  // Undo the excursion: door, travel, and up to four punched chords. The
  // first punch's snapshot holds the pre-set 6s across all scenes, so the
  // same all-scenes reader that took harmonyBefore is the restore target.
  let harmonyRestored = false;
  for (let i = 0; i < 7 && !harmonyRestored; i++) {
    await tap(page, ".tbtn.undo");
    await wait(120);
    harmonyRestored = (await readHarmony()) === harmonyBefore;
  }
  assertState(harmonyRestored, "undo did not restore the punched harmony");

  // --- The chop deck: build a tiny WAV in-page (8 blips), load it, slice
  // both ways, flip melody to chops. Same public API the sound sheet uses.
  const chop = await page.evaluate(async () => {
    const sr = 44100;
    const n = sr;
    const pcm = new Int16Array(n);
    for (let i = 0; i < n; i++) {
      const env = Math.exp(-((i % (sr / 8)) / 1600));
      pcm[i] = Math.round(Math.sin(i * 0.35) * env * 20000);
    }
    const bytes = new ArrayBuffer(44 + pcm.length * 2);
    const v = new DataView(bytes);
    const w = (o, s) => {
      for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
    };
    w(0, "RIFF");
    v.setUint32(4, 36 + pcm.length * 2, true);
    w(8, "WAVEfmt ");
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, sr, true);
    v.setUint32(28, sr * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    w(36, "data");
    v.setUint32(40, pcm.length * 2, true);
    new Int16Array(bytes, 44).set(pcm);
    const audio = window.__noodles.audio;
    const grid = await audio.loadChopSample(bytes, "smoke", "grid");
    audio.setChopMode("auto");
    const auto = audio.chopInfo();
    audio.setPatch("melody", { source: "chops" });
    return { gridCount: grid.count, autoCount: auto.count, source: audio.patch("melody").source };
  });
  assertState(chop.gridCount === 16, `grid slicing gave ${chop.gridCount} slices`);
  assertState(chop.autoCount >= 4, `auto slicing found only ${chop.autoCount} slices`);
  assertState(chop.source === "chops", "melody source did not flip to chops");
  await tap(page, '.clip.filled[data-track="melody"]');
  await page.waitForFunction(() => document.querySelector(".sheet-bar .title")?.textContent === "Piano Roll");
  const sliceLabel = await page.$eval(".pkey", (el) => el.textContent);
  assertState(/^s\d+/.test(sliceLabel), `top roll row is "${sliceLabel}", wanted a slice label`);
  await closeSheet(page);
  await page.waitForFunction(() => !document.querySelector("#sheet")?.classList.contains("open"));

  // The humanizer slider writes through.
  await page.$eval(".humanslider", (el) => {
    el.value = "0.4";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const humanized = await page.evaluate(() => window.__noodles.song.humanize);
  assertState(Math.abs(humanized - 0.4) < 1e-6, `humanize did not apply (${humanized})`);

  await tap(page, "#view-toggle-btn");
  const stillPlayingAfterView = await page.$eval(".tbtn.play", (el) => el.classList.contains("on"));
  assertState(stillPlayingAfterView, "view switch stopped playback");
  await tap(page, "#view-toggle-btn");
  await tap(page, ".tbtn.play");

  await longPress(page, '.clip.filled[data-track="drums"]');
  await page.waitForFunction(() => document.querySelector(".sheet-bar .title")?.textContent === "Clip Properties");
  await clickAction(page, "mode-oneshot");
  await page.waitForFunction(() => document.querySelector('.clip.filled[data-track="drums"] .clip-badge')?.textContent.includes("1x"));
  await clickAction(page, "follow-next");
  await page.waitForFunction(() => document.querySelector('.clip.filled[data-track="drums"] .clip-badge')?.textContent.includes("next"));
  const badge = await page.$eval('.clip.filled[data-track="drums"] .clip-badge', (el) => el.textContent);
  assertState(badge.includes("1x") && badge.includes("next"), `unexpected launch badge: ${badge}`);
  const scenesBeforeDuplicate = await page.$$eval(".scenecell", (els) => els.length);
  await clickAction(page, "duplicate-scene");
  await page.waitForFunction((before) => document.querySelectorAll(".scenecell").length === before + 1, {}, scenesBeforeDuplicate);
  const scenesAfterDuplicate = await page.$$eval(".scenecell", (els) => els.length);
  assertState(scenesAfterDuplicate === scenesBeforeDuplicate + 1, "session duplicate did not add a scene");
  await page.screenshot({ path: propsShotPath, fullPage: true });

  await closeSheet(page);
  await page.waitForFunction(() => !document.querySelector("#sheet")?.classList.contains("open"));
  await tap(page, "#view-toggle-btn");
  const arrange = await page.$eval("#app", (app) => app.classList.contains("arrange"));
  assertState(arrange, "arrangement view did not open");

  await tap(page, '.arr-thead[data-track="drums"] [data-track-toggle="mute"]');
  const muted = await page.$eval('.arr-thead[data-track="drums"] [data-track-toggle="mute"]', (el) => el.classList.contains("on"));
  assertState(muted, "arrangement mute button did not toggle");
  await tap(page, '.arr-thead[data-track="drums"] [data-track-toggle="solo"]');
  const soloed = await page.$eval('.arr-thead[data-track="drums"] [data-track-toggle="solo"]', (el) => el.classList.contains("on"));
  assertState(soloed, "arrangement solo button did not toggle");
  await tap(page, '.arr-thead[data-track="drums"] [data-track-toggle="mute"]');
  await tap(page, '.arr-thead[data-track="drums"] [data-track-toggle="solo"]');

  // Tap a track header (outside M/S) → that track's Sound page opens, and it
  // fits the phone viewport without scrolling (the pad flexes to fill).
  await page.evaluate(() => {
    document.querySelector('.arr-thead[data-track="bass"]').dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await page.waitForFunction(() => document.querySelector(".sheet-bar .title")?.textContent === "Sound");
  const soundSub = await page.$eval(".sheet-bar .sub", (el) => el.textContent);
  assertState(soundSub === "Bass", `header tap opened Sound for "${soundSub}", wanted Bass`);
  const soundFit = await page.$eval(".sound-body", (el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
  assertState(soundFit.scroll <= soundFit.client + 2, `sound sheet scrolls: ${JSON.stringify(soundFit)}`);
  await closeSheet(page);
  await page.waitForFunction(() => !document.querySelector("#sheet")?.classList.contains("open"));

  // Loop lane: drag across empty lane space paints a new loop and enables it;
  // a tap on the brace toggles it back off.
  await page.evaluate(() => {
    const lane = document.querySelector(".arr-looplane");
    const content = document.querySelector(".arr-content");
    const r = content.getBoundingClientRect();
    const ppb = parseFloat(getComputedStyle(content).getPropertyValue("--ppb")) || 37;
    const y = lane.getBoundingClientRect().top + 12;
    const opts = (x) => ({ bubbles: true, cancelable: true, pointerId: 7, pointerType: "touch", clientX: r.left + x, clientY: y });
    lane.dispatchEvent(new PointerEvent("pointerdown", opts(ppb * 5 + 2)));
    lane.dispatchEvent(new PointerEvent("pointermove", opts(ppb * 7 + 2)));
    lane.dispatchEvent(new PointerEvent("pointerup", opts(ppb * 7 + 2)));
  });
  const painted = await page.evaluate(() => window.__noodles.song.loop);
  assertState(painted.on && painted.start === 5 && painted.len === 2, `loop paint failed: ${JSON.stringify(painted)}`);
  await page.evaluate(() => {
    // Dispatch on the brace itself so e.target matches a real touch there.
    const brace = document.querySelector(".arr-loop");
    const content = document.querySelector(".arr-content");
    const r = content.getBoundingClientRect();
    const ppb = parseFloat(getComputedStyle(content).getPropertyValue("--ppb")) || 37;
    const y = brace.getBoundingClientRect().top + 8;
    const opts = { bubbles: true, cancelable: true, pointerId: 8, pointerType: "touch", clientX: r.left + ppb * 6, clientY: y };
    brace.dispatchEvent(new PointerEvent("pointerdown", opts));
    brace.dispatchEvent(new PointerEvent("pointerup", opts));
  });
  const toggled = await page.evaluate(() => window.__noodles.song.loop.on);
  assertState(toggled === false, "brace tap did not toggle the loop off");
  // Dragging toward the viewport edge must auto-pan the arrangement.
  await page.evaluate(() => {
    const brace = document.querySelector(".arr-loop");
    const r = brace.getBoundingClientRect();
    const opts = (x) => ({ bubbles: true, cancelable: true, pointerId: 9, pointerType: "touch", clientX: x, clientY: r.top + 8 });
    brace.dispatchEvent(new PointerEvent("pointerdown", opts(r.left + 10)));
    document.querySelector(".arr-looplane").dispatchEvent(new PointerEvent("pointermove", opts(innerWidth - 8)));
  });
  // The pan is rAF-driven, and on a loaded box headless frames can stall past
  // any fixed sleep (a 500 ms wait here flaked). Poll for the first moved
  // pixel instead — the assertion still demands the auto-pan actually pans.
  let panned = 0;
  for (let i = 0; i < 30 && panned === 0; i++) {
    await wait(150);
    panned = await page.evaluate(() => document.querySelector(".arr-scroll").scrollLeft);
  }
  await page.evaluate(() => {
    document.querySelector(".arr-looplane").dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 9 }));
  });
  assertState(panned > 0, `edge drag did not auto-pan the view (scrollLeft ${panned})`);

  await longPress(page, '.arr-thead[data-track="drums"]');
  await page.waitForFunction(() => document.querySelector(".sheet-bar .title")?.textContent === "Track Options");
  await closeSheet(page);
  await page.waitForFunction(() => !document.querySelector("#sheet")?.classList.contains("open"));
  await tap(page, ".arr-corner .view-mix");
  await page.waitForFunction(() => document.querySelector(".sheet-bar .title")?.textContent === "Mixer");
  const mixerText = await page.$eval("#sheet", (el) => el.textContent);
  assertState(mixerText.includes("echo"), "mixer missing echo send");
  assertState(mixerText.includes("Master") && mixerText.includes("-6 dB"), "mixer missing master/default level");
  // The master strip is a door: tapping it opens the mix bus editor, whose
  // knobs drive audio.setMaster and ride project save/load.
  await tap(page, '.mx-strip[data-track="master"]');
  await page.waitForFunction(() => document.querySelector(".sheet-bar .title")?.textContent === "Master");
  for (const knobName of ["level", "juice", "weight", "glue"]) {
    const present = await page.$(`[data-action="master-${knobName}"]`);
    assertState(!!present, `master sheet missing ${knobName} knob`);
  }
  const masterRound = await page.evaluate(() => {
    const a = window.__noodles.audio;
    a.setMaster({ juice: 0.8, level: -3 });
    const echoed = a.master();
    a.setMaster({ juice: 0.5, level: 0 });
    return echoed;
  });
  assertState(Math.abs(masterRound.juice - 0.8) < 1e-6 && masterRound.level === -3, `setMaster did not echo (${JSON.stringify(masterRound)})`);
  // An outside tap on a DIFFERENT view's button closes the sheet (the scrim
  // rule); the next tap opens it. Only the same-view button is a no-op.
  await tap(page, ".arr-corner .view-mix");
  await page.waitForFunction(() => !document.querySelector("#sheet")?.classList.contains("open"));
  await tap(page, ".arr-corner .view-mix");
  await page.waitForFunction(() => document.querySelector(".sheet-bar .title")?.textContent === "Mixer");
  await tap(page, ".tbtn.play");
  const mixerStillOpen = await page.$eval("#sheet", (el) => el.classList.contains("open"));
  assertState(mixerStillOpen, "play/pause dismissed an open sheet");
  await tap(page, ".tbtn.play");
  await page.screenshot({ path: mixerShotPath, fullPage: true });

  // Sound sheet: morph pad drag, color chip, per-track sound dice.
  await clickAction(page, "sound-bass");
  await page.waitForFunction(() => document.querySelector(".sheet-bar .title")?.textContent === "Sound");
  await page.evaluate(() => {
    const xy = document.querySelector('[data-action="xy-bass"]');
    const r = xy.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, pointerId: 2, pointerType: "touch", clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    xy.dispatchEvent(new PointerEvent("pointerdown", opts));
    xy.dispatchEvent(new PointerEvent("pointerup", opts));
  });
  await wait(200);
  const morphed = await page.evaluate(() => window.__noodles.audio.patch("bass"));
  assertState(Math.abs(morphed.x - 0.5) < 0.1 && Math.abs(morphed.y - 0.5) < 0.1, `xy pad tap did not morph to center: ${JSON.stringify(morphed)}`);
  await clickAction(page, "color-phase");
  const colored = await page.evaluate(() => window.__noodles.audio.patch("bass").color);
  assertState(colored === "phase", `color chip did not apply (got ${colored})`);
  await clickAction(page, "sound-dice-bass");
  const rolled = await page.evaluate(() => window.__noodles.audio.patch("bass"));
  assertState(
    rolled.x >= 0 && rolled.x <= 1 && rolled.y >= 0 && rolled.y <= 1 && rolled.amount >= 0 && rolled.amount <= 1,
    `sound dice rolled out of range: ${JSON.stringify(rolled)}`
  );
  await page.evaluate(() => window.__noodles.audio.setPatch("bass", { x: 0, y: 0, color: "none" }));
  // Per-track color sets: the drum sound page offers none + crush only, and
  // the engine coerces a retired color instead of taking it.
  await closeSheet(page);
  await page.waitForFunction(() => !document.querySelector("#sheet")?.classList.contains("open"));
  await tap(page, '.arr-thead[data-track="drums"]');
  await page.waitForFunction(() => document.querySelector(".sheet-bar .title")?.textContent === "Sound");
  const drumColors = await page.$$eval("[data-action^='color-']", (els) => els.map((e) => e.dataset.action.slice(6)));
  assertState(drumColors.join(",") === "none,crush", `drum color set is ${drumColors.join(",")}`);
  const drumWob = await page.evaluate(() => window.__noodles.audio.setPatch("drums", { color: "wob" }).color);
  assertState(drumWob === "none", `drums accepted a retired color (got ${drumWob})`);
  await closeSheet(page);
  await page.waitForFunction(() => !document.querySelector("#sheet")?.classList.contains("open"));
  await tap(page, '.arr-thead[data-track="bass"]');
  await page.waitForFunction(() => document.querySelector(".sheet-bar .title")?.textContent === "Sound");
  // Motion capture: arm the bass, play, ride the pad via setPatch AND the
  // verb send via setSend; some playing scene must grow both an x lane and a
  // verb ride with real variety in them (the send ride is D5's closure).
  await page.evaluate(() => window.__noodles.audio.armMotion("bass", true));
  await tap(page, ".tbtn.play");
  await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 10; i++) {
      window.__noodles.audio.setPatch("bass", { x: i / 10, y: 1 - i / 10 });
      window.__noodles.audio.setSend("bass", -30 + i * 3);
      await wait(150);
    }
  });
  await page.waitForFunction(() => {
    return window.__noodles.song.scenes.some((sc) => {
      const lane = sc.motion?.bass?.x;
      const ride = sc.motion?.bass?.verb;
      const varied = (a) => Array.isArray(a) && new Set(a.map((v) => v.toFixed(2))).size > 2;
      return varied(lane) && varied(ride);
    });
  }, { timeout: 15000 });
  await tap(page, ".tbtn.play");
  await page.evaluate(() => {
    window.__noodles.audio.disarmMotion();
    window.__noodles.audio.setSend("bass", -30); // static send back to off; the recorded ride stays
  });
  // Drums: kit pad, sample/synth banks, and the one-shot picker. The sound
  // sheet replaced the mixer, so reopen it to reach the drums strip.
  await closeSheet(page);
  await page.waitForFunction(() => !document.querySelector("#sheet")?.classList.contains("open"));
  await tap(page, ".arr-corner .view-mix");
  await page.waitForFunction(() => document.querySelector(".sheet-bar .title")?.textContent === "Mixer");
  await page.evaluate(() => window.__noodles.audio.setPatch("drums", { bank: "sample" }));
  await clickAction(page, "sound-drums");
  await page.waitForSelector('[data-action="xy-drums"]', { visible: true });
  await page.waitForSelector('[data-action="pick-kick"]', { visible: true });
  await clickAction(page, "pick-kick");
  await page.waitForFunction(() => document.querySelector(".sheet-bar .title")?.textContent === "One-shot");
  await clickAction(page, "pin-street-kick");
  await page.waitForFunction(() => window.__noodles.audio.patch("drums").pins.kick === "street-kick");
  await clickAction(page, "pin-kit");
  await page.waitForFunction(() => !window.__noodles.audio.patch("drums").pins.kick);
  const samplesReady = await page.evaluate(() => window.__noodles.audio.samplesReady());
  assertState(samplesReady, "bundled drum samples did not load");
  // Beatbox capture: record the (fake) mic into the kick slot, expect a
  // conditioned one-shot pinned as "user".
  await clickAction(page, "pin-mic");
  await page.waitForFunction(() => document.querySelector(".sheet-bar .title")?.textContent === "Record");
  await clickAction(page, "mic-go");
  await page.waitForFunction(() => document.querySelector(".mic-big")?.classList.contains("live"), { timeout: 10000 });
  // Chrome's fake mic beeps periodically; record across a full cycle so the
  // take always contains signal.
  await wait(1200);
  await clickAction(page, "mic-go");
  await page.waitForFunction(
    () => window.__noodles.audio.userSampleName("kick") === "mic kick" && window.__noodles.audio.patch("drums").pins.kick === "user",
    { timeout: 15000 }
  );
  await page.evaluate(() => {
    const pins = { ...window.__noodles.audio.patch("drums").pins };
    delete pins.kick;
    window.__noodles.audio.setPatch("drums", { pins });
  });

  await tapAt(page, 200, 70);
  await page.waitForFunction(() => !document.querySelector("#sheet")?.classList.contains("open"));

  await tap(page, "#file-btn");
  await page.waitForFunction(() => document.querySelector(".sheet-bar .title")?.textContent === "Export");
  const exportText = await page.$eval("#sheet", (el) => el.textContent);
  assertState(exportText.includes("Download Project") && exportText.includes("Master WAV"), "export sheet missing grouped project/audio actions");
  await clickAction(page, "save-local-project");
  await page.waitForFunction(() => document.querySelector(".exp-status")?.textContent.includes("Kept on this device"));
  await page.evaluate(() => document.querySelector('[data-action="export-master-wav"]').click());
  try {
    await page.waitForFunction(() => document.querySelector(".exp-links a.save")?.getAttribute("href")?.startsWith("blob:"), { timeout: exportTimeout });
  } catch (e) {
    const status = await page.$eval(".exp-status", (el) => el.textContent);
    throw new Error(`export timed out; status="${status}"; errors=${errors.join(" | ") || "none"}`);
  }
  // The status text is not enough — a silent or truncated WAV would still say
  // "ready". Fetch the offered blob and assert it carries real audio.
  const wav = await page.evaluate(async () => {
    const a = document.querySelector(".exp-links a.save");
    const buf = await fetch(a.href).then((r) => r.arrayBuffer());
    const dv = new DataView(buf);
    const tag = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
    let peak = 0, nz = 0, n = 0;
    for (let off = 44; off + 2 <= buf.byteLength; off += 2) {
      const s = dv.getInt16(off, true) / 32768, ab = Math.abs(s);
      if (ab > peak) peak = ab;
      if (s !== 0) nz++;
      n++;
    }
    return { bytes: buf.byteLength, tag, peakDb: Math.round(20 * Math.log10(Math.max(peak, 1e-9)) * 10) / 10, nzPct: Math.round((nz / n) * 100) };
  });
  assertState(wav.tag === "RIFF" && wav.bytes > 100000 && wav.peakDb > -6 && wav.nzPct > 50, `exported WAV empty/silent: ${JSON.stringify(wav)}`);
  // Staff PNG: the engraver runs the first harmony scene through the same
  // painter the editor reads; the offer must be a real, non-blank PNG.
  await page.evaluate(() => document.querySelector('[data-action="export-staff"]').click());
  await page.waitForFunction(
    () => [...document.querySelectorAll(".exp-links a.save")].some((a) => (a.getAttribute("download") || "").endsWith("-staff.png")),
    { timeout: 15000 }
  );
  const staffPng = await page.evaluate(async () => {
    const a = [...document.querySelectorAll(".exp-links a.save")].find((x) => (x.getAttribute("download") || "").endsWith("-staff.png"));
    const buf = await fetch(a.href).then((r) => r.arrayBuffer());
    const b = new Uint8Array(buf);
    return { bytes: buf.byteLength, sig: b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 };
  });
  assertState(staffPng.sig && staffPng.bytes > 4000, `staff PNG export wrong: ${JSON.stringify(staffPng)}`);
  await page.screenshot({ path: exportShotPath, fullPage: true });
  await closeSheet(page);
  await page.waitForFunction(() => !document.querySelector("#sheet")?.classList.contains("open"));

  // The ? opens the guide — with the greet pill gone, this is the whole
  // onboarding, so it must actually be comprehensive: every surface gets a
  // section, and the sheet hints that it scrolls.
  await tap(page, "#about-btn");
  await page.waitForFunction(() => document.querySelector(".sheet-bar .title")?.textContent === "noodles");
  await wait(200); // the hint lands one rAF after open; measure after it
  const about = await page.evaluate(() => {
    const body = document.querySelector("#sheet .editor-scroll");
    return {
      text: document.querySelector("#sheet").textContent,
      sections: [...document.querySelectorAll("#sheet .about-label")].map((el) => el.textContent),
      hint: !!document.querySelector("#sheet .scroll-hint"),
      overflows: !!body && body.scrollHeight > body.clientHeight + 8,
    };
  });
  assertState(about.text.includes("instrument"), "about sheet missing its one job");
  for (const section of ["start here", "the grid", "sound", "mix", "arrange", "keep it"]) {
    assertState(about.sections.includes(section), `about guide missing the "${section}" section`);
  }
  // Hint iff overflow: the guide's height legitimately varies with the
  // conditional rows (install prompt, waiting update), so asserting overflow
  // itself was a coin flip — the invariant is the hint matching it.
  assertState(about.hint === about.overflows, `scroll hint (${about.hint}) disagrees with overflow (${about.overflows})`);
  // A dare rides the project file and greets the loader, dismissibly.
  const dared = await page.evaluate(() => {
    const snap = JSON.parse(JSON.stringify(window.__noodles.song));
    snap.dare = "stay in Eb, one step per voice";
    window.__noodles.applyProject(snap); // schema-less input IS the song

    const banner = document.querySelector(".dare-banner");
    const text = banner?.querySelector(".dare-text")?.textContent || "";
    banner?.querySelector(".dare-x")?.click();
    return { shown: !!banner, text, gone: !document.querySelector(".dare-banner") };
  });
  assertState(dared.shown && dared.text.includes("stay in Eb") && dared.gone, `dare banner misbehaved: ${JSON.stringify(dared)}`);
  await tap(page, "#about-btn");
  await page.waitForFunction(() => document.querySelector(".sheet-bar .title")?.textContent === "noodles");

  // The buried perf overlay: toggling it in the guide shows and hides the HUD.
  await clickAction(page, "perf-toggle");
  await page.waitForSelector("#perf-hud");
  await clickAction(page, "perf-toggle");
  const hudGone = await page.evaluate(() => !document.querySelector("#perf-hud") && !localStorage.getItem("noodles:perf-hud"));
  assertState(hudGone, "perf overlay did not toggle back off");
  // The visual-sync nudge persists and steps by 10 ms.
  await clickAction(page, "sync-nudge-up");
  const nudged = await page.evaluate(() => localStorage.getItem("noodles:sync-nudge"));
  assertState(nudged === "10", `sync nudge did not persist (${nudged})`);
  await clickAction(page, "sync-nudge-down");
  await closeSheet(page);
  await page.waitForFunction(() => !document.querySelector("#sheet")?.classList.contains("open"));

  // Session-record: arm, play a couple of bars in session view, and the
  // performance must land in the arrangement. Regression guard: recording used
  // to throw a ReferenceError on every recorded bar (undefined scheduleSave).
  await tap(page, "#view-toggle-btn");
  const recArmed = await page.$eval("#rec-btn", (el) => (el.click(), true));
  assertState(recArmed, "record button missing");
  await page.waitForFunction(() => document.querySelector("#rec-btn")?.classList.contains("on"));
  await tap(page, ".tbtn.play");
  await page.waitForFunction(
    () => window.__noodles.song.arrangement.harmony.some((c) => c.start === 0 && c.len >= 2),
    { timeout: 30000 }
  );
  await tap(page, ".tbtn.play");
  await page.evaluate(() => document.querySelector("#rec-btn")?.click());
  await page.waitForFunction(() => !document.querySelector("#rec-btn")?.classList.contains("on"));
  await tap(page, "#view-toggle-btn");

  // The transport must actually advance — not merely flip the play button on.
  // Regression guard for the dual-context bug: play() started a transport the
  // clock loop wasn't scheduled on, so nothing sounded and the playhead froze.
  await tap(page, ".tbtn.play");
  const playhead = () => page.evaluate(() => document.querySelector(".arr-playhead")?.style.transform ?? "");
  const phStart = await playhead();
  await wait(800);
  const phEnd = await playhead();
  assertState(phStart !== phEnd, `transport stalled: playhead did not advance (${phStart} -> ${phEnd})`);

  await page.screenshot({ path: shotPath, fullPage: true });

  // Dice: one tap re-rolls the whole song (fresh magic scene), and undo
  // brings the previous song back.
  const scenesBeforeDice = await page.evaluate(() => window.__noodles.song.scenes.length);
  assertState(scenesBeforeDice >= 2, `expected the duplicated scene to persist, got ${scenesBeforeDice}`);
  await page.evaluate(() => document.querySelector("#dice-btn").click());
  const afterDice = await page.evaluate(() => ({
    scenes: window.__noodles.song.scenes.length,
    tag: window.__noodles.song.scenes[0].tag,
  }));
  // A roll is one magic scene, sometimes with a ✨b variation to go to.
  assertState(afterDice.scenes >= 1 && afterDice.scenes <= 2 && afterDice.tag.includes("✨"), `dice did not roll a fresh magic song: ${JSON.stringify(afterDice)}`);
  await page.evaluate(() => document.querySelector(".tbtn.undo").click());
  const scenesAfterUndo = await page.evaluate(() => window.__noodles.song.scenes.length);
  assertState(scenesAfterUndo === scenesBeforeDice, `undo did not restore the pre-dice song (${scenesAfterUndo} vs ${scenesBeforeDice})`);

  // Roll a handful more and hold the register invariant: the dice never deals
  // a driveless sine bass in octave 1 (inaudible on real speakers).
  for (let i = 0; i < 6; i++) {
    const roll = await page.evaluate(() => {
      document.querySelector("#dice-btn").click();
      const { song, audio } = window.__noodles;
      const midis = song.scenes[0].bass.flatMap((slot) => (slot || []).map((n) => n.midi));
      return { preset: audio.bassPreset(), minMidi: Math.min(...midis), count: midis.length };
    });
    assertState(roll.count > 0, `dice roll ${i} produced an empty bassline`);
    assertState(roll.preset !== "deep" || roll.minMidi >= 36, `dice dealt deep bass below octave 2 (min midi ${roll.minMidi})`);
  }

  assertState(errors.length === 0, `runtime errors:\n${errors.join("\n")}`);
  console.log(`smoke ok: ${propsShotPath}`);
  console.log(`smoke ok: ${mixerShotPath}`);
  console.log(`smoke ok: ${exportShotPath}`);
  console.log(`smoke ok: ${shotPath}`);
} finally {
  if (browser) await browser.close();
  if (preview) await preview.stop();
}
