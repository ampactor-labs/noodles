// MIDI import: a reference track becomes a noodles project, on the phone,
// with a printed account of anything the grid could not hold.
//
// This is a port of woodshed's tools/mid2noodles.py, kept structurally
// parallel so the two stay diffable. The mapping rules and their reasons live
// there and in this file's functions; the short version:
//
//   * parts fold onto the four tracks (extra chordal parts merge into
//     harmony, extra lines into melody) and every merge is reported
//   * drums land on the six voices; percussion without an obvious home
//     (shakers, rides, tambourines) is placed by measuring which lane
//     loses the fewest hits, not by timbre
//   * harmony becomes half-bar slots when the source changes chords
//     mid-bar, one-per-bar otherwise; a chord in the last beat that rings
//     across the barline is the next bar's chord arriving early
//   * swing is measured per track from where the offbeat 16ths actually sit

const STEPS_PER_BAR = 16;
const BARS_PER_SCENE = 4;
const DRUM_CH = 9;
const PC = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
};

// General MIDI percussion onto the six voices. 46 (open hat) has a true home
// now; what stays "loose" is placed per file by placeLoosePercussion.
const GM_DRUM = {};
for (const [pitches, voice] of [
  [[35, 36, 41, 43], "kick"],
  [[37, 38, 40, 45, 47, 48, 50, 65, 66], "snare"],
  [[42, 44], "hat"],
  [[46], "open"],
  [[39], "clap"],
]) for (const p of pitches) GM_DRUM[p] = voice;

const LOOSE_PERC = [
  // [name, pitches, lane preference order]
  ["shaker", [69, 70], ["perc", "clap", "hat"]],
  ["tambourine", [54], ["perc", "clap", "hat"]],
  ["ride", [51, 53, 59], ["open", "hat", "perc"]],
  ["crash", [49, 52, 55, 57], ["open", "hat", "perc"]],
  ["sticks", [31, 75, 76, 77], ["clap", "perc", "snare"]],
  ["hand drums", [56, 58, 60, 61, 62, 63, 64, 67, 68, 71, 72, 78, 79], ["clap", "perc", "snare"]],
  ["triangle", [73, 74, 80, 81], ["perc", "open", "hat"]],
];

const HARMONY_WORDS = ["key", "harmon", "chord", "pad", "rhodes", "piano", "wurli", "organ", "string"];
const MELODY_WORDS = ["lead", "melod", "solo", "noodle", "top", "hook", "vox", "voc", "sing", "horn", "trumpet", "sax", "flute", "guitar"];

// --- SMF parsing ------------------------------------------------------------

function parseMidi(buf) {
  // Accept an ArrayBuffer or any view onto one. A Node Buffer's .buffer is a
  // pooled slab, so viewing it whole reads someone else's bytes — respect the
  // view's offset and length instead.
  const b = ArrayBuffer.isView(buf) ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) : new Uint8Array(buf);
  const u32 = (i) => (b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3];
  const u16 = (i) => (b[i] << 8) | b[i + 1];
  if (String.fromCharCode(...b.slice(0, 4)) !== "MThd") throw new Error("not a MIDI file");
  const hlen = u32(4);
  const ntrk = u16(10);
  const div = u16(12);
  if (div & 0x8000) throw new Error("SMPTE time division is not supported");
  let i = 8 + hlen;
  let bpm = 120;
  const tracks = [];
  const vlq = (j) => {
    let v = 0;
    for (;;) {
      const c = b[j++];
      v = (v << 7) | (c & 0x7f);
      if (!(c & 0x80)) return [v, j];
    }
  };
  for (let t = 0; t < ntrk; t++) {
    if (String.fromCharCode(...b.slice(i, i + 4)) !== "MTrk") throw new Error("malformed MIDI");
    const end = i + 8 + u32(i + 4);
    let j = i + 8, tick = 0, run = null, name = null;
    const notes = [], sounding = {};
    while (j < end) {
      let d;
      [d, j] = vlq(j);
      tick += d;
      let st = b[j];
      if (st & 0x80) { run = st; j += 1; } else st = run;
      if (st === 0xff) {
        const mt = b[j]; j += 1;
        let L; [L, j] = vlq(j);
        const data = b.slice(j, j + L); j += L;
        if (mt === 0x03 && name === null) name = new TextDecoder().decode(data);
        else if (mt === 0x51) bpm = 60000000 / ((data[0] << 16) | (data[1] << 8) | data[2]);
      } else if (st === 0xf0 || st === 0xf7) {
        let L; [L, j] = vlq(j); j += L;
      } else if ([0x80, 0x90, 0xa0, 0xb0, 0xe0].includes(st & 0xf0)) {
        const ch = st & 0x0f, a = b[j], v = b[j + 1]; j += 2;
        if ((st & 0xf0) === 0x90 && v > 0) (sounding[a] ||= []).push([tick, v]);
        else if ((st & 0xf0) === 0x80 || ((st & 0xf0) === 0x90 && v === 0)) {
          const on = sounding[a]?.shift();
          if (on) notes.push([on[0], Math.max(1, tick - on[0]), a, on[1], ch]);
        }
      } else j += 1; // program change / channel pressure: exactly one data byte
    }
    notes.sort((x, y) => x[0] - y[0] || x[2] - y[2]);
    tracks.push([name || `track${tracks.length}`, notes]);
    i = end;
  }
  return { div, bpm, tracks };
}

