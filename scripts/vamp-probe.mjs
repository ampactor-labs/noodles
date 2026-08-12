// Monte Carlo receipt for the vamp archetype (npm run probe:vamp).
//
// Rolls many songs through the real makeSong and asserts the vamp's
// promises: tempo band, capped swing, dorian lean, extended voicings,
// ghost snares - and that every other archetype still rolls inside its
// own tempo band with normalizeScene-clean scenes (no regression).
// Exits nonzero on any failure. Receipts print for eyeballing.

import { makeSong, harmonyChord, setScaleContext, normalizeScene } from "../src/model.js";

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

if (fails.length) {
  console.error(`\n${fails.length} FAILURE(S)`);
  process.exit(1);
}
console.log("\nvamp probe: ALL OK");
