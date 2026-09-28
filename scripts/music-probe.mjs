// What does the dice actually deal? (npm run probe:music)
//
// Rolls thousands of songs straight from src/model.js (pure data and theory,
// no browser) and measures the notes: which chords land in which slots, how
// the pad voices them, where the bass and the melody sit against the pad, and
// how often a note rubs a semitone against a chord tone that is sounding with
// it. It prints evidence and asserts nothing; read it before and after
// touching the dice, the ladder, or the voicing, the way calibrate is read for
// levels.
//
// Usage: npm run probe:music [-- --n 4000] [-- --seed 7]

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
};
const N = arg("n", 4000);
let seed = arg("seed", 7) >>> 0;
Math.random = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
// Imported only now: model.js takes its random source when it loads (const
// rnd = Math.random), and a static import is hoisted above the seeding.
const M = await import("../src/model.js");

const n12 = (v) => ((v % 12) + 12) % 12;
const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) + "%" : "-");
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const quant = (xs, q) => {
  if (!xs.length) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

// The pad's heard notes for one harmony slot, exactly as playback voices them
// (model.chordVoicing is the one voicing both audio.js and this probe run).
// Builds from before the voicing moved into the model stacked the color tones
// over the led triad; that is reproduced here so an old checkout can be read
// with the same ruler.
const chordVoicing =
  M.chordVoicing ||
  ((entry, vstate) => {
    const ch = M.harmonyChord(entry);
    const voiced = M.voiceLead(ch.pcs.slice(0, 3), vstate.prev);
    vstate.prev = voiced;
    const notes = voiced.slice();
    let top = Math.max(...voiced);
    for (const pc of ch.pcs.slice(3)) {
      const n = pc + 12 * Math.ceil((top + 1 - pc) / 12);
      notes.push(n);
      top = n;
    }
    return { notes, top, bass: ch.bass ?? ch.pcs[0] };
  });
const voice = (entry, vstate, oct) => {
  const v = chordVoicing(entry, vstate);
  return { notes: v.notes.map((m) => m + 12 * oct), halo: v.top + 12 + 12 * oct, root: 48 + v.bass, bassPc: v.bass };
};

const stats = {
  songs: 0,
  slots: 0,
  dimSlots: 0,
  songsWithDim: 0,
  startsHome: 0,
  borrowed: 0,
  extSlots: 0,
  voicings: 0,
  voicingsWithSemitone: 0, // two pad voices a semitone or a minor 9th apart
  voicingsWithM9: 0,
  padSpan: [],
  padLow: [],
  padTop: [],
  topLeaps: [],
  bassNotes: 0,
  bassOct1: 0,
  bassRootMatch: 0,
  bassDownbeats: 0,
  bassChordTone: 0,
  bassBelowPadGap: [],
  melNotes: 0,
  melBelowPadTop: 0,
  melUnderPadLow: 0,
  melClashWeighted: 0,
  melWeight: 0,
  melLongNonChord: 0,
  melLong: 0,
  melStrongChordTone: 0,
  melStrong: 0,
  melLeaps: [],
  melRange: [],
  distinctChords: [],
  byScale: {},
  qualityBySlot: [{}, {}, {}, {}],
  families: {},
};

const quality = (entry) => {
  const ch = M.harmonyChord(entry);
  const r = (x) => n12(ch.pcs[x] - ch.pcs[0]);
  const t = r(1);
  const f = r(2);
  if (t === 4 && f === 7) return "maj";
  if (t === 3 && f === 7) return "min";
  if (t === 3 && f === 6) return "dim";
  if (t === 4 && f === 8) return "aug";
  return "sus";
};

for (let i = 0; i < N; i++) {
  const song = M.makeSong();
  M.setScaleContext(song.key, song.scale);
  stats.songs += 1;
  const sc = song.scenes[0];
  const H = sc.harmony;
  const bs = (stats.byScale[song.scale] ||= { songs: 0, dim: 0 });
  bs.songs += 1;
  let hasDim = false;
  const distinct = new Set(H.map((e) => JSON.stringify(e)));
  stats.distinctChords.push(distinct.size);
  if (typeof H[0] === "number" ? H[0] === 0 : M.harmonyChord(H[0]).pcs[0] === song.key) stats.startsHome += 1;
  const vstate = { prev: null };
  const oct = sc.harmonyOct || 0;
  const voicings = [];
  // two passes so the loop's wrap is voice-led like playback's second cycle
  for (let pass = 0; pass < 2; pass++) {
    H.forEach((e, idx) => {
      const v = voice(e, vstate, oct);
      if (pass === 1) voicings[idx] = v;
    });
  }
  H.forEach((e, idx) => {
    stats.slots += 1;
    const q = quality(e);
    stats.qualityBySlot[Math.min(3, idx)][q] = (stats.qualityBySlot[Math.min(3, idx)][q] || 0) + 1;
    if (q === "dim") {
      stats.dimSlots += 1;
      hasDim = true;
    }
    if (typeof e !== "number") {
      const ch = M.harmonyChord(e);
      if (ch.degree < 0) stats.borrowed += 1;
      if (ch.pcs.length > 3) stats.extSlots += 1;
    }
    const v = voicings[idx];
    stats.voicings += 1;
    const ns = v.notes.slice().sort((a, b) => a - b);
    let semi = false;
    let m9 = false;
    for (let a = 0; a < ns.length; a++) {
      for (let b = a + 1; b < ns.length; b++) {
        const d = ns[b] - ns[a];
        if (d % 12 === 1) semi = true;
        if (d > 12 && d % 12 === 1) m9 = true;
      }
    }
    if (semi) stats.voicingsWithSemitone += 1;
    if (m9) stats.voicingsWithM9 += 1;
    stats.padSpan.push(ns[ns.length - 1] - ns[0]);
    stats.padLow.push(ns[0]);
    stats.padTop.push(ns[ns.length - 1]);
    const prev = voicings[(idx + H.length - 1) % H.length];
    stats.topLeaps.push(Math.abs(Math.max(...v.notes) - Math.max(...prev.notes)));
  });
  if (hasDim) {
    stats.songsWithDim += 1;
    bs.dim += 1;
  }
  const famKey = song.vibe?.groove;
  stats.families[famKey] = (stats.families[famKey] || 0) + 1;

  // Bass against the bar's chord.
  const barOf = (step, steps) => Math.floor((step % steps) / 16) % Math.max(1, Math.ceil(H.length / (sc.harmonyRate === 2 ? 2 : 1)));
  const bassSteps = M.stepsFor(sc, "bass");
  for (let s = 0; s < 64; s++) {
    const slot = sc.bass[s % bassSteps];
    for (const n of M.noteSlot(slot)) {
      const bar = Math.floor(s / 16) % H.length;
      const ch = M.harmonyChord(H[bar]);
      stats.bassNotes += 1;
      if (n.midi < 36) stats.bassOct1 += 1;
      if (ch.pcs.map(n12).includes(n12(n.midi))) stats.bassChordTone += 1;
      if (s % 16 === 0) {
        stats.bassDownbeats += 1;
        if (n12(n.midi) === n12(ch.bass ?? ch.pcs[0])) stats.bassRootMatch += 1;
      }
      stats.bassBelowPadGap.push(Math.min(...voicings[bar].notes) - n.midi);
    }
  }
  void barOf;

  // Melody against the pad that sounds under it.
  const melSteps = M.stepsFor(sc, "melody");
  let prevMel = null;
  const mels = [];
  for (let s = 0; s < 64; s++) {
    const slot = sc.melody[s % melSteps];
    for (const n of M.noteSlot(slot)) {
      const bar = Math.floor(s / 16) % H.length;
      const v = voicings[bar];
      const ch = M.harmonyChord(H[bar]);
      const len = n.len || 1;
      mels.push(n.midi);
      stats.melNotes += 1;
      if (n.midi < Math.max(...v.notes)) stats.melBelowPadTop += 1;
      if (n.midi < Math.min(...v.notes)) stats.melUnderPadLow += 1;
      // a minor second or minor ninth (any octave) against a sounding pad
      // voice or the halo, weighted by how long the note holds. A major
      // seventh is a color, not a rub, and isn't counted.
      const sounding = [...v.notes, v.halo];
      const clash = sounding.some((p) => Math.abs(p - n.midi) % 12 === 1);
      stats.melWeight += len;
      if (clash) stats.melClashWeighted += len;
      const tone = ch.pcs.map(n12).includes(n12(n.midi));
      if (len >= 4) {
        stats.melLong += 1;
        if (!tone) stats.melLongNonChord += 1;
      }
      if (s % 4 === 0) {
        stats.melStrong += 1;
        if (tone) stats.melStrongChordTone += 1;
      }
      if (prevMel != null) stats.melLeaps.push(Math.abs(n.midi - prevMel));
      prevMel = n.midi;
    }
  }
  if (mels.length) stats.melRange.push(Math.max(...mels) - Math.min(...mels));
}

const S = stats;
console.log(`\n== ${S.songs} rolled songs (seed ${arg("seed", 7)}), scene A ==`);
console.log(`harmony`);
console.log(`  diminished triad in a slot       ${pct(S.dimSlots, S.slots)} of slots, ${pct(S.songsWithDim, S.songs)} of songs`);
for (const [sc, b] of Object.entries(S.byScale)) console.log(`    ${sc.padEnd(11)} ${pct(b.dim, b.songs)} of ${b.songs} songs hold a dim chord`);
console.log(`  phrase opens on the tonic         ${pct(S.startsHome, S.songs)}`);
console.log(`  distinct chords per phrase        mean ${mean(S.distinctChords).toFixed(2)}  (1: ${pct(S.distinctChords.filter((x) => x === 1).length, S.songs)}, 2: ${pct(S.distinctChords.filter((x) => x === 2).length, S.songs)})`);
console.log(`  borrowed (violet) slots           ${pct(S.borrowed, S.slots)}`);
console.log(`  stacked (7/9/...) slots           ${pct(S.extSlots, S.slots)}`);
S.qualityBySlot.forEach((q, i) => console.log(`  slot ${i + 1} quality  ${Object.entries(q).map(([k, v]) => `${k} ${pct(v, S.songs)}`).join("  ")}`));
console.log(`pad voicing`);
console.log(`  voicings with a semitone rub     ${pct(S.voicingsWithSemitone, S.voicings)}  (minor 9th: ${pct(S.voicingsWithM9, S.voicings)})`);
console.log(`  span (semitones)                 median ${quant(S.padSpan, 0.5)}  p90 ${quant(S.padSpan, 0.9)}  max ${Math.max(...S.padSpan)}`);
console.log(`  lowest voice (midi)              p10 ${quant(S.padLow, 0.1)}  median ${quant(S.padLow, 0.5)}  p90 ${quant(S.padLow, 0.9)}`);
console.log(`  top voice (midi)                 p10 ${quant(S.padTop, 0.1)}  median ${quant(S.padTop, 0.5)}  p90 ${quant(S.padTop, 0.9)}`);
console.log(`  top-voice move per change        median ${quant(S.topLeaps, 0.5)}  p90 ${quant(S.topLeaps, 0.9)}  ≥5 st: ${pct(S.topLeaps.filter((x) => x >= 5).length, S.topLeaps.length)}`);
console.log(`bass`);
console.log(`  notes below C2 (midi 36)         ${pct(S.bassOct1, S.bassNotes)}`);
console.log(`  downbeat plays the chord's bass  ${pct(S.bassRootMatch, S.bassDownbeats)}`);
console.log(`  any note a chord tone            ${pct(S.bassChordTone, S.bassNotes)}`);
console.log(`  gap to the pad's lowest voice    median ${quant(S.bassBelowPadGap, 0.5)}  p10 ${quant(S.bassBelowPadGap, 0.1)} st`);
console.log(`melody`);
console.log(`  notes under the pad's top voice  ${pct(S.melBelowPadTop, S.melNotes)}  (under its lowest: ${pct(S.melUnderPadLow, S.melNotes)})`);
console.log(`  semitone rub vs pad/halo         ${pct(S.melClashWeighted, S.melWeight)} of note-time`);
console.log(`  long notes (≥ a beat) off-chord  ${pct(S.melLongNonChord, S.melLong)}`);
console.log(`  on-beat notes that are chord tones ${pct(S.melStrongChordTone, S.melStrong)}`);
console.log(`  leaps                            median ${quant(S.melLeaps, 0.5)}  p90 ${quant(S.melLeaps, 0.9)}  > octave: ${pct(S.melLeaps.filter((x) => x > 12).length, S.melLeaps.length)}`);
console.log(`  phrase range                     median ${quant(S.melRange, 0.5)}  p90 ${quant(S.melRange, 0.9)} st`);

// --- The deal: what one press of the dice hands you, whole. ---------------
// Everything above reads scene A's notes. This reads the roll as a user
// meets it: how many scenes arrive and whether any of them moves on by
// itself, how far B travels from A, whether the bass plays with the kick,
// where the melody leaves its phrase, and how wide the space of songs is.
// Same seed, so these are the same songs.
seed = arg("seed", 7) >>> 0;
const D = {
  songs: 0,
  scenes: {},
  followSongs: 0,
  oneshotSongs: 0,
  strayTags: 0,
  pairs: 0,
  bSameLine: 0,
  bSameSet: 0,
  bSameOpen: 0,
  bShared: [],
  bassOnsets: 0,
  bassOnKick: 0,
  kicks: 0,
  kicksWithBass: 0,
  lockByGroove: {},
  endings: 0,
  endChordTone: 0,
  endHome: 0,
  endStable: 0,
  melPerBar: {},
  melPerSec: [],
  progressions: new Map(),
  combos: new Set(),
  axes: { groove: {}, scale: {}, comp: {}, melodyChar: {}, polymeter: {}, ride: {} },
  compHire: {},
  melHire: {},
};
const bump = (o, k) => (o[k] = (o[k] || 0) + 1);
const entropy = (o) => {
  const n = Object.values(o).reduce((a, b) => a + b, 0);
  return -Object.values(o).reduce((h, c) => h + (c / n) * Math.log2(c / n), 0);
};
const chordKey = (e) => {
  const ch = M.harmonyChord(e);
  return `${ch.roman}`;
};
for (let i = 0; i < N; i++) {
  const song = M.makeSong();
  M.setScaleContext(song.key, song.scale);
  D.songs += 1;
  bump(D.scenes, song.scenes.length);
  const launches = song.scenes.flatMap((sc) => Object.values(sc.launch || {}));
  if (launches.some((l) => l.follow && l.follow !== "none")) D.followSongs += 1;
  if (launches.some((l) => l.mode === "oneshot")) D.oneshotSongs += 1;
  if (song.scenes.some((sc) => !String(sc.tag).startsWith("✨"))) D.strayTags += 1;
  const v = song.vibe;
  const A = song.scenes[0];
  const line = A.harmony.map(chordKey).join(" ");
  D.progressions.set(line, (D.progressions.get(line) || 0) + 1);
  for (const k of Object.keys(D.axes)) bump(D.axes[k], String((k === "scale" ? song.scale : v[k]) ?? "-"));
  D.combos.add([v.groove, song.scale, v.comp, v.melodyChar, line].join("|"));
  bump(D.compHire, `${v.comp}+${v.hires?.harmony || "any"}`);
  bump(D.melHire, `${v.melodyChar}+${v.hires?.melody || "any"}`);
  if (song.scenes.length > 1) {
    const B = song.scenes[1];
    D.pairs += 1;
    const la = A.harmony.map(chordKey);
    const lb = B.harmony.map(chordKey);
    if (la.join() === lb.join()) D.bSameLine += 1;
    const sa = new Set(la);
    const sb = new Set(lb);
    if (sa.size === sb.size && [...sa].every((x) => sb.has(x))) D.bSameSet += 1;
    if (la[0] === lb[0]) D.bSameOpen += 1;
    D.bShared.push([...sb].filter((x) => sa.has(x)).length / sb.size);
  }
  // Bass against kick, over A's four bars.
  const bassSteps = M.stepsFor(A, "bass");
  const drumSteps = M.stepsFor(A, "drums");
  const g = (D.lockByGroove[v.groove] ||= { on: 0, n: 0 });
  for (let s = 0; s < 64; s++) {
    const kick = A.drums.kick[s % drumSteps] > 0;
    const bass = M.noteSlot(A.bass[s % bassSteps]).length > 0;
    if (kick) D.kicks += 1;
    if (bass) {
      D.bassOnsets += 1;
      g.n += 1;
    }
    if (kick && bass) {
      D.bassOnKick += 1;
      D.kicksWithBass += 1;
      g.on += 1;
    }
  }
  // The melody's last note before the loop comes round (A, four-bar lanes).
  const melSteps = M.stepsFor(A, "melody");
  if (melSteps === 64) {
    let last = null;
    let lastStep = -1;
    let count = 0;
    for (let s = 0; s < 64; s++) {
      for (const n of M.noteSlot(A.melody[s])) {
        last = n;
        lastStep = s;
        count += 1;
      }
    }
    if (last) {
      const bar = Math.floor(lastStep / 16) % A.harmony.length;
      const ch = M.harmonyChord(A.harmony[bar]);
      const pc = n12(last.midi);
      D.endings += 1;
      if (ch.pcs.map(n12).includes(pc)) D.endChordTone += 1;
      if (pc === n12(song.key)) D.endHome += 1;
      // stable: root, third or fifth of the home triad
      const home = M.harmonyChord(0).pcs.map(n12);
      if (home.includes(pc)) D.endStable += 1;
    }
    (D.melPerBar[v.melodyChar] ||= []).push(count / 4);
    D.melPerSec.push(count / ((4 * 240) / song.tempo));
  }
}
const top = [...D.progressions.entries()].sort((a, b) => b[1] - a[1]);
const top10 = top.slice(0, 10).reduce((s, [, c]) => s + c, 0);
console.log(`\n== the deal: ${D.songs} rolls, whole ==`);
console.log(`structure`);
console.log(`  scenes per roll                  ${Object.entries(D.scenes).map(([k, c]) => `${k}: ${pct(c, D.songs)}`).join("  ")}`);
console.log(`  rolls with a follow action        ${pct(D.followSongs, D.songs)}   with a one-shot ${pct(D.oneshotSongs, D.songs)}`);
console.log(`  rolls with a scene not tagged ✨  ${pct(D.strayTags, D.songs)}`);
console.log(`B against A (${D.pairs} rolls with a B)`);
console.log(`  same four chords, same order      ${pct(D.bSameLine, D.pairs)}`);
console.log(`  same chords, any order            ${pct(D.bSameSet, D.pairs)}`);
console.log(`  opens on A's first chord          ${pct(D.bSameOpen, D.pairs)}`);
console.log(`  B's chords also in A              mean ${(100 * mean(D.bShared)).toFixed(0)}%`);
console.log(`bass and kick (A)`);
console.log(`  bass onsets on a kick             ${pct(D.bassOnKick, D.bassOnsets)}   kicks with a bass note ${pct(D.kicksWithBass, D.kicks)}`);
console.log(`  by groove (onsets on a kick)      ${Object.entries(D.lockByGroove).map(([k, x]) => `${k} ${pct(x.on, x.n)}`).join("  ")}`);
console.log(`melody phrase (A, four-bar lanes)`);
console.log(`  last note a tone of its chord     ${pct(D.endChordTone, D.endings)}   the tonic ${pct(D.endHome, D.endings)}   home triad ${pct(D.endStable, D.endings)}`);
console.log(`  notes per bar                     ${Object.entries(D.melPerBar).map(([k, xs]) => `${k} ${mean(xs).toFixed(1)}`).join("  ")}`);
console.log(`  notes per second                  median ${quant(D.melPerSec, 0.5).toFixed(1)}  p90 ${quant(D.melPerSec, 0.9).toFixed(1)}`);
console.log(`possibility space`);
console.log(`  distinct A progressions           ${top.length} (top 10 carry ${pct(top10, D.songs)})`);
console.log(`  most dealt                        ${top.slice(0, 5).map(([l, c]) => `${l} ${pct(c, D.songs)}`).join(" · ")}`);
console.log(`  distinct groove/mode/comp/singer/progression  ${D.combos.size} in ${D.songs}`);
console.log(`  entropy (bits)                    ${Object.entries(D.axes).map(([k, o]) => `${k} ${entropy(o).toFixed(2)}`).join("  ")}`);
console.log(`  comp + harmony hire               ${Object.entries(D.compHire).sort((a, b) => b[1] - a[1]).map(([k, c]) => `${k} ${pct(c, D.songs)}`).join("  ")}`);
console.log(`  singer + melody hire              ${Object.entries(D.melHire).sort((a, b) => b[1] - a[1]).map(([k, c]) => `${k} ${pct(c, D.songs)}`).join("  ")}`);