// --- role assignment --------------------------------------------------------

function classify(name, notes) {
  const n = (name || "").toLowerCase();
  if (["drum", "perc", "kit", "beat"].some((k) => n.includes(k)) || notes.every((x) => x[4] === DRUM_CH)) return "drums";
  if (n.includes("bass")) return "bass";
  if (HARMONY_WORDS.some((k) => n.includes(k))) return "harmony";
  if (MELODY_WORDS.some((k) => n.includes(k))) return "melody";
  const onsets = new Map();
  for (const [t] of notes) onsets.set(t, (onsets.get(t) || 0) + 1);
  const poly = notes.length / Math.max(1, onsets.size);
  const avg = notes.reduce((s, x) => s + x[2], 0) / notes.length;
  return poly >= 1.8 ? "harmony" : avg < 52 ? "bass" : "melody";
}

function assignRoles(tracks) {
  const roles = {}, report = [];
  for (const [name, notes] of tracks) {
    if (!notes.length) continue;
    const role = classify(name, notes);
    const merged = role in roles;
    roles[role] = (roles[role] || []).concat(notes).sort((x, y) => x[0] - y[0]);
    report.push([name, role, notes.length, merged]);
  }
  return { roles, report };
}

// --- measurement ------------------------------------------------------------

function measureSwing(roles, step) {
  const per = {};
  for (const role of ["harmony", "drums", "bass", "melody"]) {
    const offs = (roles[role] || [])
      .filter(([t]) => Math.round(t / step) % 2 === 1)
      .map(([t]) => t - Math.round(t / step) * step);
    if (offs.length < 8) continue;
    const frac = offs.reduce((a, b) => a + b, 0) / offs.length / step;
    per[role] = Math.max(0, Math.min(1, Math.round(frac * 3 * 100) / 100));
  }
  return per;
}

function detectKey(roles, step) {
  const w = new Map();
  for (const role of ["bass", "harmony", "melody"])
    for (const [, dur, p, vel] of roles[role] || [])
      w.set(p % 12, (w.get(p % 12) || 0) + (dur / step) * (vel / 127));
  if (!w.size) return { key: 0, scale: "minor" };
  const total = [...w.values()].reduce((a, b) => a + b, 0);
  const bass = roles.bass || roles.harmony || [];
  const bassW = new Map();
  for (const [, dur, p] of bass) bassW.set(p % 12, (bassW.get(p % 12) || 0) + dur);
  const bassTotal = Math.max(1, [...bassW.values()].reduce((a, b) => a + b, 0));
  let final = null;
  if (bass.length) {
    const lastTick = Math.max(...bass.map(([t]) => t));
    final = Math.min(...bass.filter(([t]) => t === lastTick).map(([, , p]) => p)) % 12;
  }
  let best = null;
  for (let root = 0; root < 12; root++)
    for (const [name, iv] of Object.entries(SCALES)) {
      const member = new Set(iv.map((s) => (root + s) % 12));
      let score = 0;
      for (const [pc, v] of w) if (member.has(pc)) score += v;
      score /= total;
      score += 0.25 * ((bassW.get(root) || 0) / bassTotal);
      if (final !== null && root === final) score += 0.3;
      if (!best || score > best.score) best = { score, key: root, scale: name };
    }
  return best;
}

// Try each loose group in each candidate lane; keep the assignment that
// loses the fewest hits. Timbre proposes, the count disposes.
function placeLoosePercussion(drums, step) {
  const slots = { kick: new Set(), snare: new Set(), hat: new Set(), open: new Set(), clap: new Set(), perc: new Set() };
  for (const [t, , p] of drums) {
    const lane = GM_DRUM[p];
    if (lane) slots[lane].add(Math.round(t / step));
  }
  const extra = {}, report = [];
  const groups = LOOSE_PERC
    .map(([name, pitches, prefs]) => [name, pitches, prefs, drums.filter(([, , p]) => pitches.includes(p)).length])
    .filter(([, , , n]) => n > 0)
    .sort((a, b) => b[3] - a[3]);
  for (const [name, pitches, prefs] of groups) {
    const steps = drums.filter(([, , p]) => pitches.includes(p)).map(([t]) => Math.round(t / step));
    const want = new Set(steps);
    let best = null;
    prefs.forEach((lane, rank) => {
      let collide = steps.length - want.size;
      for (const s of want) if (slots[lane].has(s)) collide += 1;
      if (!best || collide < best.collide || (collide === best.collide && rank < best.rank)) best = { lane, collide, rank };
    });
    for (const p of pitches) extra[p] = best.lane;
    for (const s of want) slots[best.lane].add(s);
    report.push([name, best.lane, steps.length - best.collide, best.collide]);
  }
  return { extra, report };
}

