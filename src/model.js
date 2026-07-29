// Music + song model. No rendering, no audio — just the data and the theory.

// Seven diatonic triads of C major, colored by FUNCTION family (tonic greens /
// subdominant blues / dominant ambers), lightness varied so each stays distinct.
// pcs[0] is always the root pitch class.
// Seven-note scales. The seven diatonic triads are derived from the current
// key + scale, so the whole app is "scale aware" (Ableton Live 12 style).
export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
};
export const SCALE_NAMES = Object.keys(SCALES);
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];
const DEGREE_HUE = [150, 224, 138, 204, 36, 166, 8];
const PC_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const pcName = (pc) => PC_NAMES[((pc % 12) + 12) % 12];

// --- The circle of fifths: station geometry and key signatures ---
// Stations are fixed forever: station 0 is C at twelve o'clock, +1 is a fifth
// clockwise. Multiplying by 7 maps pc -> station, and because 7·7 ≡ 1 (mod
// 12), the SAME multiplication maps station -> pc. One function, two names.
export const stationOfPc = (pc) => ((((pc % 12) + 12) % 12) * 7) % 12;
export const pcOfStation = stationOfPc;

// Fixed station names, poster convention: the sharp side spells sharp, the
// flat side flat, the seam at station 6 answers to both. Lowercase minors —
// case is quality, the same convention the roman numerals already teach.
export const STATION_MAJOR = ["C", "G", "D", "A", "E", "B", "F♯", "D♭", "A♭", "E♭", "B♭", "F"];
export const STATION_MINOR = ["a", "e", "b", "f♯", "c♯", "g♯", "d♯", "b♭", "f", "c", "g", "d"];
// The order accidentals arrive as you walk the circle — not a mnemonic, the
// circle itself read from F (sharps) and from B (flats).
export const SHARP_ORDER = ["F♯", "C♯", "G♯", "D♯", "A♯", "E♯"];
export const FLAT_ORDER = ["B♭", "E♭", "A♭", "D♭", "G♭", "C♭"];

// Every 7-note mode is a rotation of major, so its pitch content IS some
// major key's content. The offset from a mode's tonic up to that relative
// major is derived from SCALES itself rather than tabled — one source.
const REL_MAJOR_OFFSET = Object.fromEntries(
  Object.entries(SCALES).map(([name, iv]) => [
    name,
    iv.find((x) => {
      const rot = iv.map((v) => (v - x + 12) % 12).sort((a, b) => a - b);
      return rot.every((v, i) => v === SCALES.major[i]);
    }) ?? 0,
  ])
);
export const relMajorOffset = (scaleName) => REL_MAJOR_OFFSET[scaleName] ?? 0;
export const relMajorPc = (pc, scaleName) => ((((pc % 12) + 12) % 12) + relMajorOffset(scaleName)) % 12;

// Signature as a signed count: positive sharps, negative flats, +6 for the
// F♯/G♭ seam by convention. A key's signature is just its station.
export function keySignature(pc, scaleName) {
  const s = stationOfPc(relMajorPc(pc, scaleName));
  return s <= 6 ? s : s - 12;
}

// The key's honest name: spell by which side of the circle its signature
// lives on (E♭ dorian, not D♯ dorian). pcName stays the chromatic namer for
// debug; every UI name flows through the spelled paths below.
const SHARP_PC = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const FLAT_PC = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];
export function keyDisplayName(pc, scaleName) {
  const i = ((pc % 12) + 12) % 12;
  return keySignature(pc, scaleName) < 0 ? FLAT_PC[i] : SHARP_PC[i];
}

// What is this chord to me, from where I stand? Interval up from home tonic
// to the chord root, as a roman numeral — lowercase when the chord is minor.
const INTERVAL_ROMAN = ["I", "♭II", "II", "♭III", "III", "IV", "♭V", "V", "♭VI", "VI", "♭VII", "VII"];
export function romanFromHome(homePc, pc, minor = false) {
  const r = INTERVAL_ROMAN[(((pc - homePc) % 12) + 12) % 12];
  return minor ? r.toLowerCase() : r;
}

// Semitones from degree d's root up to the scale tone `steps` scale-steps
// above it — the diatonic extension interval (7th = 6 steps, 9th = 8), which
// is what makes one "7" pad come out maj7 on I and dominant on V.
export function degreeStepSemis(d, steps) {
  const sc = SCALES[curScale];
  const t = d + steps;
  return sc[t % 7] + 12 * Math.floor(t / 7) - sc[d % 7];
}

// How many pitch classes two chords share — the trail's line weight.
export function sharedPcCount(a, b) {
  const s = new Set(a.map((p) => ((p % 12) + 12) % 12));
  return b.reduce((n, p) => n + (s.has(((p % 12) + 12) % 12) ? 1 : 0), 0);
}

// --- Spelling: every scale degree gets its own letter ---
// A key signature is a promise about letters: seven degrees, seven letters,
// in order from the tonic's. F♯ major runs F♯ G♯ A♯ B C♯ D♯ E♯ — the seventh
// degree is E♯, not F, because F is already taken. Degree spelling is letter
// arithmetic: the d-th degree's letter is d letters past the tonic's, and the
// accidental is whatever closes the gap to the actual pitch class. SPELLED is
// rebuilt with CHORDS on every key/scale change.
const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
const NATURAL_PC = [0, 2, 4, 5, 7, 9, 11];
const accGlyphs = (n) => (n > 0 ? "♯".repeat(n) : "♭".repeat(-n));
let SPELLED = []; // per degree: { letter, acc, pc, name }

function rebuildSpelling() {
  const tonicLetter = LETTERS.indexOf(keyDisplayName(curKey, curScale)[0]);
  SPELLED = SCALES[curScale].map((off, d) => {
    const li = (tonicLetter + d) % 7;
    const pc = (curKey + off) % 12;
    const acc = ((pc - NATURAL_PC[li]) % 12 + 18) % 12 - 6;
    return { letter: li, acc, pc, name: LETTERS[li] + accGlyphs(acc) };
  });
}

