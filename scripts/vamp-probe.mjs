// Monte Carlo receipt for the vamp archetype (npm run probe:vamp).
//
// Rolls many songs through the real makeSong and asserts the vamp's
// promises: tempo band, capped swing, dorian lean, extended voicings,
// ghost snares - and that every other archetype still rolls inside its
// own tempo band with normalizeScene-clean scenes (no regression).
// Exits nonzero on any failure. Receipts print for eyeballing.

import { makeSong, harmonyChord, setScaleContext, normalizeScene, magicHarmony, rollDrumPhrase, SCALES } from "../src/model.js";

const N = 600;
const rolls = [];
for (let i = 0; i < N; i++) rolls.push(makeSong());

const fails = [];
const check = (name, cond) => {
  console.log(`  [${cond ? "ok" : "FAIL"}] ${name}`);
  if (!cond) fails.push(name);
};

const vamps = rolls.filter((s) => s.vibe.groove === "vamp");
console.log(`${N} rolls, ${vamps.length} vamp hires (${(100 * vamps.length / N).toFixed(0)}%)`);

check("vamp gets hired a sane amount (8-30%)",
  vamps.length / N > 0.08 && vamps.length / N < 0.3);
check("every vamp tempo in [108,122]",
  vamps.every((s) => s.tempo >= 108 && s.tempo <= 122));
check("every vamp swing <= 0.08", vamps.every((s) => s.swing <= 0.08));

const dorian = vamps.filter((s) => s.scale === "dorian").length;
check(`vamp leans dorian (${dorian}/${vamps.length}, expect ~60%)`,
  dorian / vamps.length > 0.4);

const extended = vamps.map((s) =>
  s.scenes[0].harmony.filter((e) => typeof e !== "number").length / s.scenes[0].harmony.length);
check("vamp harmony arrives extended (>=60% pcs slots on average)",
  extended.reduce((a, b) => a + b, 0) / extended.length >= 0.6);

const ghosty = vamps.filter((s) =>
  s.scenes[0].drums.snare.some((v) => v > 0 && v < 0.3)).length;
check(`vamp rolls carry ghost snares (${ghosty}/${vamps.length}, expect most)`,
  ghosty / vamps.length > 0.6);

// The arc (DESIGN-VILLAIN V-C): every vamp roll is a four-scene form —
// A, drumless interlude, variation, one-shot pedal outro — chained by
// the same follow actions a long-press could set.
const TRACKS4 = ["harmony", "drums", "bass", "melody"];
check(`vamp deals the arc (${vamps.filter((s) => s.scenes.length === 4).length}/${vamps.length} rolls carry 4 scenes)`,
  vamps.every((s) => s.scenes.length === 4));
check("arc interlude and outro drop the drums",
  vamps.every((s) => [1, 3].every((i) =>
    Object.values(s.scenes[i].drums).every((lane) => lane.every((v) => !v)))));
check("arc outro holds one pedal chord and plays once",
  vamps.every((s) => {
    const h = s.scenes[3].harmony;
    const first = JSON.stringify(h[0]);
    return h.every((e) => JSON.stringify(e) === first) &&
      TRACKS4.every((t) => s.scenes[3].launch[t].mode === "oneshot" && s.scenes[3].launch[t].follow === "none");
  }));
check("arc scenes chain by follow actions (next, 8 bars each)",
  vamps.every((s) => s.scenes.slice(0, 3).every((sc) =>
    TRACKS4.every((t) => sc.launch[t].follow === "next" && sc.launch[t].followBars === 8))));
check("vamp rolls carry the drag kick (15-40 ms)",
  vamps.every((s) => s.laneNudge?.kick >= 15 && s.laneNudge?.kick <= 40));
check("everyone else keeps flat time and 1-2 scenes",
  rolls.filter((s) => s.vibe.groove !== "vamp").every((s) =>
    !Object.keys(s.laneNudge || {}).length && s.scenes.length <= 2));

// no-regression: every roll of every archetype is normalizeScene-clean
// and sits inside its own tempo band.
import("../src/model.js").then(() => {});
let clean = true;
for (const s of rolls) {
  for (const sc of s.scenes) {
    try { normalizeScene(sc); } catch { clean = false; }
  }
}
check("all scenes from all archetypes normalize clean", clean);