// --- lane building ----------------------------------------------------------

function noteLane(notes, t0, step, nSteps, loss, tag) {
  const lane = new Array(nSteps).fill(null);
  for (const [t, dur, p, vel] of notes) {
    const idx = Math.round((t - t0) / step);
    if (idx < 0 || idx >= nSteps) continue;
    loss[`want_${tag}`] = (loss[`want_${tag}`] || 0) + 1;
    const slot = lane[idx] || [];
    if (slot.some((n) => n.midi === p)) {
      loss[`collide_${tag}`] = (loss[`collide_${tag}`] || 0) + 1;
      continue;
    }
    slot.push({ midi: p, len: Math.max(1, Math.min(16, Math.round(dur / step))), vel: Math.round(Math.max(0.05, Math.min(1, vel / 127)) * 100) / 100 });
    lane[idx] = slot;
  }
  return lane;
}

function drumLanes(notes, t0, step, nSteps, loss, extra) {
  const lanes = { kick: 0, snare: 0, hat: 0, open: 0, clap: 0, perc: 0 };
  for (const v of Object.keys(lanes)) lanes[v] = new Array(nSteps).fill(0);
  for (const [t, , p, vel] of notes) {
    const voice = GM_DRUM[p] || extra[p];
    if (!voice) { loss.drum_unmapped = (loss.drum_unmapped || 0) + 1; continue; }
    const idx = Math.round((t - t0) / step);
    if (idx < 0 || idx >= nSteps) continue;
    if (lanes[voice][idx]) loss[`collide_${voice}`] = (loss[`collide_${voice}`] || 0) + 1;
    loss[`voice_${voice}`] = (loss[`voice_${voice}`] || 0) + 1;
    lanes[voice][idx] = Math.max(lanes[voice][idx], Math.round(Math.max(0.05, Math.min(1, vel / 127)) * 100) / 100);
  }
  return lanes;
}

// One chord per slot, where a slot is a bar (rate 1) or half a bar (rate 2).
// A chord arriving inside the slot's last beat that rings across the boundary
// belongs to the next slot: an anticipation, not a change.
function harmonySlots(notes, t0, slotTicks, nSlots, loss) {
  const beat = Math.max(1, Math.floor(slotTicks / 2));
  const anticipation = Math.min(beat, Math.floor(slotTicks / 2));
  const slotOf = (t, dur) => {
    const rel = t - t0;
    const s = Math.floor(rel / slotTicks);
    const into = rel - s * slotTicks;
    return into >= slotTicks - anticipation && rel + dur > (s + 1) * slotTicks ? s + 1 : s;
  };
  const perSlot = new Map();
  for (const [t, dur, p] of notes) {
    const s = slotOf(t, dur);
    if (s < 0 || s >= nSlots) continue;
    const m = perSlot.get(s) || new Map();
    m.set(p % 12, (m.get(p % 12) || 0) + dur);
    perSlot.set(s, m);
  }
  // Genuine intra-slot changes (neither half's pitch set contains the other).
  const halves = new Map();
  for (const [t, dur, p] of notes) {
    const s = slotOf(t, dur);
    if (s < 0 || s >= nSlots) continue;
    const inSlot = (t - t0) - s * slotTicks;
    const h = halves.get(s) || [new Set(), new Set()];
    h[inSlot < slotTicks / 2 ? 0 : 1].add(p % 12);
    halves.set(s, h);
  }
  for (const [, [a, b]] of halves) {
    if (a.size && b.size) {
      const sub = (x, y) => [...x].every((v) => y.has(v));
      if (!sub(a, b) && !sub(b, a)) loss.harmony_midbar = (loss.harmony_midbar || 0) + 1;
    }
  }
  const out = [];
  let last = null;
  for (let s = 0; s < nSlots; s++) {
    const m = perSlot.get(s);
    const pcs = m ? [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, 7).map(([pc]) => pc) : [];
    if (pcs.length >= 3) { last = pcs.sort((a, b) => a - b); out.push({ pcs: last }); }
    else if (last) out.push({ pcs: last });
    else out.push(0);
  }
  return out;
}