// The honest name of a pitch class here: its degree spelling when it is in
// the scale, the signature side's spelling when it is a visitor.
export function spellScalePc(pc) {
  const p = ((pc % 12) + 12) % 12;
  const deg = SPELLED.find((s) => s.pc === p);
  if (deg) return deg.name;
  return keySignature(curKey, curScale) < 0 ? FLAT_PC[p] : SHARP_PC[p];
}
// The staff needs the letter and accidental, not just the string.
export function spelledDegree(d) {
  return SPELLED[((d % 7) + 7) % 7];
}
export const scaleDegreeOfPc = (pc) => SPELLED.findIndex((s) => s.pc === (((pc % 12) + 12) % 12));

// A single pitch spelled for a staff: in-scale notes wear their degree
// letter, visitors the signature side's. `step` is the diatonic staff index
// (letter plus its octave run), the unit the staves draw in — E♯4 shares
// E4's step because the letter owns the line.
export function spellPitch(midi) {
  const p = ((midi % 12) + 12) % 12;
  const deg = SPELLED.find((s) => s.pc === p);
  let letter;
  let acc;
  if (deg) {
    letter = deg.letter;
    acc = deg.acc;
  } else {
    const name = keySignature(curKey, curScale) < 0 ? FLAT_PC[p] : SHARP_PC[p];
    letter = LETTERS.indexOf(name[0]);
    acc = name.length > 1 ? (name[1] === "♯" ? 1 : -1) : 0;
  }
  return { letter, acc, step: Math.floor((midi - acc) / 12) * 7 + letter };
}

// A triad's tones spelled for engraving: thirds stack in letters, so the
// third is two letters up from the root and the fifth four, with whatever
// accidental closes each gap. The root's letter comes from harmonyChord's
// own name, which already spells diatonic roots by degree and borrowed
// roots by function — so C♯dim engraves C♯ E G and the ♭VI of C engraves
// A♭ C E♭, never G♯ B♯ D♯.
export function spellChordTones(entry) {
  const ch = harmonyChord(entry);
  const li0 = LETTERS.indexOf(ch.name[0]);
  // The interval decides the letter distance — a 7th is six letters up, a
  // 9th one, a 4th three — so sus tones and extensions engrave on their own
  // lines. The triad's tritone fifth stays a diminished fifth (four letters).
  const LETTER_OF_SEMIS = [0, 1, 1, 2, 2, 3, 3, 4, 5, 5, 6, 6];
  return ch.pcs.map((pc, i) => {
    const semis = (((pc - ch.pcs[0]) % 12) + 12) % 12;
    let off = i === 0 ? 0 : LETTER_OF_SEMIS[semis];
    if (i === 2 && semis === 6) off = 4;
    const letter = (li0 + off) % 7;
    const acc = ((pc - NATURAL_PC[letter]) % 12 + 18) % 12 - 6;
    return { letter, acc, pc };
  });
}
// What the key signature already promises for a letter: +1 inside the first
// n sharps, −1 inside the first n flats, 0 otherwise. An accidental prints
// only when a tone breaks the promise — including the natural that cancels.
const SIG_SHARP_LETTERS = [3, 0, 4, 1, 5, 2, 6]; // F C G D A E B as letter indices
const SIG_FLAT_LETTERS = [6, 2, 5, 1, 4, 0, 3]; // B E A D G C F
export function signatureAccFor(letterIdx, sig) {
  if (sig > 0) return SIG_SHARP_LETTERS.slice(0, sig).includes(letterIdx) ? 1 : 0;
  if (sig < 0) return SIG_FLAT_LETTERS.slice(0, -sig).includes(letterIdx) ? -1 : 0;
  return 0;
}

let curKey = 0;
let curScale = "major";
export let CHORDS = []; // live binding; importers see rebuilds

function rebuildChords() {
  rebuildSpelling(); // chord names ride the degree letters
  const sc = SCALES[curScale];
  CHORDS = [];
  for (let d = 0; d < 7; d++) {
    const semis = [d, d + 2, d + 4].map((i) => sc[i % 7] + 12 * Math.floor(i / 7));
    const pcs = semis.map((s) => (((curKey + s) % 12) + 12) % 12);
    const third = semis[1] - semis[0];
    const fifth = semis[2] - semis[0];
    const rn = ROMAN[d];
    let roman;
    let suffix;
    if (third === 4 && fifth === 7) { roman = rn; suffix = ""; }
    else if (third === 3 && fifth === 7) { roman = rn.toLowerCase(); suffix = "m"; }
    else if (third === 3 && fifth === 6) { roman = rn.toLowerCase() + "°"; suffix = "dim"; }
    else if (third === 4 && fifth === 8) { roman = rn + "+"; suffix = "aug"; }
    else { roman = rn.toLowerCase(); suffix = ""; }
    CHORDS.push({ roman, name: SPELLED[d].name + suffix, pcs, degree: d, hue: DEGREE_HUE[d], sat: 56, light: 56 });
  }
}
export function setScaleContext(key, scaleName) {
  curKey = ((key % 12) + 12) % 12;
  if (SCALES[scaleName]) curScale = scaleName;
  rebuildChords();
}
setScaleContext(0, "major");

// hsl -> 0xRRGGBB for CSS hex conversion.
export function hslInt(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (x) => Math.round(255 * x);
  return (to(f(0)) << 16) | (to(f(8)) << 8) | to(f(4));
}

export const chordColor = (ci, dl = 0) =>
  hslInt(CHORDS[ci].hue, CHORDS[ci].sat, Math.max(0, Math.min(100, CHORDS[ci].light + dl)));