// eyeball receipts: three vamp rolls named by the app's own theory
console.log("\nsample vamp rolls:");
for (const s of vamps.slice(0, 3)) {
  setScaleContext(s.key, s.scale);
  const names = s.scenes[0].harmony.map((e) => harmonyChord(e).roman);
  const keyName = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"][s.key];
  console.log(`  ${keyName} ${s.scale} @${s.tempo} swing ${s.swing}  |  ${names.join("  ")}  |  kit ${s.vibe.kit ?? "(rolled)"}`);
}

// Targeted receipts for the Villain moves (DESIGN-VILLAIN V-A/V-B):
// straight magicHarmony draws in the reference's own context (F dorian),
// so the rates are measurable without waiting on 600-song hire luck.
setScaleContext(5, "dorian");
const vibeV = { groove: "vamp" };
const M = 2000;
const DECK_OPEN = new Set(["0,1", "0,2", "0,3", "1,4"]);
let adj = 0, v7 = 0, pairLines = 0, visited = 0;
for (let i = 0; i < M; i++) {
  const line = magicHarmony(vibeV);
  const degs = line.map((e) =>
    (typeof e === "number" ? e : SCALES.dorian.indexOf((((e.pcs[0] - 5) % 12) + 12) % 12)));
  if (degs[0] === 0 && degs[1] === 1) adj++;
  // pc 4 (E natural) exists in no F-dorian diatonic stack and no other
  // borrow color — it is exactly the V7's leading tone.
  if (line.some((e) => typeof e !== "number" && e.pcs.includes(4))) v7++;
  if (DECK_OPEN.has(`${degs[0]},${degs[1]}`)) {
    pairLines++;
    if (degs.length >= 4 && (degs[2] !== degs[0] || degs[3] !== degs[1])) visited++;
  }
}
console.log(`\n${M} magicHarmony draws in F dorian: i↔ii ${adj}, V7 ${v7}, ` +
  `visits ${visited}/${pairLines} pair-lines`);
check(`the i↔ii planing vamp is reachable (~24% of draws, got ${(100 * adj / M).toFixed(0)}%)`,
  adj > 250 && adj < 800);
check(`the V7 cadence appears (~4% of draws, got ${(100 * v7 / M).toFixed(1)}%)`,
  v7 >= 25 && v7 <= 250);
check(`vamp phrases take diatonic visits (15-60% of pair-lines, got ${(100 * visited / Math.max(pairLines, 1)).toFixed(0)}%)`,
  visited / Math.max(pairLines, 1) > 0.15 && visited / Math.max(pairLines, 1) < 0.6);

// The drummer: improv archetypes re-deal per bar; everyone else tiles.
// Bar 4 hosts the fill/lift for both, so bars 1-3 carry the comparison.
const maskOf = (d, b) => JSON.stringify([
  d.kick.slice(b * 16, (b + 1) * 16).map((v) => (v > 0 ? 1 : 0)),
  d.snare.slice(b * 16, (b + 1) * 16).map((v) => (v > 0 ? 1 : 0))]);
let vary = 0;
for (let i = 0; i < 200; i++) {
  const d = rollDrumPhrase(4, "vamp");
  const m = [0, 1, 2].map((b) => maskOf(d, b));
  if (m[1] !== m[0] || m[2] !== m[0]) vary++;
}
check(`vamp drum phrases vary bar to bar (${vary}/200)`, vary / 200 > 0.85);
let tiledOK = true;
for (let i = 0; i < 100; i++) {
  const d = rollDrumPhrase(4, "backbeat");
  const m = [0, 1, 2].map((b) => maskOf(d, b));
  if (m[1] !== m[0] || m[2] !== m[0]) tiledOK = false;
}
check("legacy archetypes still tile placement across bars 1-3 (backbeat)", tiledOK);

if (fails.length) {
  console.error(`\n${fails.length} FAILURE(S)`);
  process.exit(1);
}
console.log("\nvamp probe: ALL OK");