// Does this block change chords mid-bar for real? Decides rate 2.
function needsHalfBars(notes, t0, barTicks, nBars) {
  const loss = {};
  harmonySlots(notes, t0, barTicks, nBars, loss);
  return (loss.harmony_midbar || 0) > 0;
}

// --- the importer -----------------------------------------------------------

export function importMidi(buf) {
  const { div, bpm, tracks } = parseMidi(buf);
  const step = Math.max(1, Math.floor(div / 4));
  const bar = div * 4;
  const { roles, report: roleReport } = assignRoles(tracks);
  if (!Object.keys(roles).length) throw new Error("no notes found");

  const last = Math.max(...Object.values(roles).flat().map(([t]) => t));
  const nBars = Math.floor(last / bar) + 1;
  const nBlocks = Math.max(1, Math.ceil(nBars / BARS_PER_SCENE));
  const stepsPerScene = STEPS_PER_BAR * BARS_PER_SCENE;

  const swing = measureSwing(roles, step);
  const { key, scale } = detectKey(roles, step);
  const loss = {};
  const { extra, report: percReport } = placeLoosePercussion(roles.drums || [], step);

  const scenes = [], seen = new Map();
  const arrangement = { harmony: [], drums: [], bass: [], melody: [] };
  for (let blk = 0; blk < nBlocks; blk++) {
    const t0 = blk * BARS_PER_SCENE * bar;
    const t1 = t0 + BARS_PER_SCENE * bar;
    const cut = {};
    for (const [r, ns] of Object.entries(roles)) cut[r] = ns.filter(([t]) => t >= t0 && t < t1);
    const rate = cut.harmony?.length && needsHalfBars(cut.harmony, t0, bar, BARS_PER_SCENE) ? 2 : 1;
    const scene = {
      tag: "A",
      harmony: harmonySlots(cut.harmony || [], t0, bar / rate, BARS_PER_SCENE * rate, loss),
      harmonyRate: rate,
      drums: drumLanes(cut.drums || [], t0, step, stepsPerScene, loss, extra),
      bass: noteLane(cut.bass || [], t0, step, stepsPerScene, loss, "bass"),
      melody: noteLane(cut.melody || [], t0, step, stepsPerScene, loss, "melody"),
      motion: {},
      steps: { drums: stepsPerScene, bass: stepsPerScene, melody: stepsPerScene },
      harmonyOct: 0,
    };
    const body = JSON.stringify([scene.harmony, scene.harmonyRate, scene.drums, scene.bass, scene.melody, scene.steps]);
    let idx = seen.get(body);
    if (idx === undefined) {
      idx = scenes.length;
      const cycle = Math.floor(idx / 8);
      scene.tag = "ABCDEFGH"[idx % 8] + (cycle ? cycle + 1 : "");
      scenes.push(scene);
      seen.set(body, idx);
    }
    for (const track of ["harmony", "drums", "bass", "melody"])
      if (cut[track]?.length) arrangement[track].push({ scene: idx, start: blk * BARS_PER_SCENE, len: BARS_PER_SCENE });
  }

  const song = {
    tempo: Math.round(bpm),
    key,
    scale,
    trackSwing: swing,
    scenes,
    arrangement,
    mutes: {},
    loop: { on: false, start: 0, len: BARS_PER_SCENE },
    swing: Math.max(0, ...Object.values(swing)),
    humanize: 0,
  };

  // The ledger. Structural facts only — how it sounds is the player's call.
  const report = [];
  for (const [name, role, n, merged] of roleReport)
    report.push(`${name} → ${role}${merged ? " (merged)" : ""}, ${n} notes`);
  for (const [name, lane, kept, lostN] of percReport)
    report.push(`${name} → ${lane} lane, kept ${kept}${lostN ? `, lost ${lostN}` : ""}`);
  let want = 0, kept = 0;
  for (const v of ["kick", "snare", "hat", "open", "clap", "perc", "bass", "melody"]) {
    const w = loss[`want_${v}`] ?? loss[`voice_${v}`] ?? 0;
    if (!w) continue;
    const k = w - (loss[`collide_${v}`] || 0);
    want += w; kept += k;
    if (k < w) report.push(`${v}: ${k}/${w} hits fit the grid`);
  }
  if (loss.harmony_midbar) report.push(`${loss.harmony_midbar} chord change(s) fell between half-bars, flattened`);
  if (loss.drum_unmapped) report.push(`${loss.drum_unmapped} percussion note(s) had no lane, dropped`);
  const pct = want ? Math.round((1000 * kept) / want) / 10 : 100;
  const summary = `Imported ${PC[key]} ${scale}, ${Math.round(bpm)} bpm, ${nBars} bars → ${scenes.length} scene(s); ${pct}% of events on the grid`;

  return {
    project: { schema: "noodles-project", version: 2, savedAt: new Date().toISOString(), song, mix: {}, devices: {} },
    summary,
    report,
  };
}