// --- Harmony entries: a slot holds a scale degree OR a borrowed chord ---
// scene.harmony spoke only degree indices for its whole life, which is what
// made the palette can't-make-it-wrong — and what made a borrowed chord
// unstorable. An entry is now `0..6` (diatonic, follows the key for free) or
// `{ pcs: [root, third, fifth] }` (chromatic — the circle writes those). The
// key-change path transposes borrowed pcs alongside bass and melody, so a
// ♭VI stays a ♭VI when the song travels. harmonyChord() resolves either
// shape into the same CHORDS-shaped object, so playback, minis, and editors
// never care which kind they hold. Borrowed chords wear one off-palette
// violet: not from here, visibly.
const BORROWED = { hue: 285, sat: 24, light: 60 };
export function normalizeHarmonyEntry(e) {
  if (typeof e === "number" && Number.isFinite(e)) return Math.max(0, Math.min(6, Math.round(e)));
  // Three pcs are a triad; stacked thirds beyond run 7-9-11-13, seven tones
  // at the full 13th. `inv` picks the bass tone (a slash chord) from the
  // first four — third inversion is as far as the notation goes.
  const pcs = Array.isArray(e?.pcs) ? e.pcs.slice(0, 7).map((p) => ((Math.round(Number(p) || 0) % 12) + 12) % 12) : null;
  if (!pcs || pcs.length < 3) return 0;
  const out = { pcs };
  const inv = Math.round(Number(e.inv) || 0);
  if (inv > 0) out.inv = Math.min(inv, Math.min(3, pcs.length - 1));
  return out;
}
export const normalizeHarmony = (arr) => (Array.isArray(arr) && arr.length ? arr.map(normalizeHarmonyEntry) : [0, 0, 0, 0]);
export const harmonyEntryEquals = (a, b) =>
  typeof a === "number" || typeof b === "number"
    ? a === b
    : !!a?.pcs && !!b?.pcs && a.pcs.join() === b.pcs.join() && (a.inv || 0) === (b.inv || 0);

export function harmonyChord(entry) {
  if (typeof entry === "number") return CHORDS[Math.max(0, Math.min(6, entry | 0))];
  const pcs = entry?.pcs;
  if (!pcs?.length) return CHORDS[0];
  const rel = (v) => (((v - pcs[0]) % 12) + 12) % 12;
  const t = rel(pcs[1]);
  const f = rel(pcs[2]);
  const sus = t === 5 ? "sus4" : t <= 2 ? "sus2" : "";
  const dim = !sus && t === 3 && f === 6;
  const minor = !sus && t === 3 && !dim;
  // Stacked thirds name by their ceiling — a 9 chord CONTAINS the 7th, so
  // five tones say 9, six say 11, seven say 13; the 7th's quality picks the
  // family (maj9 vs 9 vs m9), and a lone stacked 2nd stays add9.
  let ext = "";
  if (pcs.length > 3) {
    const seventh = rel(pcs[3]);
    if (pcs.length === 4 && seventh <= 2) ext = "add9";
    else {
      const N = ["7", "9", "11", "13"][Math.min(3, pcs.length - 4)];
      if (dim) ext = (seventh === 9 ? "°" : "ø") + N;
      else if (seventh === 11) ext = "maj" + N;
      else ext = N;
      // Alterations, named off the actual intervals: the diatonic iii11 in
      // major carries a ♭9 and should say so; lydian's IV names its ♯11.
      if (pcs.length > 4) {
        const nine = rel(pcs[4]);
        if (nine === 1) ext += "♭9";
        else if (nine === 3) ext += "♯9";
      }
      if (pcs.length > 5 && rel(pcs[5]) === 6) ext += "♯11";
      if (pcs.length > 6 && rel(pcs[6]) === 8) ext += "♭13";
    }
  }
  const halfDim = ext.startsWith("ø") || ext.startsWith("°"); // ° moves into the suffix
  const inv = Math.min(entry.inv || 0, pcs.length - 1);
  const bass = pcs[inv];
  // The slash spells in the chord's own letters: C/E, A♭/C, G7/B.
  const slash = inv > 0 ? "/" + (() => {
    const li0 = LETTERS.indexOf((roman0(pcs, minor, dim) || "").includes("♭") ? FLAT_PC[pcs[0]][0] : spellScalePc(pcs[0])[0]);
    const off = [0, 2, 4, 6][inv];
    const letter = (li0 + off) % 7;
    const acc = ((bass - NATURAL_PC[letter]) % 12 + 18) % 12 - 6;
    return LETTERS[letter] + accGlyphs(acc);
  })() : "";
  // A diatonic triad under the stack keeps its degree's roman and function
  // color; only true visitors wear the violet.
  const d = sus ? -1 : CHORDS.findIndex((c) => c.pcs.join() === pcs.slice(0, 3).join());
  if (d >= 0) {
    const base = CHORDS[d];
    return {
      ...base,
      pcs,
      bass,
      roman: (halfDim ? base.roman.replace("°", "") : base.roman) + ext,
      name: (halfDim ? base.name.replace(/dim$/, "") : base.name) + ext + slash,
    };
  }
  const roman = romanFromHome(curKey, pcs[0], minor || dim) + (dim && !halfDim ? "°" : "") + (sus || ext);
  // A borrowed chord spells by its FUNCTION: the ♭VI of C is A♭, never G♯,
  // whatever side the home signature sits on.
  const root = roman.includes("♭") ? FLAT_PC[pcs[0]] : spellScalePc(pcs[0]);
  const suffix = (dim && !halfDim ? "dim" : minor ? "m" : "") + (sus || ext);
  return { roman, name: root + suffix + slash, pcs, bass, degree: -1, ...BORROWED };
}
// The roman's flatness decides the root letter before the full name exists.
function roman0(pcs, minor, dim) {
  return romanFromHome(curKey, pcs[0], minor || dim);
}

// --- The extension ladder as model arithmetic ---
// A rung names the whole stack up to its number (a 9 CONTAINS the 7th, an 11
// the 9th), stepped diatonically when the entry's triad sits on a scale
// degree and common-practice on visitors; sus4/sus2 swap the third instead
// of stacking. The wheel's bloom pads and the editor's voicing chips both
// speak this — one ladder, two surfaces.
export const LADDER_RUNGS = ["triad", "7", "9", "11", "13", "sus4", "sus2"];
const LADDER_STEPS = { 7: [6], 9: [6, 8], 11: [6, 8, 10], 13: [6, 8, 10, 12], sus4: [3], sus2: [1] };
const LADDER_CHROME = { 6: 10, 8: 14, 10: 17, 12: 21, 3: 5, 1: 2 };
export function ladderPcs(entry, rung) {
  const n12 = (v) => ((v % 12) + 12) % 12;
  const e = normalizeHarmonyEntry(entry);
  const base = typeof e === "number" ? CHORDS[e].pcs : e.pcs;
  const root = base[0];
  const susNow = base.length === 3 && [2, 5].includes(n12(base[1] - root));
  // Diatonic stepping needs the whole triad to be the degree's own — a
  // borrowed chord sharing a degree's root pc must not borrow its 7th too.
  const degAt = CHORDS.findIndex((c) => c.pcs[0] === root);
  const deg =
    degAt >= 0 && (susNow ? CHORDS[degAt].pcs[2] === base[2] : CHORDS[degAt].pcs.join() === base.slice(0, 3).join())
      ? degAt
      : -1;
  const semisOf = (st) => (deg >= 0 ? degreeStepSemis(deg, st) : LADDER_CHROME[st]);
  const third = susNow ? n12(root + (deg >= 0 ? degreeStepSemis(deg, 2) : 4)) : base[1];
  const fifth = base[2];
  const triad = [root, third, fifth];
  if (rung === "sus4" || rung === "sus2") return [root, n12(root + semisOf(LADDER_STEPS[rung][0])), fifth];
  const steps = LADDER_STEPS[rung];
  if (!steps) return triad; // "triad" and anything unknown
  return [...triad, ...steps.map((st) => n12(root + semisOf(st)))];
}
// The rung an entry currently sits on, for chip highlighting.
export function ladderRungOf(entry) {
  const e = normalizeHarmonyEntry(entry);
  if (typeof e === "number") return "triad";
  const n12 = (v) => ((v % 12) + 12) % 12;
  const t = n12(e.pcs[1] - e.pcs[0]);
  if (e.pcs.length === 3) return t === 5 ? "sus4" : t <= 2 ? "sus2" : "triad";
  return ["7", "9", "11", "13"][Math.min(3, e.pcs.length - 4)];
}

// --- Voice leading: keep common tones, move the rest by the smallest step. ---
const PERMS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
const nearestOctave = (pc, ref) => pc + 12 * Math.round((ref - pc) / 12);

// Minimal motion INSIDE a tessitura. Pure nearest-octave minimal motion has
// no register anchor: a looping progression with any net drift per cycle
// walks the voicing up or down the octaves forever (heard, reported, real —
// and a penalty can't fix it, because every nearest-octave candidate drifts
// along with the voicing it follows). So the candidates themselves are
// pinned: each tone may sit only at octave placements within ±9 semitones
// of the chord's home center, and the smoothest assignment from the
// previous voicing is chosen among those. Common tones still hold, steps
// still step, and the register cannot leave home by construction.
const VOICE_WINDOW = 9;
export function voiceLead(pcs, prev) {
  if (!prev) return pcs.map((pc) => 60 + pc);
  const center = pcs.reduce((a, pc) => a + 60 + pc, 0) / pcs.length;
  const options = pcs.map((pc) => {
    const opts = [];
    for (let m = pc + 48; m <= pc + 84; m += 12) {
      if (Math.abs(m - center) <= VOICE_WINDOW) opts.push(m);
    }
    return opts.length ? opts : [pc + 60];
  });
  let best = null;
  let bestCost = Infinity;
  for (const perm of PERMS) {
    // Try every in-window octave placement for this voice order.
    const o0 = options[perm[0]];
    const o1 = options[perm[1]];
    const o2 = options[perm[2]];
    for (const a of o0) {
      for (const b of o1) {
        for (const c of o2) {
          const cost = Math.abs(a - prev[0]) + Math.abs(b - prev[1]) + Math.abs(c - prev[2]);
          if (cost < bestCost) {
            bestCost = cost;
            best = [a, b, c];
          }
        }
      }
    }
  }
  return best;
}

// Pitch classes two chords share — the common tones that light up.
export function sharedTones(a, b) {
  const sa = new Set(CHORDS[a].pcs);
  return CHORDS[b].pcs.filter((pc) => sa.has(pc));
}

// --- Euclidean rhythm (Bjorklund): k pulses spread over n steps, evenly. ---
export function euclid(steps, pulses, rotation = 0) {
  steps = Math.max(1, steps | 0);
  pulses = Math.max(0, Math.min(steps, pulses | 0));
  if (pulses === 0) return new Array(steps).fill(false);
  // Bresenham-style even distribution — equivalent to Bjorklund for our purposes.
  const pat = new Array(steps).fill(false);
  let bucket = 0;
  for (let i = 0; i < steps; i++) {
    bucket += pulses;
    if (bucket >= steps) {
      bucket -= steps;
      pat[i] = true;
    }
  }
  // Rotate so an onset can be pulled onto beat 1.
  if (rotation) {
    const r = ((rotation % steps) + steps) % steps;
    return pat.slice(steps - r).concat(pat.slice(0, steps - r));
  }
  return pat;
}

// --- Song / Scene ---
// A Scene is a loop AND a song section. Harmony is one chord per bar; drums are
// a step-sequencer grid: one 16-step row per voice, a small drum rack.
export const DRUM_VOICES = ["kick", "snare", "hat", "clap"];
export const DRUM_META = {
  kick: { label: "kick", hue: 32, sat: 68, light: 62 },
  snare: { label: "snare", hue: 336, sat: 52, light: 68 },
  hat: { label: "hat", hue: 190, sat: 40, light: 76 },
  clap: { label: "clap", hue: 276, sat: 52, light: 72 },
};

export function cloneNoteSlot(slot) {
  if (!slot) return null;
  const notes = (Array.isArray(slot) ? slot : [slot])
    .filter((n) => n && Number.isFinite(Number(n.midi)))
    .map((n) => ({
      midi: Number(n.midi),
      len: Math.max(1, Math.min(16, Number(n.len) || 1)),
      vel: Math.max(0.05, Math.min(1, Number(n.vel) || 0.9)),
    }));
  return notes.length ? notes : null;
}

export function noteSlot(slot) {
  return Array.isArray(slot) ? slot : slot ? [slot] : [];
}

export function normalizeNoteLane(lane = null) {
  return Array.from({ length: 16 }, (_, i) => cloneNoteSlot(lane?.[i]));
}

// Drum steps are velocities (0 = off). Old projects stored booleans; coerce.
export function normalizeDrumLane(lane = null) {
  return Array.from({ length: 16 }, (_, i) => {
    const v = lane?.[i];
    if (v === true) return 0.9;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.max(0.05, Math.min(1, n)) : 0;
  });
}

// Motion lanes: per-track clip envelopes — a param name mapped to 16 values
// in 0..1, captured by performing on the sound pad while recording.
export function normalizeMotion(motion = null) {
  const out = {};
  for (const track of ARRANGE_TRACKS) {
    const lanes = motion?.[track];
    if (!lanes || typeof lanes !== "object") continue;
    const t = {};
    for (const [param, lane] of Object.entries(lanes)) {
      if (!Array.isArray(lane)) continue;
      // 1 to 4 bars of ride, in whole bars.
      const len = Math.max(16, Math.min(64, Math.floor(lane.length / 16) * 16));
      t[param] = Array.from({ length: len }, (_, i) => Math.max(0, Math.min(1, Number(lane[i]) || 0)));
    }
    if (Object.keys(t).length) out[track] = t;
  }
  return out;
}

// Per-clip step lengths (polymeter): drums/bass/melody lanes can loop early,
// 2..16 steps, phasing against the other tracks' cycles.
export const STEPPED_TRACKS = ["drums", "bass", "melody"];
export function normalizeSteps(steps = null) {
  const out = {};
  for (const t of STEPPED_TRACKS) {
    const n = Math.round(Number(steps?.[t]));
    out[t] = Number.isFinite(n) ? Math.max(2, Math.min(16, n)) : 16;
  }
  return out;
}
export const stepsFor = (scene, track) => scene?.steps?.[track] || 16;

export function normalizeScene(scene) {
  scene.harmony = Array.isArray(scene.harmony) ? scene.harmony.map(normalizeHarmonyEntry) : [];
  scene.melody = normalizeNoteLane(scene.melody);
  scene.bass = normalizeNoteLane(scene.bass);
  const drums = scene.drums || {};
  scene.drums = Object.fromEntries(DRUM_VOICES.map((v) => [v, normalizeDrumLane(drums[v])]));
  scene.motion = normalizeMotion(scene.motion);
  scene.steps = normalizeSteps(scene.steps);
  // ±1 only: at -2 the pad highpass (170 Hz) eats the voicings near-silent,
  // and a control whose extreme sounds broken is a hard wall in disguise.
  scene.harmonyOct = Math.max(-1, Math.min(1, Math.round(Number(scene.harmonyOct) || 0)));
  return scene;
}

let sceneSeq = 0;
const SCENE_TAGS = ["A", "B", "C", "D", "E", "F", "G", "H"];

export function makeScene(harmony, drums, melody = null, bass = null, motion = null, steps = null) {
  const tag = SCENE_TAGS[sceneSeq % SCENE_TAGS.length];
  sceneSeq += 1;
  const scene = {
    tag,
    harmony: harmony.map(normalizeHarmonyEntry),
    drums: Object.fromEntries(DRUM_VOICES.map((v) => [v, normalizeDrumLane(drums[v])])),
    // Bass and melody: per-step note stacks (or null) for scale-snapped chords.
    // Each note is { midi, len, vel }; old single-note slots normalize to stacks.
    melody: normalizeNoteLane(melody),
    bass: normalizeNoteLane(bass),
    motion: normalizeMotion(motion),
    steps: normalizeSteps(steps),
    harmonyOct: 0, // whole-clip octave for the chord track (piano lanes shift per note instead)
  };
  scene.launch = cloneLaunch();
  return scene;
}

export function defaultScene() {
  return makeMagicScene();
}

// --- The vibe: one coherent roll of groove, tempo, pocket, space, and spice.
// The dice used to roll uniform noise over one pattern archetype — the same
// band playing every song. Now it hires from archetypes (selection beats
// processing) and the noise lives INSIDE the archetype, so a roll grooves
// like a thing without playing the same thing twice.
const rnd = Math.random;
const rint = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const pickFrom = (arr) => arr[(rnd() * arr.length) | 0];
const dlane = (fill) => Array.from({ length: 16 }, (_, s) => fill(s) || 0);
function pickW(pairs) {
  let total = 0;
  for (const [, w] of pairs) total += w;
  let r = rnd() * total;
  for (const [v, w] of pairs) {
    r -= w;
    if (r <= 0) return v;
  }
  return pairs[pairs.length - 1][0];
}

// Groove archetypes: the drummer the dice hires. Each carries its roll
// weight, kick placement, hat grid, velocity personality, tempo band, pocket
// range, bass behavior weights, a melody-density hint, and the kits it likes
// to play. A voice an archetype sits out returns null — makeScene zero-fills
// missing lanes.
const GROOVES = {
  fourfloor: {
    weight: 22,
    tempo: [116, 130],
    swing: [0, 0.12],
    bass: [["offbeat8", 3], ["bounce", 2], ["roots", 1]],
    melodyGap: 0.55,
    kits: ["clean", "street", "funk"],
    drums() {
      const kick = dlane((s) => (s % 4 === 0 ? 0.92 + rnd() * 0.08 : 0));
      const snare = dlane((s) => (s === 4 || s === 12 ? 0.85 + rnd() * 0.1 : 0));
      const sixteens = rnd() < 0.35;
      const hat = dlane((s) => {
        if (s % 2 === 0) return (s % 4 === 2 ? 0.8 : 0.5) + rnd() * 0.15;
        return sixteens ? 0.35 + rnd() * 0.15 : 0;
      });
      const clap = rnd() < 0.5 ? dlane((s) => (s === 4 || s === 12 ? 0.7 + rnd() * 0.15 : 0)) : null;
      return { kick, snare, hat, clap };
    },
  },
  backbeat: {
    weight: 26,
    tempo: [84, 110],
    swing: [0.06, 0.22],
    bass: [["roots", 3], ["bounce", 1], ["offbeat8", 1]],
    melodyGap: 0.5,
    kits: ["funk", "warm", "street"],
    drums() {
      const kick = dlane((s) => {
        if (s === 0 || s === 8) return 0.9 + rnd() * 0.1;
        if ((s === 6 || s === 10 || s === 14) && rnd() < 0.3) return 0.6 + rnd() * 0.15;
        return 0;
      });
      const snare = dlane((s) => (s === 4 || s === 12 ? 0.85 + rnd() * 0.1 : 0));
      const hat = dlane((s) => {
        if (s % 2 === 0) return (s % 4 === 2 ? 0.8 : 0.55) + rnd() * 0.15;
        return rnd() < 0.15 ? 0.35 : 0;
      });
      const clap = dlane((s) => ((s === 6 || s === 14) && rnd() < 0.35 ? 0.6 + rnd() * 0.15 : 0));
      return { kick, snare, hat, clap };
    },
  },
  halftime: {
    weight: 18,
    tempo: [70, 92],
    swing: [0, 0.15],
    bass: [["drone", 3], ["roots", 2]],
    melodyGap: 0.65,
    kits: ["808", "heavy", "dusty"],
    drums() {
      // One pickup, chosen once — a per-step coin here fires 7 AND 10.
      const pickup = rnd() < 0.7 ? (rnd() < 0.5 ? 7 : 10) : -1;
      const kick = dlane((s) => (s === 0 ? 1 : s === pickup ? 0.75 + rnd() * 0.15 : 0));
      const snare = dlane((s) => (s === 8 ? 0.95 : 0));
      const rolls = rnd() < 0.5;
      const hat = dlane((s) => {
        if (rolls) return s % 2 === 1 ? 0.3 + rnd() * 0.2 : 0.55 + rnd() * 0.25;
        return s % 2 === 0 ? 0.5 + rnd() * 0.2 : 0;
      });
      const clap = rnd() < 0.6 ? dlane((s) => (s === 8 ? 0.7 : 0)) : null;
      return { kick, snare, hat, clap };
    },
  },
  twostep: {
    weight: 16,
    tempo: [118, 134],
    swing: [0.25, 0.45],
    bass: [["roots", 2], ["offbeat8", 2], ["bounce", 1]],
    melodyGap: 0.45,
    kits: ["garage", "street", "dusty"],
    drums() {
      const second = pickW([[6, 2], [7, 2], [10, 3]]);
      const kick = dlane((s) => {
        if (s === 0) return 0.95;
        if (s === second) return 0.8 + rnd() * 0.1;
        if (s === 14 && rnd() < 0.3) return 0.65;
        return 0;
      });
      const snare = dlane((s) => (s === 4 || s === 12 ? 0.85 + rnd() * 0.1 : 0));
      const ghosts = euclid(16, rint(3, 5), rint(0, 3));
      const hat = dlane((s) => {
        if (s % 4 === 2) return 0.8 + rnd() * 0.15;
        return ghosts[s] && rnd() < 0.7 ? 0.3 + rnd() * 0.15 : 0;
      });
      const clap = dlane((s) => (s === 12 && rnd() < 0.4 ? 0.65 : 0));
      return { kick, snare, hat, clap };
    },
  },
  minimal: {
    weight: 18,
    tempo: [96, 124],
    swing: [0.1, 0.3],
    bass: [["drone", 2], ["roots", 2], ["offbeat8", 1]],
    melodyGap: 0.7,
    kits: ["dusty", "warm", "clean"],
    drums() {
      const kicks = euclid(16, rint(2, 3), 0);
      const kick = dlane((s) => (kicks[s] ? 0.85 + rnd() * 0.15 : 0));
      const snare = dlane((s) => (s === 12 && rnd() < 0.6 ? 0.8 : 0));
      const hats = euclid(16, rint(5, 7), rint(0, 2));
      const hat = dlane((s) => (hats[s] ? 0.4 + rnd() * 0.2 : 0));
      const clap = dlane((s) => (s === 8 && rnd() < 0.3 ? 0.55 : 0));
      return { kick, snare, hat, clap };
    },
  },
};

// The vibe holds ONLY rolled values (plus the groove name) — archetype
// constants stay in GROOVES and are derived where needed, so the vibe can
// persist on the song and any later scene generated from it (the session
// Magic button, the ✨b variation) speaks the same roll.
function rollVibe() {
  const groove = pickW(Object.entries(GROOVES).map(([name, g]) => [name, g.weight]));
  const g = GROOVES[groove];
  return {
    groove,
    tempo: rint(g.tempo[0], g.tempo[1]),
    swing: Math.round((g.swing[0] + rnd() * (g.swing[1] - g.swing[0])) * 100) / 100,
    // The groove hires its kit more often than not; the rest keep the surprise.
    kit: rnd() < 0.6 ? pickFrom(g.kits) : null,
    // Registers roll once per vibe so every scene in the song lives in the
    // same octave. Melody sits in octaves 3-5: octave 2 measured ~4 dB down
    // through the lead highpass and sits on the bass register — out.
    melodyBase: pickFrom([48, 60, 72]),
    bassBase: rnd() < 0.5 ? 36 : 24,
    // Space: every roll gets a depth FLOOR — a shared small room on the pad
    // and lead and a breath of it on the drums — because a bone-dry default
    // reads flat, not meaty (the builder's verdict overruled D9's dry
    // floor; D17). About a third of rolls arrive noticeably wet on top.
    // Bass never (low-end discipline; the returns are highpassed and ride
    // the kick duck, so wet stays clean).
    wet: (() => {
      const deep = rnd() < 0.35;
      return {
        harmony: { verb: deep ? rint(-16, -9) : rint(-20, -16) },
        drums: { verb: deep ? rint(-24, -20) : rint(-27, -23) },
        melody: {
          verb: deep ? rint(-18, -10) : rint(-22, -17),
          ...(rnd() < (deep ? 0.6 : 0.3) ? { echo: rint(-19, -12) } : {}),
        },
      };
    })(),
    harmonyOct: rnd() < 0.15 ? (rnd() < 0.5 ? 1 : -1) : 0,
    polymeter: rnd() < 0.1 ? (rnd() < 0.5 ? "bass" : "melody") : null,
    bScene: rnd() < 0.6,
  };
}

// Weighted progression families in scale degrees. Length is part of the roll:
// cadences run 4 bars, vamps 2, statics 1 — the arrangement and clip loops
// follow the harmony length wherever it lands.
const CADENCES = [[0, 4, 5, 3], [0, 5, 3, 4], [5, 3, 0, 4], [0, 3, 4, 3], [1, 4, 0, 0], [0, 3, 0, 4], [0, 0, 3, 4], [5, 4, 3, 4]];
const VAMPS = [[0, 5], [0, 3], [5, 3], [1, 4], [0, 4], [5, 4], [0, 6], [3, 4]];
function magicHarmony() {
  const fam = pickW([["cadence", 45], ["vamp", 25], ["static", 10], ["wander", 20]]);
  if (fam === "cadence") return pickFrom(CADENCES).slice();
  if (fam === "vamp") return pickFrom(VAMPS).slice();
  if (fam === "static") return [rint(0, 6)];
  return Array.from({ length: 4 }, () => rint(0, 6)); // the surprise generator
}

// A melody is a motif, repeated: generate a short cell, tile it with scale-
// step transposition and drop-note variation, and let the groove's gap hint
// leave breathing room. Uniform scatter can't hook; repetition can.
const MOTIF_SHIFTS = [[0, 5], [1, 2], [-1, 2], [2, 1], [-2, 1]];
function magicMelody(vibe) {
  const win = scaleNotes(vibe.melodyBase, 14);
  const gap = GROOVES[vibe.groove].melodyGap;
  const motifLen = rnd() < 0.5 ? 4 : 8;
  const count = motifLen === 4 ? rint(2, 3) : rint(3, 5);
  const offs = new Set([0]);
  while (offs.size < count) {
    offs.add(rnd() < 0.8 ? 2 * rint(0, motifLen / 2 - 1) : rint(0, motifLen - 1));
  }
  const clampIdx = (i) => Math.max(0, Math.min(win.length - 1, i));
  const anchor = rint(4, 9);
  const events = [...offs].sort((a, b) => a - b).map((off) => ({
    off,
    idx: clampIdx(anchor + rint(-3, 3)),
    len: rnd() < 0.35 ? 2 : 1,
    vel: 0.65 + rnd() * 0.3,
  }));
  const melody = new Array(16).fill(null);
  const writeRep = (rep, shift, always) => {
    for (const ev of events) {
      if (!always && rnd() < 0.15) continue;
      const s = rep * motifLen + ev.off;
      if (s >= 16) return;
      melody[s] = [{ midi: win[clampIdx(ev.idx + shift)], len: ev.len, vel: Math.max(0.4, Math.min(1, ev.vel + rnd() * 0.1 - 0.05)) }];
    }
  };
  writeRep(0, 0, true);
  for (let rep = 1; rep * motifLen < 16; rep++) {
    if (rnd() < gap) continue;
    writeRep(rep, pickW(MOTIF_SHIFTS), false);
  }
  // Never a dud: if the gaps ate too much, the motif answers itself.
  if (melody.filter(Boolean).length < 3) writeRep(8 / motifLen, 0, true);
  return melody;
}

// Bass behaviors, weighted per groove: root-quarters with pickups (the old
// default), offbeat 8ths (house), a drone (halftime weight), octave bounce.
function magicBass(vibe) {
  const notes = scaleNotes(vibe.bassBase, 12);
  const low = notes.slice(0, 5);
  const root = notes[0];
  const fifth = notes[Math.min(4, notes.length - 1)];
  const bass = new Array(16).fill(null);
  const behavior = pickW(GROOVES[vibe.groove].bass);
  if (behavior === "drone") {
    bass[0] = [{ midi: root, len: 8, vel: 0.9 }];
    bass[8] = [{ midi: rnd() < 0.3 ? root + 12 : root, len: 8, vel: 0.85 }];
  } else if (behavior === "offbeat8") {
    for (let s = 2; s < 16; s += 4) {
      bass[s] = [{ midi: rnd() < 0.25 ? fifth : root, len: 2, vel: 0.85 + rnd() * 0.1 }];
    }
  } else if (behavior === "bounce") {
    for (let s = 0; s < 16; s += 2) {
      if (rnd() < 0.2) continue;
      bass[s] = [{ midi: s % 4 === 2 ? root + 12 : root, len: 2, vel: (s % 4 === 0 ? 0.9 : 0.75) + rnd() * 0.1 }];
    }
    if (!bass[0]) bass[0] = [{ midi: root, len: 2, vel: 0.9 }];
  } else {
    const pickLow = () => pickFrom(low);
    for (let s = 0; s < 16; s += 4) {
      if (rnd() < 0.8) bass[s] = [{ midi: pickLow(), len: 4, vel: 0.9 }];
    }
    if (!bass.some(Boolean)) bass[0] = [{ midi: pickLow(), len: 4, vel: 0.9 }];
    // Syncopation: a short pickup on the "and" — the held note underneath
    // gets cut short so the low end never doubles up.
    for (const s of [6, 14]) {
      if (rnd() < 0.45 && !bass[s]) {
        const held = bass[s - 2]?.[0];
        if (held) held.len = 2;
        bass[s] = [{ midi: pickLow(), len: 2, vel: 0.7 + rnd() * 0.15 }];
      }
    }
  }
  return bass;
}

export function makeMagicScene(vibe) {
  // Tolerate no vibe (fresh roll) and pre-vibe or trimmed song.vibe shapes
  // from older saves — anything that can't drive the generators re-rolls.
  if (!GROOVES[vibe?.groove] || vibe.melodyBase == null) vibe = rollVibe();
  const drums = GROOVES[vibe.groove].drums();
  drums.kick[0] = Math.max(drums.kick[0], 0.95); // the downbeat anchor, always
  const scene = makeScene(magicHarmony(), drums, magicMelody(vibe), magicBass(vibe));
  scene.tag = "✨";
  scene.harmonyOct = vibe.harmonyOct;
  if (vibe.polymeter) scene.steps[vibe.polymeter] = 12;
  return scene;
}

// The B side: the same song idea with the furniture moved — a fresh motif in
// the same register (the vibe carries it), drums thinned or busied, the
// progression rotated. Same key, same groove: somewhere to GO once the A
// loop lands.
function makeVariationScene(a, vibe) {
  const b = cloneScene(a);
  b.tag = "✨b";
  b.melody = normalizeNoteLane(magicMelody(vibe));
  if (rnd() < 0.5) {
    // thin: drop the clap, pull the hats back
    b.drums.clap.fill(0);
    b.drums.hat = b.drums.hat.map((v, s) => (s % 2 === 1 ? 0 : v * 0.85));
  } else {
    // busy: ghost hats fill the gaps, one extra kick late in the bar
    const ghosts = euclid(16, rint(9, 11), rint(0, 2));
    b.drums.hat = b.drums.hat.map((v, s) => v || (ghosts[s] ? 0.3 + rnd() * 0.1 : 0));
    const extra = rnd() < 0.5 ? 10 : 14;
    if (!b.drums.kick[extra]) b.drums.kick[extra] = 0.7;
  }
  if (a.harmony.length >= 2 && rnd() < 0.5) b.harmony = [...a.harmony.slice(1), a.harmony[0]];
  return b;
}

export function cloneScene(scene) {
  const cloned = makeScene(scene.harmony, scene.drums, scene.melody, scene.bass, scene.motion, scene.steps);
  cloned.launch = cloneLaunch(scene.launch);
  cloned.harmonyOct = scene.harmonyOct || 0;
  return cloned;
}

// --- Scale helpers for the piano roll (current key + scale) ---
// Notes spell like the key spells: in-scale pitches wear their degree letter
// (E♯4 in F♯ major sits in E's octave), visitors take the signature side.
export function noteName(m) {
  const p = ((m % 12) + 12) % 12;
  const deg = SPELLED.find((s) => s.pc === p);
  if (deg) return deg.name + (Math.floor((m - deg.acc) / 12) - 1);
  return spellScalePc(p) + (Math.floor(m / 12) - 1);
}

const scaleSet = () => new Set(SCALES[curScale].map((o) => (((curKey + o) % 12) + 12) % 12));

// Ascending in-scale MIDI notes at/above baseMidi (bottom row first).
export function scaleNotes(baseMidi, rows) {
  const set = scaleSet();
  const out = [];
  let m = baseMidi;
  while (out.length < rows && m < 128) {
    if (set.has(((m % 12) + 12) % 12)) out.push(m);
    m++;
  }
  return out;
}

// Nudge a MIDI note to the nearest in-scale pitch.
export function snapToScale(midi) {
  const set = scaleSet();
  for (let off = 0; off < 12; off++) {
    if (set.has((((midi + off) % 12) + 12) % 12)) return midi + off;
    if (set.has((((midi - off) % 12) + 12) % 12)) return midi - off;
  }
  return midi;
}

export const ARRANGE_TRACKS = ["harmony", "drums", "bass", "melody"];
export const LAUNCH_MODES = ["loop", "oneshot"];
export const FOLLOW_ACTIONS = ["none", "next", "prev", "random"];

export function defaultLaunch(track = "drums") {
  return {
    mode: "loop",
    follow: "none",
    followBars: track === "harmony" ? 4 : 1,
  };
}

function cloneLaunch(launch = {}) {
  return Object.fromEntries(ARRANGE_TRACKS.map((track) => [track, { ...defaultLaunch(track), ...(launch[track] || {}) }]));
}

export function ensureLaunchSettings(scene) {
  if (!scene.launch) scene.launch = {};
  for (const track of ARRANGE_TRACKS) {
    scene.launch[track] = { ...defaultLaunch(track), ...(scene.launch[track] || {}) };
    if (!LAUNCH_MODES.includes(scene.launch[track].mode)) scene.launch[track].mode = "loop";
    if (!FOLLOW_ACTIONS.includes(scene.launch[track].follow)) scene.launch[track].follow = "none";
    scene.launch[track].followBars = Math.max(1, Math.min(16, scene.launch[track].followBars | 0 || defaultLaunch(track).followBars));
  }
  return scene.launch;
}

export function clipLaunch(scene, track) {
  return ensureLaunchSettings(scene)[track];
}

export function clipLengthBars(scene, track) {
  return track === "harmony" ? Math.max(1, scene.harmony.length) : 1;
}

export function makeSong() {
  // Randomize key and scale on each fresh load — pairs well with Magic scenes
  const key = Math.floor(Math.random() * 12);
  const scale = SCALE_NAMES[Math.floor(Math.random() * SCALE_NAMES.length)];
  setScaleContext(key, scale);
  // One vibe per song: tempo, pocket, and space come from the same roll the
  // patterns do, so the parts agree on what kind of thing they're playing.
  const vibe = rollVibe();
  const s = makeMagicScene(vibe);
  const scenes = [s];
  if (vibe.bScene) scenes.push(makeVariationScene(s, vibe));
  // Place at least 4 bars on the timeline: content loops inside a placed
  // clip, but the timeline itself has a 4-bar floor — a 1-bar vamp placed
  // at its own length would export as one bar of music and three of silence.
  const len = Math.max(4, s.harmony.length);
  return {
    tempo: vibe.tempo,
    key,
    scale,
    trackSwing: {},
    // The whole vibe rides the song: the app side finishes the roll from it
    // (kit, wet sends), and any later scene generated for this song — the
    // session Magic button included — reuses the same roll.
    vibe,
    scenes,
    // Arrangement: per track, clips placed on the bar timeline. Each references
    // a scene's clip for that track (start + length in bars) — Ableton's model
    // of dragging Session clips into the linear timeline.
    arrangement: {
      harmony: [{ scene: 0, start: 0, len }],
      drums: [{ scene: 0, start: 0, len }],
      bass: [{ scene: 0, start: 0, len }],
      melody: [{ scene: 0, start: 0, len }],
    },
    // Performance mutes: per track, 1 at bar index b silences that track's bar
    // in arrangement playback and every export. Written bar-quantized by
    // session record — M/S moves during a take are part of the performance.
    mutes: {},
    loop: { on: false, start: 0, len: 4 },
    swing: vibe.swing, // global groove, rolled inside the archetype's pocket
    humanize: 0, // per-hit timing drift, 0..1 — the HUMAN slider
  };
}

export function arrangeLength(song) {
  let max = 4;
  for (const t of ARRANGE_TRACKS)
    for (const c of song.arrangement[t]) max = Math.max(max, c.start + c.len);
  return max;
}

export function clipAt(song, track, bar) {
  for (const c of song.arrangement[track]) if (bar >= c.start && bar < c.start + c.len) return c;
  return null;
}
