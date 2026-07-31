// Noodles — a mobile take on Ableton's Session view.
// Clip grid (tracks x scenes) + transport; tap a clip to edit it (drum rack /
// chord editor). DOM/CSS for the DAW chrome, Tone.js underneath.

import {
  CHORDS,
  LADDER_RUNGS,
  ladderPcs,
  ladderRungOf,
  DRUM_VOICES,
  DRUM_META,
  ARRANGE_TRACKS,
  SCALE_NAMES,
  FOLLOW_ACTIONS,
  clipLaunch,
  hslInt,
  makeSong,
  makeScene,
  cloneScene,
  arrangeLength,
  noteSlot,
  normalizeScene,
  scaleNotes,
  noteName,
  setScaleContext,
  snapToScale,
  makeMagicScene,
  rollDrumPhrase,
  stepsFor,
  keyDisplayName,
  keySignature,
  spellScalePc,
  harmonyChord,
  harmonyEntryEquals,
  voiceLead,
  scaleDegreeOfPc,
  spellChordTones,
  signatureAccFor,
  spellPitch,
  stationOfPc,
  relMajorPc,
} from "./model.js";
import { createAudio, KIT_NAMES, SAMPLE_KIT_NAMES, HARMONY_PRESET_NAMES, BASS_PRESET_NAMES, MELODY_PRESET_NAMES, CORNERS, colorNamesFor, dominantCorner, DRUM_BANKS, drumCornerNames, MASTER_DEFAULTS } from "./audio.js";
import { createCircleView } from "./circle.js";

// Pitch range shown in the piano roll, per track.
const PIANO = { melody: { base: 12, rows: 56 }, bass: { base: 12, rows: 56 } };

function setNoteSlot(lane, step, notes) {
  const clean = notes
    .filter((n) => n && Number.isFinite(Number(n.midi)))
    .map((n) => ({
      midi: Number(n.midi),
      len: Math.max(1, Math.min(16, Number(n.len) || 1)),
      vel: Math.max(0.05, Math.min(1, Number(n.vel) || 0.9)),
    }));
  lane[step] = clean.length ? clean : null;
}

function removeNoteFromSlot(lane, step, index) {
  const notes = noteSlot(lane[step]).filter((_, i) => i !== index);
  setNoteSlot(lane, step, notes);
}

function removePitchInRange(lane, midi, fromStep, toStep, exceptStep) {
  for (let step = fromStep; step <= toStep; step++) {
    if (step === exceptStep) continue;
    const next = noteSlot(lane[step]).filter((n) => n.midi !== midi);
    setNoteSlot(lane, step, next);
  }
}

function slotPeakVel(slot) {
  return noteSlot(slot).reduce((max, n) => Math.max(max, n.vel ?? 0.9), 0);
}

const hex = (n) => "#" + (n >>> 0).toString(16).padStart(6, "0");
const padHex = (v) => hex(hslInt(DRUM_META[v].hue, DRUM_META[v].sat, DRUM_META[v].light));

const TRACKS = [
  { key: "harmony", name: "Harmony", color: "#e8b84b" },
  { key: "drums", name: "Drums", color: "#54a8e0" },
  { key: "bass", name: "Bass", color: "#cf6f9b" },
  { key: "melody", name: "Melody", color: "#7bc86c" },
];
const trackColor = (k) => TRACKS.find((t) => t.key === k).color;
const DEFAULT_TRACK_VOLUME_DB = -6;
const METER_MIN_DB = -60;
const METER_MAX_DB = 0;
const TRACK_VOLUME_MIN_DB = -36;
const TRACK_VOLUME_MAX_DB = 0;
const clampTrackDb = (db) => Math.max(TRACK_VOLUME_MIN_DB, Math.min(TRACK_VOLUME_MAX_DB, Math.round(db)));
const formatDb = (db) => `${db > 0 ? "+" : ""}${db} dB`;
const meterLevel = (db) => {
  if (!Number.isFinite(db)) return 0;
  return Math.max(0, Math.min(1, (db - METER_MIN_DB) / (METER_MAX_DB - METER_MIN_DB)));
};
// Entries are degrees or borrowed {pcs}; harmonyChord speaks both. The roman
// wears its function hue everywhere this markup lands — session minis,
// arrangement minis, editor slots — so a borrowed chord's violet reads as
// "not from here" straight off the grid.
// Chord tones spell by the CHORD's letters (thirds stack: D F♯ A C♯ E),
// never by the key's accidental side — Dmaj9 in D minor is not "D G♭ A".
const chordNotes = (entry) =>
  spellChordTones(entry)
    .map((t) => "CDEFGAB"[t.letter] + (t.acc > 0 ? "♯".repeat(t.acc) : "♭".repeat(-t.acc)))
    .join(" ");
function chordMarkup(entry, { notes = false } = {}) {
  const ch = harmonyChord(entry);
  if (!ch) return "";
  const tint = hex(hslInt(ch.hue, ch.sat, 72));
  return `<b style="color:${tint}">${ch.roman}</b><span>${ch.name}</span>${notes ? `<em class="chord-notes">${chordNotes(entry)}</em>` : ""}`;
}

const song = makeSong();
setScaleContext(song.key, song.scale);
const audio = createAudio(song);
// Visual-sync trim, persisted: corrects the platform's output-latency
// estimate for every audio-clock visual at once (set from the ? page).
const SYNC_NUDGE_KEY = "noodles:sync-nudge";
let syncNudgeMs = Math.max(-250, Math.min(250, Number(localStorage.getItem(SYNC_NUDGE_KEY)) || 0));
audio.setSyncNudge(syncNudgeMs);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
// A rolled sound is any point in the track's morph space plus a color drawn
// from that track's own set, with "none" weighted double so a full-song roll
// doesn't stack four effects at once.
const colorPool = (track) => ["none", ...colorNamesFor(track)];
function rolledPatch(track) {
  const p = { x: Math.random(), y: Math.random(), color: pick(colorPool(track)), amount: 0.3 + Math.random() * 0.55, motion: Math.random() };
  if (track === "drums") {
    // The sample bank is the star; the synth kit stays in rotation.
    p.bank = Math.random() < 0.7 ? "sample" : "synth";
    p.pins = {};
  }
  return p;
}
function randomizePresets(vibe) {
  for (const t of ["harmony", "bass", "melody", "drums"]) {
    const p = rolledPatch(t);
    // A hired corner (rolled in the vibe, weighted by the groove) pulls the
    // morph point into its quadrant — within 0.35 of the corner on each axis
    // the bilinear weights keep it dominant (0.65² = 0.42 vs 0.23 adjacent)
    // while the jitter keeps every hire a different blend of its neighbors.
    const hire = vibe?.hires?.[t];
    if (hire && CORNERS[t]?.includes(hire)) {
      const i = CORNERS[t].indexOf(hire);
      p.x = Math.abs(i % 2 - Math.random() * 0.35);
      p.y = Math.abs(Math.floor(i / 2) - Math.random() * 0.35);
    }
    audio.setPatch(t, p);
  }
  // The kit hire was rolled inside the vibe (an 808 halftime and a garage
  // 2-step read as THINGS; a null hire keeps the surprise). setKit moves
  // bank + corner and leaves the rolled color/motion alone.
  if (vibe?.kit) audio.setKit(vibe.kit);
}
// The dice must never deal dead air: "deep" is a driveless sine, and a sine
// in octave 1 (~33 Hz fundamental, no harmonics) is inaudible on phone and
// bookshelf speakers alike. Fold a fresh magic bassline up an octave when it
// lands there. Presets with drive keep their low rolls — their harmonics
// carry on small speakers. Hand-placed low notes are untouched on purpose.
function fitBassRegister(scene) {
  if (audio.bassPreset() !== "deep") return scene;
  const notes = scene.bass.flatMap((slot) => noteSlot(slot));
  if (notes.length && notes.some((n) => n.midi < 36)) {
    for (const n of notes) n.midi += 12;
  }
  return scene;
}
// The bass sound-dice keeps the same promise the other way around:
// fitBassRegister folds FRESH dice notes at boot/reroll, but an established
// bassline may hold hand-placed low notes the fold must not move — so when
// any scene lives below octave 2, the roll itself stays out of the
// deep-dominant quadrant (the driveless sine those notes vanish under).
function rolledBassPatch() {
  const low = song.scenes.some((sc) => sc.bass.some((slot) => noteSlot(slot).some((n) => n.midi < 36)));
  let p = rolledPatch("bass");
  for (let i = 0; low && i < 8 && dominantCorner("bass", p) === "deep"; i++) p = rolledPatch("bass");
  return p;
}
randomizePresets(song.vibe);
for (const sc of song.scenes) fitBassRegister(sc);
const PROJECT_SCHEMA = "noodles-project";
const PROJECT_VERSION = 2; // v2: devices carry full patch specs, not just preset names
const LOCAL_PROJECT_KEY = "noodles:last-project";

// --- DOM helpers ---
function el(tag, props = {}, kids = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k === "html") e.innerHTML = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "style") e.setAttribute("style", v);
    else e.setAttribute(k, v);
  }
  for (const c of [].concat(kids)) if (c) e.appendChild(c);
  return e;
}

function capturePointer(node, pointerId) {
  try {
    node.setPointerCapture?.(pointerId);
  } catch {
    // Synthetic/mobile browser pointer streams can end before capture resolves.
  }
}

const buzz = (ms = 8) => navigator.vibrate?.(ms);

// Has this session got anything worth not losing? Set by the first sound and
// the first edit; read by the service-worker swap (see the update block below)
// to decide whether reloading into a new build is free or rude.
let swUpdateReady = false;
let userTouched = false;
const markTouched = () => {
  userTouched = true;
};

// The one audio unlock, memoized as the in-flight promise: every tap awaits
// the SAME completion (a second tap during a slow first init used to sail
// past a boolean latch and launch before the clock started), and a failed
// init clears the latch so the next tap retries instead of leaving a lit
// transport over dead air for the rest of the session.
let startPromise = null;
function ensureStarted() {
  markTouched(); // any sound at all means there's now something to lose
  if (!startPromise) {
    startPromise = audio.init().catch((err) => {
      startPromise = null;
      throw err;
    });
  }
  return startPromise;
}

let playingScene = -1;
const playingTracks = Object.fromEntries(TRACKS.map((t) => [t.key, -1]));
const queuedSceneTracks = Object.fromEntries(TRACKS.map((t) => [t.key, -1]));
const sceneEls = []; // per scene: { row, clips: {track: el} }

// --- The circle of fifths: key navigator + playable harmony surface ---
// The circle is a pure view over song.key/song.scale and CHORDS (src/circle.js);
// this side owns what a tap MEANS to the song: the sheet, the arm toggle, and
// the write into the playing clip.
let circleArmed = false; // ● in the circle bar: taps land in the playing clip
let circleBar = 0; // harmony slot being heard right now (from chord events)
let editorCircle = null; // the chord editor's mounted wheel, one at a time
// A clean armed tap on a diatonic wedge replaces the chord being heard —
// bar-quantized by construction, since harmony is one chord per bar. Borrowed
// chords (degree -1) are playable but not storable: the model speaks scale
// degrees, so the bright region is exactly what the clip can hold.
function circleCapture(chord, ctx = {}) {
  // ● gates casual taps; a bloom release ON a pad is deliberate and writes
  // regardless — that is what "I changed C to C7" means (empty-air release
  // stays the escape that writes nothing).
  if ((!circleArmed && !ctx.deliberate) || !audio.playing || audio.mode !== "scene") return false;
  const si = playingTracks.harmony;
  const scene = song.scenes[si];
  if (!scene?.harmony?.length) return false;
  // Diatonic wedges store their degree (follows key changes for free);
  // borrowed wedges store pitch classes (D13) — the violet visitors.
  const entry = chord.degree >= 0 ? chord.degree : { pcs: chord.pcs.slice(0, 7) };
  const slot = circleBar % scene.harmony.length;
  if (harmonyEntryEquals(scene.harmony[slot], entry)) return false;
  pushUndo();
  scene.harmony[slot] = entry;
  refreshClip(si, "harmony");
  return true;
}
// The front door moves, the house stays: a mode change within the sector
// keeps every sounding pitch. Stored degrees re-index around the new tonic
// (the chord that was degree d is the same chord at a new number) and
// borrowed pcs already sit still — no transposition, so playback before and
// after is bit-identical. Only the names re-light.
function circleDoorMode(tonicPc, scaleName) {
  if (tonicPc === song.key && scaleName === song.scale) return;
  const shift = scaleDegreeOfPc(tonicPc); // the new tonic's degree in the OLD scale
  if (shift < 0) return;
  pushUndo();
  for (const sc of song.scenes) {
    sc.harmony = sc.harmony.map((e) => (typeof e === "number" ? (e - shift + 7) % 7 : e));
  }
  song.key = ((tonicPc % 12) + 12) % 12;
  song.scale = scaleName;
  setScaleContext(song.key, song.scale);
  renderTransport();
  renderSession();
  if (view === "arrangement") renderArrangement();
  updateUndoButtons();
  circleView.refreshStatic();
  updateCircleChrome();
  // A mode change from the editor's own wheel: rebuild the open editor so
  // slots, staff, and wheel all speak the new names.
  if (editor?.track === "harmony") openEditor(editor.scene, editor.track);
}
const circleView = createCircleView({
  song,
  audio,
  ensureStarted,
  commitKeyScale: circleKeyScale,
  commitMode: circleDoorMode,
  captureChord: circleCapture,
  getHarmonyOct: () => (playingTracks.harmony >= 0 ? song.scenes[playingTracks.harmony]?.harmonyOct || 0 : 0),
  buzz,
});

let view = "session"; // 'session' | 'arrangement'
let sessionRecord = false;
let ppb = 37; // arrangement pixels-per-bar; default zoomed out so bar 8 fills screen
let arrPlayBar = 0; // arrangement playhead position in bars
let arrPinching = false; // two-finger zoom in progress — don't scroll under it
let arrFollowResumeAt = 0; // brief hold-off after a manual scroll, so follow doesn't yank back
let arrLastFollowLeft = -1; // scrollLeft follow last set, to tell its own scroll from the user's
let selClip = null; // { track, idx }

// --- Undo / redo (whole-song snapshots; simple and covers every edit) ---
const undoStack = [];
const redoStack = [];
let undoBtn = null;
let redoBtn = null;
const snapshot = () => structuredClone(song);
function commitUndo(pre) {
  undoStack.push(pre);
  if (undoStack.length > 60) undoStack.shift();
  redoStack.length = 0;
  updateUndoButtons();
}
function pushUndo() {
  markTouched(); // an edit (a dice roll included) is work worth not losing
  commitUndo(snapshot());
}
function refreshAll() {
  setScaleContext(song.key, song.scale);
  audio.setTempo(song.tempo);
  audio.setSwing(song.swing);
  closeEditor();
  renderTransport();
  renderSession();
  if (view === "arrangement") renderArrangement();
  updateUndoButtons();
}
function restoreSnap(s) {
  Object.assign(song, structuredClone(s));
  song.scenes?.forEach(normalizeScene);
  selClip = null;
  refreshAll();
}
function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  restoreSnap(undoStack.pop());
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  restoreSnap(redoStack.pop());
}
function updateUndoButtons() {
  if (undoBtn) undoBtn.classList.toggle("disabled", undoStack.length === 0);
  if (redoBtn) redoBtn.classList.toggle("disabled", redoStack.length === 0);
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------
const transport = document.getElementById("transport");
const footer = document.getElementById("footer");
let playBtn;
let bpmEl;
const TEMPO_MIN = 40;
const TEMPO_MAX = 220;

async function togglePlayback() {
  await ensureStarted();
  if (view === "arrangement") {
    if (audio.playing) audio.stop();
    else audio.playArrangement(arrPlayBar);
  } else {
    if (audio.playing) audio.stop();
    else {
      const sceneIndex = playingScene >= 0 ? playingScene : 0;
      audio.launchScene(sceneIndex);
      setPlaying(sceneIndex);
    }
  }
  updatePlayBtn(audio.playing);
}

function renderTransport() {
  transport.innerHTML = "";
  playBtn = el("div", {
    class: "tbtn play" + (audio.playing ? " on" : ""),
    text: audio.playing ? "⏹" : "▶",
    onclick: togglePlayback,
  });
  const recBtn = el("div", {
    class: "tbtn record" + (sessionRecord ? " on" : ""),
    text: "●",
    id: "rec-btn",
    onclick: () => {
      sessionRecord = !sessionRecord;
      if (sessionRecord) pushUndo();
      renderTransport();
    },
  });
  bpmEl = el("div", { id: "bpm", role: "button", tabindex: "0", html: `${song.tempo}<small>BPM</small>` });
  bindTempoControl(bpmEl);
  undoBtn = el("div", { class: "tbtn undo", text: "↶", onclick: undo });
  redoBtn = el("div", { class: "tbtn redo", text: "↷", onclick: redo });
  const left = el("div", { class: "tleft" }, [recBtn, playBtn, undoBtn, redoBtn]);
  const tempo = el("div", { class: "ttempo" }, [bpmEl]);
  // View toggle + File button live in the header (always visible)
  const viewBtn = el("div", {
    class: "tbtn" + (view === "arrangement" ? " accent" : ""),
    text: "View",
    id: "view-toggle-btn",
    onclick: () => setView(view === "session" ? "arrangement" : "session"),
  });
  const fileBtn = el("div", { class: "tbtn", text: "File", id: "file-btn", onclick: openExport });
  const tright = el("div", { class: "tright" }, [viewBtn, fileBtn]);
  transport.append(left, tempo, tright);
  updateUndoButtons();
  renderFooter();
}

function renderFooter() {
  if (!footer) return;
  footer.innerHTML = "";
  const grooveVal = el("span", { class: "swval", text: Math.round(song.swing * 100) + "%" });
  const grooveSlider = el("input", {
    type: "range",
    min: "0",
    max: "0.6",
    step: "0.01",
    value: String(song.swing),
    class: "swingslider",
  });
  // Snapshot on the first real change, not on pointerdown: a tap that never
  // moves the slider used to structuredClone the whole song into the undo
  // stack for nothing (the bindTempoControl pattern).
  let groovePre = null;
  grooveSlider.addEventListener("pointerdown", () => {
    groovePre = null;
  });
  // A gesture ends with change; the next one (keyboard steps included, which
  // never fire pointerdown) snapshots fresh.
  grooveSlider.addEventListener("change", () => {
    groovePre = null;
  });
  grooveSlider.addEventListener("input", () => {
    if (!groovePre) {
      groovePre = snapshot();
      markTouched();
      commitUndo(groovePre);
    }
    song.swing = parseFloat(grooveSlider.value);
    audio.setSwing(song.swing);
    grooveVal.textContent = Math.round(song.swing * 100) + "%";
  });
  const groove = el("div", { class: "swingctl" }, [
    el("span", { class: "swlabel", text: "GROOVE" }),
    grooveSlider,
    grooveVal,
  ]);
  // The humanizer: per-hit timing drift, a hand instead of a grid. Same
  // snapshot-on-first-change undo discipline as the groove slider.
  const humanVal = el("span", { class: "swval", text: Math.round((song.humanize || 0) * 100) + "%" });
  const humanSlider = el("input", {
    type: "range",
    min: "0",
    max: "1",
    step: "0.01",
    value: String(song.humanize || 0),
    class: "swingslider humanslider",
  });
  let humanPre = null;
  humanSlider.addEventListener("pointerdown", () => {
    humanPre = null;
  });
  humanSlider.addEventListener("change", () => {
    humanPre = null;
  });
  humanSlider.addEventListener("input", () => {
    if (!humanPre) {
      humanPre = snapshot();
      markTouched();
      commitUndo(humanPre);
    }
    song.humanize = parseFloat(humanSlider.value);
    humanVal.textContent = Math.round(song.humanize * 100) + "%";
  });
  const human = el("div", { class: "swingctl" }, [
    el("span", { class: "swlabel", text: "HUMAN" }),
    humanSlider,
    humanVal,
  ]);
  // The key control IS the circle: a live mini-wheel — the app's compass,
  // sector and front door at a glance — beside the key's honest name.
  const glyph = el("canvas", { class: "keyglyph" });
  const keyBtn = el(
    "div",
    {
      class: "tbtn keybtn",
      id: "key-btn",
      "data-sheet": "circle",
      role: "button",
      tabindex: "0",
      onclick: openCircleSheet,
    },
    [glyph, el("span", { class: "keybtn-name", html: `${keyDisplayName(song.key, song.scale)}<small>${song.scale}</small>` })]
  );
  drawKeyGlyph(glyph);
  const keyctl = el("div", { class: "keyctl" }, [keyBtn]);
  // The dice sits with the song's musical identity: one tap rolls a whole new
  // key + tempo + sounds + magic scene, same as a fresh load. Undo-safe.
  const diceBtn = el("div", { class: "tbtn accent", text: "🎲", id: "dice-btn", title: "New song: random key, tempo, sounds", onclick: rerollSong });
  const aboutBtn = el("div", { class: "tbtn", text: "?", id: "about-btn", title: "What is this?", "data-sheet": "about", onclick: openAboutSheet });
  footer.append(
    el("div", { class: "frow" }, [keyctl, diceBtn, aboutBtn, groove, human])
  );
}

// ---------------------------------------------------------------------------
// About — what this is, in the product's own voice. Pull, never push: it
// lives behind the ? and never opens itself.
// ---------------------------------------------------------------------------
function openAboutSheet() {
  resetSheet("#e8b84b");
  sheetId = "about";
  sheet.appendChild(sheetBar("noodles", "a pocket instrument"));
  const p = (text) => el("div", { class: "about-p", text });
  const label = (text) => el("div", { class: "about-label", text });
  const k = (g, d) => el("div", { class: "about-k" }, [el("div", { class: "about-g", text: g }), el("div", { class: "about-d", text: d })]);
  const body = el("div", { class: "editor-scroll" }, [
    p("This is an instrument. The song playing right now was rolled on the spot, just for you, and every bit of it is yours to change. You can't break it: everything stays in key, every roll comes out mixed, and undo sits in the top bar."),

    label("start here"),
    k("\u25b6", "plays. \u23f9 stops."),
    k("\ud83c\udfb2", "rolls a fresh four-bar song: new key, tempo, sounds, groove, a bassline that walks the chords, a fill at the end of bar 4."),
    k("tap a clip", "opens it for drawing."),
    k("scene \u25b6", "launches that whole row on the next bar."),

    label("the grid"),
    k("row", "a scene: a loop and a song section in one."),
    k("+", "adds a scene: blank, a copy, or a fresh magic one."),
    k("corner pie", "where a playing clip is in its loop."),
    k("long-press", "a clip for launch modes and follow actions, a scene's \u25b6 for scene moves, a track name for track moves."),

    label("editors"),
    k("drums", "tap or drag paints hits; the lane below sets how hard each one lands."),
    k("notes", "tap adds, drag right stretches, tap again removes. Every pitch lands in key, and the staff above writes the lane down as you draw."),
    k("chords", "the wheel is the palette: tap a wedge to set the selected bar, drag across wedges to paint a run of bars in one stroke."),
    k("rung chips", "grow the selected chord up the ladder (7 \u00b7 9 \u00b7 11 \u00b7 13) or swap in a sus; the slash chips pick which note sits in the bass."),
    k("\u2212 / +", "loop length. Short of a bar it phases against the other tracks on purpose; past it (2, 3, or 4 bars) a line can walk the whole progression, and BAR chips page the grid. The dice rolls walking basslines too."),
    k("vel", "tap it to flip through captured rides and redraw them per step; \u2715 clears one."),
    k("\u25e7", "zooms the note grid when your thumbs need bigger targets."),
    p("The chord editor engraves your line on a real grand staff as you write: two clefs, your key's signature, every notehead wearing its letter. The gold lines join notes that carry over between chords; the dim lines show which voice moves, and how far."),

    label("the circle"),
    p("Tap the key name at the bottom and the circle of fifths opens. The bright neighborhood is your key; everything dim is a knock away."),
    k("tap", "sounds a wedge's chord."),
    k("drag", "strums across wedges."),
    k("hold", "blooms the ladder: 7, 9, 11, 13, sus. Release on a pad and the wedge keeps that voicing (the gold number remembers) and it lands in the playing clip. Empty air forgets."),
    k("\u25cf", "arms the wheel: plain taps write into the playing clip too."),
    k("rim drag", "carries the whole song around the circle; watch the sharps arrive one at a time."),
    k("white dot", "drag it to another wedge and the same notes answer to a new mode's name; hold it still and home blooms."),
    k("hold middle", "everything you tap comes back mirrored across the key."),
    k("pinch", "opens the spiral: twelve perfect fifths never quite close, and this is the gap."),

    label("sound"),
    k("track name", "opens its sound: a morph pad with four sounds in the corners and everything between them yours to find."),
    k("color", "one per track (crush, phase, trem, wob) with its own amount and motion."),
    k("pocket", "swings one track against the global GROOVE. HUMAN drifts every hit a few milliseconds, like hands would."),
    k("drums", "two banks: sampled kits and a synth kit. Any drum can pin a one-shot, load a WAV, or \ud83c\udf99 record your own mouth."),
    k("melody", "two sources: the synth, or chops. Load any sample and it lands sliced across the rows, the upper rows at double speed."),

    label("ride"),
    p("Arm \u25cf ride in a sound sheet, hit play, and perform: your moves on the pad and knobs, verb and echo sends included, are captured to the beat and loop with the clip from then on. Rides live in the scene, save with the project, and play in exports. A clip wearing \u223f has one."),

    label("mix"),
    p("Mix opens the mixer. The fader is the meter: drag the handle to set level, the body glows with loudness, the bright bar is the peak. Verb and echo are sends into a shared room. Every roll opens them a little; turn a knob to take a track deeper or dry."),

    label("arrange"),
    k("View", "flips to the timeline. Drag clips, pull a right edge to resize."),
    k("loop strip", "sweep under the bar numbers to set a loop; tap it to switch it on and off."),
    k("\u25cf record", "arm it in the top bar and jam: scene changes and mute moves write into the timeline, and the hatched bars play silent everywhere, exports included."),

    label("keep it"),
    p("File saves the project to a file or keeps it on this device, and exports a WAV (master or four stems, named for your key) through the full studio chain. What you hear live IS the export chain: same compressors, same room, same everything. Staff PNG engraves your chord line onto real staff paper, ready to send to whoever's teaching you. Samples and mouth-drums stay on this device between visits. And you can write a dare into File before saving: the words travel with the project and greet whoever loads it. Nothing checks, nothing grades; the dare is between you two."),
    p("Install it and noodles leaves the browser behind: full screen, its own icon, and everything (sounds, samples, exports) works with no signal at all."),

    label("the theory, if you want it"),
    k("I ii V\u2026", "roman numerals name a chord's job in the key, not its letter; that's why they survive a key change untouched."),
    k("\u266f \u266d", "the key signature is a promise about letters: which ones arrive raised or lowered, every time. The staff prints an accidental only where a note breaks the promise."),
    k("fifths", "neighbors on the circle share six of seven notes; that's why travel by fifths is smooth and the far side sounds far."),
    k("7 9 11 13", "the ladder: each number stacks one more third on the chord, and each rung contains the ones below it."),
    k("sus", "the third steps aside for its neighbor; the chord holds its breath until the third comes back."),
    k("C/E", "a slash chord: the same chord with a chosen note in the bass. The inversion chips are exactly this."),
    k("violet", "a borrowed chord: not from this key, visiting anyway. The dice deals one now and then; the dim wedges are full of them."),
    k("modes", "the same seven notes with a different one called home. The white dot moves the door, not the house."),
    k("gold threads", "voice leading: the fewer notes move between chords, and the shorter their steps, the smoother the change sounds."),

    p("Made for couches and phone speakers. Tell your friends."),

    label("tune it"),
    // A new build arrived while you were playing, so it wasn't taken. It's
    // already downloaded and the next launch runs it — this is just the door,
    // for when you'd rather have it now.
    ...(swUpdateReady
      ? [
          el("div", { class: "tfrow" }, [
            el("div", {
              class: "tfbtn accent",
              text: "new version ready · restart",
              "data-action": "apply-update",
              onclick: () => location.reload(),
            }),
          ]),
        ]
      : []),

    // Only when the browser says it qualifies and isn't installed yet.
    ...(installPrompt
      ? [
          el("div", { class: "tfrow" }, [
            el("div", {
              class: "tfbtn accent",
              text: "install · noodles",
              "data-action": "install-app",
              onclick: async (e) => {
                const prompt = installPrompt;
                if (!prompt) return;
                e.target.textContent = "installing…";
                installPrompt = null;
                try {
                  await prompt.prompt();
                } catch {
                  /* dismissed — the browser menu still has it */
                }
                e.target.remove();
              },
            }),
          ]),
        ]
      : []),

    el("div", { class: "tfrow" }, [
      el("div", {
        class: "tfbtn",
        text: `perf overlay · ${perfHudOn() ? "on" : "off"}`,
        "data-action": "perf-toggle",
        onclick: (e) => {
          if (perfHudOn()) {
            stopPerfHud();
            localStorage.removeItem(PERF_HUD_KEY);
          } else {
            startPerfHud();
            localStorage.setItem(PERF_HUD_KEY, "1");
          }
          e.target.textContent = `perf overlay · ${perfHudOn() ? "on" : "off"}`;
        },
      }),
    ]),

    // Tap response: the audio buffer trade, chosen per device. "safe" is the
    // big-buffer default that never crackles; "tight" asks Android for its
    // low-latency path — worth trying on any phone where taps feel late.
    (() => {
      const KEY = "noodles:tap-feel";
      const cur = () => (localStorage.getItem(KEY) === "tight" ? "tight" : "safe");
      const label = () => `tap response · ${cur()}`;
      const btn = el("div", { class: "tfbtn", text: label(), "data-action": "tap-feel" });
      const restart = el("div", { class: "tfbtn accent", text: "restart to apply", style: "display:none", onclick: () => location.reload() });
      btn.addEventListener("click", () => {
        localStorage.setItem(KEY, cur() === "tight" ? "safe" : "tight");
        btn.textContent = label();
        restart.style.display = "";
      });
      return el("div", { class: "tfrow" }, [btn, restart]);
    })(),

    p("If the moving parts run ahead of or behind what you hear (Bluetooth loves doing this), nudge the visuals until they sit on the sound:"),
    (() => {
      const label = () => `sync ${syncNudgeMs > 0 ? "+" : ""}${syncNudgeMs} ms`;
      const val = el("div", { class: "numval", text: label() });
      const nudge = (d) => {
        syncNudgeMs = Math.max(-250, Math.min(250, syncNudgeMs + d));
        localStorage.setItem(SYNC_NUDGE_KEY, String(syncNudgeMs));
        audio.setSyncNudge(syncNudgeMs);
        val.textContent = label();
      };
      return el("div", { class: "tfrow" }, [
        el("div", { class: "tfbtn", text: "− earlier", "data-action": "sync-nudge-down", onclick: () => nudge(-10) }),
        val,
        el("div", { class: "tfbtn", text: "later +", "data-action": "sync-nudge-up", onclick: () => nudge(10) }),
      ]);
    })(),

    // The build, so a bug report names an exact one. __APP_VERSION__ and
    // __BUILD__ are compiled in by Vite (see vite.config.js) — package.json's
    // version plus the short commit, "-dev" appended when built from a dirty
    // tree.
    el("div", { class: "about-foot", text: `noodles v${__APP_VERSION__} · ${__BUILD__}` }),
  ]);
  sheet.appendChild(body);
  openSheet();
  requestAnimationFrame(() => {
    if (body.scrollHeight > body.clientHeight + 8) {
      const hint = el("div", { class: "scroll-hint", text: "⌄" });
      sheet.appendChild(hint);
      body.addEventListener("scroll", () => hint.remove(), { once: true });
    }
  });
}


// --- Drawn clefs and the letter gutter, shared by every staff ---
// Paths, not glyph fonts (phones don't reliably ship a music font). Real
// engraved outlines via Path2D: the G clef is Wikimedia Commons GClef.svg
// (public domain), the F clef is FClef.svg by っ (CC BY 2.5) — both minimal
// single-glyph files, embedded as their path data. The G spiral's eye
// threads the G line, the F dots flank the F line, and the tiny letters at
// the left edge name every line and space — out of the way, always there.
const G_CLEF_PATH = new Path2D(
  "m12.049 3.5296c0.305 3.1263-2.019 5.6563-4.0772 7.7014-0.9349 0.897-0.155 0.148-0.6437 0.594-0.1022-0.479-0.2986-1.731-0.2802-2.11 0.1304-2.6939 2.3198-6.5875 4.2381-8.0236 0.309 0.5767 0.563 0.6231 0.763 1.8382zm0.651 16.142c-1.232-0.906-2.85-1.144-4.3336-0.885-0.1913-1.255-0.3827-2.51-0.574-3.764 2.3506-2.329 4.9066-5.0322 5.0406-8.5394 0.059-2.232-0.276-4.6714-1.678-6.4836-1.7004 0.12823-2.8995 2.156-3.8019 3.4165-1.4889 2.6705-1.1414 5.9169-0.57 8.7965-0.8094 0.952-1.9296 1.743-2.7274 2.734-2.3561 2.308-4.4085 5.43-4.0046 8.878 0.18332 3.334 2.5894 6.434 5.8702 7.227 1.2457 0.315 2.5639 0.346 3.8241 0.099 0.2199 2.25 1.0266 4.629 0.0925 6.813-0.7007 1.598-2.7875 3.004-4.3325 2.192-0.5994-0.316-0.1137-0.051-0.478-0.252 1.0698-0.257 1.9996-1.036 2.26-1.565 0.8378-1.464-0.3998-3.639-2.1554-3.358-2.262 0.046-3.1904 3.14-1.7356 4.685 1.3468 1.52 3.833 1.312 5.4301 0.318 1.8125-1.18 2.0395-3.544 1.8325-5.562-0.07-0.678-0.403-2.67-0.444-3.387 0.697-0.249 0.209-0.059 1.193-0.449 2.66-1.053 4.357-4.259 3.594-7.122-0.318-1.469-1.044-2.914-2.302-3.792zm0.561 5.757c0.214 1.991-1.053 4.321-3.079 4.96-0.136-0.795-0.172-1.011-0.2626-1.475-0.4822-2.46-0.744-4.987-1.116-7.481 1.6246-0.168 3.4576 0.543 4.0226 2.184 0.244 0.577 0.343 1.197 0.435 1.812zm-5.1486 5.196c-2.5441 0.141-4.9995-1.595-5.6343-4.081-0.749-2.153-0.5283-4.63 0.8207-6.504 1.1151-1.702 2.6065-3.105 4.0286-4.543 0.183 1.127 0.366 2.254 0.549 3.382-2.9906 0.782-5.0046 4.725-3.215 7.451 0.5324 0.764 1.9765 2.223 2.7655 1.634-1.102-0.683-2.0033-1.859-1.8095-3.227-0.0821-1.282 1.3699-2.911 2.6513-3.198 0.4384 2.869 0.9413 6.073 1.3797 8.943-0.5054 0.1-1.0211 0.143-1.536 0.143z"
);
const F_CLEF_PATHS = [
  "M 243.97900,540.86798 C 244.02398,543.69258 242.76360,546.43815 240.76469,548.40449 C 238.27527,550.89277 235.01791,552.47534 231.69762,553.53261 C 231.25590,553.77182 230.58970,553.45643 231.28550,553.13144 C 232.62346,552.52289 234.01319,552.00050 235.24564,551.18080 C 237.96799,549.49750 240.26523,546.84674 240.82279,543.61854 C 241.14771,541.65352 241.05724,539.60795 240.56484,537.67852 C 240.20352,536.25993 239.22033,534.79550 237.66352,534.58587 C 236.25068,534.36961 234.74885,534.85905 233.74057,535.88093 C 233.47541,536.14967 232.95916,536.89403 233.04435,537.74747 C 233.64637,537.27468 233.60528,537.32732 234.09900,537.10717 C 235.23573,536.60031 236.74349,537.32105 237.02700,538.57272 C 237.32909,539.72295 237.09551,541.18638 235.96036,541.79960 C 234.77512,542.44413 233.02612,542.17738 232.36450,540.90866 C 231.26916,538.95418 231.87147,536.28193 233.64202,534.92571 C 235.44514,533.42924 238.07609,533.37089 240.19963,534.13862 C 242.38419,534.95111 243.68629,537.21483 243.89691,539.45694 C 243.95419,539.92492 243.97896,540.39668 243.97900,540.86798 z",
  "M 248.25999,536.80200 C 248.26766,537.17138 248.11044,537.54065 247.82878,537.78185 C 247.46853,538.11076 246.91933,538.17813 246.47048,538.01071 C 246.02563,537.83894 245.69678,537.39883 245.67145,536.92060 C 245.63767,536.54689 245.75685,536.15479 246.02747,535.88867 C 246.28257,535.61680 246.66244,535.48397 247.03147,535.50645 C 247.41131,535.51452 247.77805,535.70601 248.00489,536.01019 C 248.17962,536.23452 248.26238,536.51954 248.25999,536.80200 z",
  "M 248.25999,542.64502 C 248.26772,543.01469 248.11076,543.38446 247.82878,543.62585 C 247.46853,543.95476 246.91933,544.02213 246.47048,543.85472 C 246.02537,543.68288 245.69655,543.24237 245.67145,542.76389 C 245.63651,542.38990 245.76354,542.00308 246.02700,541.73300 C 246.27663,541.45454 246.66060,541.32790 247.02845,541.34950 C 247.51230,541.36282 247.95159,541.69251 248.15162,542.12465 C 248.22565,542.28740 248.26043,542.46657 248.25999,542.64502 z",
].map((d) => new Path2D(d));
// x is the glyph's left edge; gY/fY are the staff lines the glyphs anchor:
// the spiral's eye local-y (G) and the dots' midpoint local-y (F), measured
// from the source viewBoxes, land exactly on them.
const G_CLEF_EYE_Y = 25.5; // of 40.768 tall, box 15.186 wide
function drawGClef(c, x, gY, S) {
  const k = (7.0 * S) / 40.768;
  c.save();
  c.translate(x, gY - G_CLEF_EYE_Y * k);
  c.scale(k, k);
  c.fillStyle = "rgba(240,240,244,0.92)";
  c.fill(G_CLEF_PATH);
  c.restore();
}
function drawFClef(c, x, fY, S) {
  const k = S / 5.84; // dot centers sit a space apart, one over one under F
  c.save();
  c.translate(x, fY - 6.18 * k);
  c.scale(k, k);
  c.translate(-230.9546, -533.6597); // the source file's group offset
  c.fillStyle = "rgba(240,240,244,0.92)";
  for (const p of F_CLEF_PATHS) c.fill(p);
  c.restore();
}
function drawStaffLetters(c, yOf, baseStep, bass, S) {
  const letters = bass ? "GABCDEFGA" : "EFGABCDEF";
  c.textAlign = "left";
  c.textBaseline = "middle";
  c.font = `600 ${Math.max(5.5, Math.round(S * 0.75))}px system-ui, sans-serif`;
  c.fillStyle = "rgba(255,255,255,0.32)";
  // Two staggered columns - lines left, spaces right - because at a
  // half-gap pitch one column buries itself.
  for (let u = 0; u <= 8; u++) c.fillText(letters[u], u % 2 ? 2.5 + S * 0.8 : 2.5, yOf(baseStep + u));
}

// Engrave a harmony line onto a 2d context — as a GRAND STAFF, the way a
// chart with a real bass register is actually written: treble and bass
// staves joined by a system line, each note routed to whichever staff needs
// fewer ledger lines (middle C hangs between them), signatures on both
// (bass positions sit two steps lower — the standard rule the roll staffs
// already follow), one bar per chord voiced exactly as playback voices it
// (led triad, stack climbing tone over tone, slash bass at its seat).
// Shared by the harmony editor's live staff and the export sheet's PNG
// engraver — one painter, so what you read is what either surface heard.
// Returns { startX, right } so a caller can align its own grid (the chord
// slots) under the bars; gridGap makes bar centers match a CSS grid's
// gapped cells exactly.
function paintChordStaff(c, { w, h, S, key, scale, harmony, harmonyOct = 0, bg = null, title = "", gridGap = 0 }) {
  if (bg) {
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
  }
  const T_BOT = 37; // E4: treble bottom line
  const B_BOT = 25; // G2: bass bottom line
  // Vertical plan: 4S treble + 3S gap + 4S bass, centered with at least
  // 3.5S of air above (three ledger lines plus the head - the 8va guard
  // caps anything taller) and 2.5S of cellar below (C2 sits two ledgers
  // under the bass staff and never deeper - the routing guarantees it).
  const M = Math.max(3.5 * S, (h - 13.5 * S) / 2);
  const trebleBottom = M + 4 * S;
  const bassBottom = trebleBottom + 7 * S;
  const yT = (step) => trebleBottom - (step - T_BOT) * (S / 2);
  const yB = (step) => bassBottom - (step - B_BOT) * (S / 2);
  c.strokeStyle = "rgba(255,255,255,0.34)";
  c.lineWidth = 1;
  for (let l = 0; l < 5; l++) {
    for (const bot of [trebleBottom, bassBottom]) {
      const y = bot - l * S;
      c.beginPath();
      c.moveTo(4, y);
      c.lineTo(w - 4, y);
      c.stroke();
    }
  }
  // The system line: one stroke joining the staves at the left edge.
  c.beginPath();
  c.moveTo(4, trebleBottom - 4 * S);
  c.lineTo(4, bassBottom);
  c.stroke();
  c.fillStyle = "rgba(240,240,244,0.9)";
  c.strokeStyle = "rgba(240,240,244,0.9)";
  c.textBaseline = "middle";
  drawStaffLetters(c, yT, T_BOT, false, S);
  drawStaffLetters(c, yB, B_BOT, true, S);
  drawGClef(c, S * 1.8, yT(T_BOT + 2), S);
  drawFClef(c, S * 1.7, yB(B_BOT + 6), S);
  const sig = keySignature(key, scale);
  const SHARP_UNITS = [8, 5, 9, 6, 3, 7, 4];
  const FLAT_UNITS = [4, 7, 3, 6, 2, 5, 1];
  c.font = `600 ${Math.round(S * 2.2)}px system-ui, sans-serif`;
  c.textAlign = "center";
  let x = S * 5.2;
  for (let i = 0; i < Math.abs(sig); i++) {
    const u = (sig > 0 ? SHARP_UNITS : FLAT_UNITS)[i];
    const glyph = sig > 0 ? "\u266f" : "\u266d";
    const lift = sig > 0 ? 0 : S * 0.3;
    c.fillText(glyph, x, yT(T_BOT + u) - lift);
    c.fillText(glyph, x, yB(B_BOT + u - 2) - lift); // bass signature: two steps lower
    x += S * 0.95;
  }
  const startX = x + S * 1.0;
  const right = w - 10;
  const oct = 12 * harmonyOct;
  let prev = null;
  const span = Math.max(40, right - startX);
  const cellW = (span - gridGap * (harmony.length - 1)) / harmony.length;
  // How many ledger lines a note at rel (steps above a staff's bottom line)
  // would need; the router sends each note to the cheaper staff, treble on
  // ties - middle C goes up, exactly the convention.
  const ledgers = (rel) => (rel < 0 ? Math.floor(-rel / 2) : rel > 8 ? Math.floor((rel - 8) / 2) : 0);
  // One staff's worth of engraving: ledgers, accidentals against the
  // signature, open noteheads with their low-key letters inside.
  function engrave(notes, yOf, base, cx) {
    for (let k = 1; k < notes.length; k++) {
      if (notes[k].step - notes[k - 1].step === 1 && !notes[k - 1].dx) notes[k].dx = S * 0.95;
    }
    let accCount = 0;
    for (const n of notes) {
      const rel = n.step - base;
      c.strokeStyle = "rgba(255,255,255,0.34)";
      c.lineWidth = 1;
      for (let u = -2; u >= rel; u -= 2) {
        const y = yOf(base + u);
        c.beginPath();
        c.moveTo(cx - S, y);
        c.lineTo(cx + S, y);
        c.stroke();
      }
      for (let u = 10; u <= rel; u += 2) {
        const y = yOf(base + u);
        c.beginPath();
        c.moveTo(cx - S, y);
        c.lineTo(cx + S, y);
        c.stroke();
      }
      if (n.acc !== signatureAccFor(n.letter, sig)) {
        c.fillStyle = "rgba(240,240,244,0.95)";
        c.font = `600 ${Math.round(S * 1.9)}px system-ui, sans-serif`;
        c.textAlign = "right";
        const glyph = n.acc > 0 ? "\u266f" : n.acc < 0 ? "\u266d" : "\u266e";
        c.fillText(glyph, cx - S * 0.9 - accCount * S * 0.75, yOf(n.step) - (n.acc < 0 ? S * 0.3 : 0));
        c.textAlign = "left";
        accCount += 1;
      }
      c.strokeStyle = "#f0f0f4";
      c.lineWidth = 1.8;
      c.beginPath();
      c.ellipse(cx + (n.dx || 0), yOf(n.step), S * 0.68, S * 0.5, -0.25, 0, Math.PI * 2);
      c.stroke();
      // Each head carries its letter, low-key, inside the open notehead -
      // the staff teaches its own spelling without a legend.
      c.fillStyle = "rgba(240,240,244,0.55)";
      c.font = `700 ${Math.round(S * 0.6)}px system-ui, sans-serif`;
      c.textAlign = "center";
      c.fillText("CDEFGAB"[n.letter], cx + (n.dx || 0), yOf(n.step) + S * 0.04);
    }
    return accCount;
  }
  // Voice leading, drawn where the voices actually live: after every tower
  // is engraved, gold lines join held tones head-to-head and dim lines
  // slope where a voice steps - the same chain playback walks (voiceLead
  // index IS voice identity). Segments run only through the white space
  // between towers: they start past a head's edge and stop short of the
  // next bar's accidental column, so nothing overlaps a symbol.
  const barThreads = [];
  harmony.forEach((entry, i) => {
    const ch = harmonyChord(entry);
    const voiced = (prev = voiceLead(ch.pcs.slice(0, 3), prev));
    const tones = spellChordTones(entry);
    const cx = startX + i * (cellW + gridGap) + cellW / 2;
    // The full tower: led triad, then the stack climbing tone over tone -
    // the same shape playback voices - plus the slash bass at its low seat.
    const midis = voiced.slice();
    let topM = Math.max(...voiced);
    for (const pc of ch.pcs.slice(3)) {
      const m = pc + 12 * Math.ceil((topM + 1 - pc) / 12);
      midis.push(m);
      topM = m;
    }
    const inv = (typeof entry === "object" && entry.inv) || 0;
    if (inv > 0) midis.push(36 + ch.bass);
    const notes = midis
      .map((m, mi) => {
        const midi = m + oct;
        const pc = ((midi % 12) + 12) % 12;
        const t = tones.find((tt) => tt.pc === pc) || tones[0];
        return { step: Math.floor((midi - t.acc) / 12) * 7 + t.letter, acc: t.acc, letter: t.letter, voiceIdx: mi < 3 ? mi : -1 };
      })
      .sort((a, b) => a.step - b.step);
    let treble = notes.filter((n) => ledgers(n.step - T_BOT) <= ledgers(n.step - B_BOT));
    const bass = notes.filter((n) => ledgers(n.step - T_BOT) > ledgers(n.step - B_BOT));
    // 8va, treble only: if a pinched register still towers off the top,
    // write it an octave lower and say so - the ottava convention, taught
    // in passing. The bass staff never needs one; routing caps its cellar.
    let octDrop = 0;
    while (treble.length && treble[treble.length - 1].step - octDrop * 7 - T_BOT > 14 && octDrop < 2) octDrop++;
    if (octDrop) {
      treble = treble.map((n) => ({ ...n, step: n.step - octDrop * 7 }));
      c.fillStyle = "rgba(240,240,244,0.7)";
      c.font = `italic 700 ${Math.round(S * 1.1)}px system-ui, sans-serif`;
      c.textAlign = "center";
      c.fillText(octDrop === 1 ? "8va" : "15ma", cx, Math.max(S * 0.8, yT(treble[treble.length - 1].step) - S * 1.6));
    }
    const accT = engrave(treble, yT, T_BOT, cx);
    const accB = engrave(bass, yB, B_BOT, cx);
    const pad = (acc) => S * 0.95 + acc * S * 0.75 + S * 0.85;
    const voices = [0, 1, 2].map((j) => {
      const onT = treble.find((n) => n.voiceIdx === j);
      const n = onT || bass.find((n2) => n2.voiceIdx === j);
      if (!n) return null;
      return { x: cx + (n.dx || 0), y: onT ? yT(n.step) : yB(n.step), leftPad: pad(onT ? accT : accB) };
    });
    barThreads.push({ voices, midis: voiced.map((v) => v + oct), pcs: ch.pcs.slice(0, 3), raw: voiced });
  });
  const seg = (x0, y0, x1, y1, held, alpha) => {
    if (x1 <= x0) return;
    c.strokeStyle = held ? `rgba(232,184,75,${0.85 * alpha})` : `rgba(210,210,216,${0.34 * alpha})`;
    c.lineWidth = held ? 2 : 1.2;
    c.beginPath();
    c.moveTo(x0, y0);
    c.lineTo(x1, y1);
    c.stroke();
  };
  for (let i = 1; i < barThreads.length; i++) {
    const a = barThreads[i - 1];
    const b = barThreads[i];
    for (let j = 0; j < 3; j++) {
      if (!a.voices[j] || !b.voices[j]) continue;
      seg(a.voices[j].x + S * 0.85, a.voices[j].y, b.voices[j].x - b.voices[j].leftPad, b.voices[j].y, a.midis[j] === b.midis[j], 1);
    }
  }
  // The wrap, as exit stubs: the loop's next voicing continues from the last
  // bar, so each voice leaves toward where it will actually land on bar one.
  if (barThreads.length > 1) {
    const last = barThreads[barThreads.length - 1];
    const wrapV = voiceLead(barThreads[0].pcs, last.raw);
    for (let j = 0; j < 3; j++) {
      if (!last.voices[j] || !wrapV) continue;
      const dyPerX = 0.12; // gentle exit slope toward the wrap target
      const dir = Math.sign(wrapV[j] - last.raw[j]);
      const x0 = last.voices[j].x + S * 0.85;
      seg(x0, last.voices[j].y, Math.min(right - 2, x0 + S * 2.4), last.voices[j].y - dir * S * dyPerX * 12, wrapV[j] === last.raw[j], 0.5);
    }
  }
  // The plate caption takes the top-left corner: the treble 8va guard keeps
  // towers off it, and bars never start left of the signature.
  if (title) {
    c.fillStyle = "rgba(240,240,244,0.65)";
    c.font = `600 ${Math.round(S * 1.05)}px system-ui, sans-serif`;
    c.textAlign = "left";
    c.fillText(title, 10, S * 1.1);
  }
  return { startX, right };
}

// The compass: twelve station dots, the sector arc, and a bright dot on the
// front door — the wheel's whole story at sixteen pixels, always in the
// footer. Redrawn with the footer on every key move.
function drawKeyGlyph(canvas) {
  const s = 26;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = canvas.height = Math.round(s * dpr);
  canvas.style.width = canvas.style.height = s + "px";
  const c = canvas.getContext("2d");
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const H = stationOfPc(relMajorPc(song.key, song.scale));
  const mid = s / 2;
  const r = mid - 3;
  const ang = (st) => (st * Math.PI) / 6 - Math.PI / 2;
  c.strokeStyle = "rgba(232,184,75,0.95)";
  c.lineWidth = 2.4;
  c.lineCap = "round";
  c.beginPath();
  c.arc(mid, mid, r, ang(H - 1.5), ang(H + 1.5));
  c.stroke();
  c.fillStyle = "rgba(255,255,255,0.35)";
  for (let i = 0; i < 12; i++) {
    const rel = (((i - H) % 12) + 12) % 12;
    if (rel <= 1 || rel === 11) continue;
    c.beginPath();
    c.arc(mid + Math.cos(ang(i)) * r, mid + Math.sin(ang(i)) * r, 1.1, 0, Math.PI * 2);
    c.fill();
  }
  const tonic = harmonyChord(0).pcs;
  const minorish = (tonic[1] - tonic[0] + 12) % 12 === 3;
  const doorSt = stationOfPc(minorish ? (tonic[0] + 3) % 12 : tonic[0]);
  c.fillStyle = "#fff";
  c.beginPath();
  c.arc(mid + Math.cos(ang(doorSt)) * r, mid + Math.sin(ang(doorSt)) * r, 2.2, 0, Math.PI * 2);
  c.fill();
}

// ---------------------------------------------------------------------------
// The circle sheet: the wheel, a scale row, and the ● that lets taps land in
// the playing clip. Everything theoretical on it is pull — names on hold,
// signatures at whisper opacity, the order of sharps only while you travel.
// ---------------------------------------------------------------------------
const circleSubText = () => {
  const sig = keySignature(song.key, song.scale);
  const label = sig === 0 ? "♮" : sig > 0 ? `${sig}♯` : `${-sig}♭`;
  return `${keyDisplayName(song.key, song.scale)} ${song.scale} · ${label}`;
};

function updateCircleChrome() {
  if (sheetId !== "circle") return;
  const sub = sheet.querySelector(".sheet-bar .sub");
  if (sub) sub.textContent = circleSubText();
  sheet.querySelectorAll("[data-scale]").forEach((c) => c.classList.toggle("accent", c.dataset.scale === song.scale));
}

function openCircleSheet() {
  resetSheet("#e8b84b");
  sheetId = "circle";
  const armBtn = el("div", {
    class: "close circle-arm" + (circleArmed ? " on" : ""),
    text: "●",
    title: "Armed: taps write into the playing clip",
    "data-action": "circle-arm",
    onclick: () => {
      circleArmed = !circleArmed;
      armBtn.classList.toggle("on", circleArmed);
      buzz(6);
    },
  });
  sheet.appendChild(sheetBar("Circle", circleSubText(), { buttons: [armBtn] }));
  sheet.appendChild(circleView.el);
  sheet.appendChild(
    el(
      "div",
      { class: "tfrow circle-scale" },
      SCALE_NAMES.map((n) =>
        el("div", {
          class: "tfbtn" + (n === song.scale ? " accent" : ""),
          text: n,
          "data-scale": n,
          onclick: () => circleKeyScale(song.key, n),
        })
      )
    )
  );
  openSheet();
  circleView.opened();
}

function emptyScene() {
  return makeScene(
    [0, 0, 0, 0],
    Object.fromEntries(DRUM_VOICES.map((v) => [v, new Array(16).fill(false)])),
    new Array(16).fill(null),
    new Array(16).fill(null)
  );
}

function insertSceneAt(index, scene) {
  const at = Math.max(0, Math.min(song.scenes.length, index));
  for (const track of ARRANGE_TRACKS) {
    for (const clip of song.arrangement[track]) {
      if (clip.scene >= at) clip.scene += 1;
    }
  }
  song.scenes.splice(at, 0, scene);
  return at;
}

function swapScenes(a, b) {
  if (a === b || !song.scenes[a] || !song.scenes[b]) return;
  const tmp = song.scenes[a];
  song.scenes[a] = song.scenes[b];
  song.scenes[b] = tmp;
  for (const track of ARRANGE_TRACKS) {
    for (const clip of song.arrangement[track]) {
      if (clip.scene === a) clip.scene = b;
      else if (clip.scene === b) clip.scene = a;
    }
  }
}

function deleteSceneAt(index) {
  if (song.scenes.length <= 1 || !song.scenes[index]) return false;
  song.scenes.splice(index, 1);
  for (const track of ARRANGE_TRACKS) {
    song.arrangement[track] = song.arrangement[track]
      .filter((clip) => clip.scene !== index)
      .map((clip) => ({ ...clip, scene: clip.scene > index ? clip.scene - 1 : clip.scene }));
  }
  if (playingScene === index) playingScene = -1;
  else if (playingScene > index) playingScene -= 1;
  for (const t of TRACKS) {
    if (playingTracks[t.key] === index) playingTracks[t.key] = -1;
    else if (playingTracks[t.key] > index) playingTracks[t.key] -= 1;
    if (queuedSceneTracks[t.key] === index) queuedSceneTracks[t.key] = -1;
    else if (queuedSceneTracks[t.key] > index) queuedSceneTracks[t.key] -= 1;
  }
  return true;
}

function openAddSceneSheet() {
  resetSheet("#e8b84b");
  const baseIndex = playingScene >= 0 ? playingScene : song.scenes.length - 1;
  const addScene = (scene) => {
    pushUndo();
    insertSceneAt(song.scenes.length, scene);
    closeEditor();
    renderSession();
    if (view === "arrangement") renderArrangement();
  };
  sheet.appendChild(sheetBar("Add Scene", "blank · duplicate · magic"));
  sheet.appendChild(
    el("div", { class: "tfrow" }, [
      el("div", { class: "tfbtn", text: "Blank", onclick: () => addScene(emptyScene()) }),
      el("div", { class: "tfbtn", text: "Duplicate Current", onclick: () => addScene(cloneScene(song.scenes[baseIndex])) }),
      el("div", { class: "tfbtn accent", text: "Magic", onclick: () => addScene(fitBassRegister(makeMagicScene(song.vibe))) }),
    ])
  );
  openSheet();
}


function setView(v) {
  if (v === view) return;
  view = v;
  document.getElementById("app").classList.toggle("arrange", v === "arrangement");
  if (v === "arrangement") {
    if (!audio.playing) audio.enterArrangement();
    renderArrangement();
  }
  renderTransport();
}
function updatePlayBtn(on) {
  playBtn.classList.toggle("on", on);
  playBtn.textContent = on ? "⏹" : "▶";
}
function clampTempo(v) {
  return Math.max(TEMPO_MIN, Math.min(TEMPO_MAX, Math.round(v)));
}
function updateTempoUI() {
  if (!bpmEl) return;
  bpmEl.innerHTML = `${song.tempo}<small>BPM</small>`;
}
function applyTempo(v) {
  const next = clampTempo(v);
  if (!Number.isFinite(next) || next === song.tempo) return false;
  song.tempo = next;
  updateTempoUI();
  audio.setTempo(song.tempo);
  return true;
}
function bindTempoControl(node) {
  node.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openTempoEditor();
    }
  });
  node.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startTempo = song.tempo;
    const pre = snapshot();
    let dragging = false;
    let changed = false;
    node.classList.add("dragging");
    capturePointer(node, e.pointerId);
    const move = (ev) => {
      const dx = ev.clientX - startX;
      const dy = startY - ev.clientY;
      if (!dragging && Math.hypot(dx, dy) < 7) return;
      dragging = true;
      const delta = Math.round(dy / 2 + dx / 6);
      changed = applyTempo(startTempo + delta) || changed;
    };
    const up = () => {
      node.classList.remove("dragging");
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", up);
      node.removeEventListener("pointercancel", cancel);
      if (dragging) {
        if (changed) commitUndo(pre);
      } else {
        openTempoEditor();
      }
    };
    const cancel = () => {
      node.classList.remove("dragging");
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", up);
      node.removeEventListener("pointercancel", cancel);
      if (changed) commitUndo(pre);
    };
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerup", up);
    node.addEventListener("pointercancel", cancel);
  });
}

function openTempoEditor() {
  resetSheet("#e8b84b");
  const input = el("input", {
    class: "tempo-input",
    type: "number",
    inputmode: "numeric",
    min: String(TEMPO_MIN),
    max: String(TEMPO_MAX),
    step: "1",
    value: String(song.tempo),
  });
  const setTypedTempo = () => {
    const next = Number(input.value);
    if (Number.isFinite(next) && clampTempo(next) !== song.tempo) {
      pushUndo();
      applyTempo(next);
    }
    closeEditor();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") setTypedTempo();
  });
  // Tap tempo: average the last few tap intervals into the input.
  const taps = [];
  const tapBtn = el("div", {
    class: "tfbtn tap-tempo",
    text: "tap the beat",
    onclick: () => {
      const now = performance.now();
      while (taps.length && now - taps[taps.length - 1] > 2500) taps.length = 0;
      taps.push(now);
      if (taps.length >= 2) {
        const gaps = taps.slice(1).map((t, i) => t - taps[i]);
        const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
        input.value = String(clampTempo(60000 / avg));
        tapBtn.textContent = `tap the beat · ${input.value}`;
      }
      if (taps.length > 6) taps.shift();
    },
  });
  sheet.appendChild(sheetBar("Tempo", `${TEMPO_MIN}-${TEMPO_MAX} BPM`, { onDone: setTypedTempo }));
  sheet.appendChild(el("div", { class: "tempo-sheet" }, [input, tapBtn]));
  openSheet();
  setTimeout(() => {
    input.focus();
    input.select();
  }, 40);
}

// The dice: exactly what a fresh page load rolls — new key, scale, tempo,
// device presets, and one magic scene — without the reload. Undo brings the
// song back (device presets stay rolled; they're not part of song snapshots).
function rerollSong() {
  pushUndo();
  const fresh = makeSong();
  for (const key of Object.keys(song)) delete song[key];
  Object.assign(song, fresh);
  randomizePresets(song.vibe);
  for (const sc of song.scenes) fitBassRegister(sc);
  applyVibeMix(song.vibe); // refreshAll below pushes tempo/swing to the engine
  selClip = null;
  arrPlayBar = 0;
  playingScene = -1;
  for (const t of TRACKS) playingTracks[t.key] = -1;
  refreshAll();
  // Reclaim the old song's voice-pool growth once its tails have released —
  // each roll otherwise leaves the pools a little fuller, and the phone's
  // audio thread pays for every pooled voice's running param sources.
  setTimeout(() => audio.trimVoices?.(), 1500);
}

// Change the global key/scale; harmony follows automatically (it's degree-based),
// and bass/melody are transposed + re-snapped so the whole song stays in key.
function applyKeyScale(key, scale) {
  const delta = key - song.key;
  song.key = ((key % 12) + 12) % 12;
  song.scale = scale;
  setScaleContext(song.key, song.scale);
  const melodyIsChops = audio.patch("melody").source === "chops";
  for (const sc of song.scenes) {
    for (const trk of ["bass", "melody"]) {
      // Chops rows are slice indices, not pitches — key travel leaves them be.
      if (trk === "melody" && melodyIsChops) continue;
      for (let s = 0; s < 16; s++) {
        for (const n of noteSlot(sc[trk][s])) n.midi = snapToScale(n.midi + delta);
      }
    }
    // Borrowed chords ride the same transposition, so a ♭VI stays a ♭VI.
    sc.harmony = sc.harmony.map((e) =>
      typeof e === "number" ? e : { pcs: e.pcs.map((p) => ((p + delta) % 12 + 12) % 12) }
    );
  }
}

// The circle's commit path: same transpose as ever, but the sheet stays up —
// refreshAll would slam it shut mid-travel. Everything it re-renders sits
// behind the scrim anyway; the circle repaints its own wheel.
function circleKeyScale(key, scale) {
  if (key === song.key && scale === song.scale) return;
  pushUndo();
  applyKeyScale(key, scale);
  renderTransport();
  renderSession();
  if (view === "arrangement") renderArrangement();
  updateUndoButtons();
  circleView.refreshStatic();
  updateCircleChrome();
  // Travel from the editor's own wheel: rebuild the open editor so slots,
  // staff, threads, and wheel all speak the new key.
  if (editor?.track === "harmony") openEditor(editor.scene, editor.track);
}

// ---------------------------------------------------------------------------
// Session grid
// ---------------------------------------------------------------------------
const sessionEl = document.getElementById("session");

// One home for the mini-bar heights: clipContent builds with them, and
// paintClipMini writes them in place during a drag-paint.
const drumBarHeight = (drums, s) =>
  drums.kick[s] || drums.snare[s] || drums.clap[s] ? 15 : drums.hat[s] ? 8 : 3;
const noteBarHeight = (slot) => {
  const notes = noteSlot(slot);
  return notes.length ? Math.round(4 + slotPeakVel(slot) * 9 + Math.min(4, notes.length - 1) * 2) : 3;
};

function clipContent(scene, track) {
  if (track === "harmony") {
    if (!scene.harmony || scene.harmony.length === 0) return null;
    return el("div", {
      class: "harmony-mini",
      html: scene.harmony.map((ci) => `<div>${chordMarkup(ci)}</div>`).join("")
    });
  }
  if (track === "drums") {
    if (!scene.drums || !Object.values(scene.drums).some(v => v.some(x => x))) return null;
    const mini = el("div", { class: "mini" });
    for (let s = 0; s < 16; s++) {
      mini.appendChild(el("i", { style: `height:${drumBarHeight(scene.drums, s)}px` }));
    }
    return mini;
  }
  if (track === "melody" || track === "bass") {
    if (!scene[track] || !scene[track].some(n => n !== null)) return null;
    const mini = el("div", { class: "mini" });
    const lane = scene[track];
    for (let s = 0; s < 16; s++) {
      mini.appendChild(el("i", { style: `height:${noteBarHeight(lane[s])}px` }));
    }
    return mini;
  }
  return null;
}

// Depth made visible: a sub-bar loop shows its step count, a lane whose bar
// count DIFFERS from the harmony's shows its bars, a motion ride shows a
// wave — bottom-left, mirroring the launch badge. Since D21 rolled every
// lane at four bars, matching lengths are the norm and wear nothing.
function stateBadge(scene, track) {
  const bits = [];
  const len = stepsFor(scene, track);
  const harmonyBars = Math.max(1, scene.harmony?.length || 1);
  if (track !== "harmony" && len < 16) bits.push(String(len));
  else if (track !== "harmony" && len !== 16 && len / 16 !== harmonyBars) bits.push(`${len / 16}bar`);
  if (scene.motion?.[track] && Object.keys(scene.motion[track]).length) bits.push("∿");
  return bits.length ? el("div", { class: "clip-badge state", text: bits.join(" ") }) : null;
}

function launchBadge(scene, track) {
  const launch = clipLaunch(scene, track);
  const bits = [];
  if (launch.mode === "oneshot") bits.push("1x");
  if (launch.follow === "next") bits.push("next");
  else if (launch.follow === "prev") bits.push("prev");
  else if (launch.follow === "random") bits.push("rnd");
  return bits.length ? el("div", { class: "clip-badge", text: bits.join(" ") }) : null;
}

function bindSessionClip(clip, sceneIndex, track, filled) {
  let timer = 0;
  let longPress = false;
  let startX = 0;
  let startY = 0;
  let moved = false;
  const clear = () => {
    clearTimeout(timer);
    timer = 0;
    clip.classList.remove("pressing");
  };
  clip.addEventListener("pointerdown", (e) => {
    longPress = false;
    moved = false;
    startX = e.clientX;
    startY = e.clientY;
    if (filled) clip.classList.add("pressing");
    timer = window.setTimeout(() => {
      longPress = true;
      clear();
      if (filled) beginClipDrag(e, clip, sceneIndex, track);
    }, 480);
  });
  clip.addEventListener("pointermove", (e) => {
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > 12) {
      moved = true;
      clear();
    }
  });
  clip.addEventListener("pointerup", clear);
  clip.addEventListener("pointercancel", clear);
  clip.addEventListener("click", () => {
    if (longPress || moved) return;
    if (filled) openEditor(sceneIndex, track);
    else openNewClipSheet(sceneIndex, track);
  });
}

// Long-press on a filled clip: drag it vertically to another scene slot
function beginClipDrag(origEv, clip, sceneIndex, track) {
  // gather all scene slot positions for this track column
  const allSlots = [...document.querySelectorAll(`.clip[data-track="${track}"]`)];
  if (!allSlots.length) return;
  const rects = allSlots.map((sl) => ({ el: sl, rect: sl.getBoundingClientRect(), si: parseInt(sl.dataset.scene, 10) }));
  clip.style.opacity = "0.4";
  let targetSI = sceneIndex;
  let moved = false;
  const move = (ev) => {
    const hit = rects.find((r) => ev.clientY >= r.rect.top && ev.clientY < r.rect.bottom);
    if (hit) {
      rects.forEach((r) => r.el.style.outline = "");
      hit.el.style.outline = "2px solid #e8b84b";
      if (hit.si !== sceneIndex) moved = true;
      targetSI = hit.si;
    }
  };
  const up = () => {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", up);
    clip.style.opacity = "";
    rects.forEach((r) => r.el.style.outline = "");
    if (targetSI !== sceneIndex) {
      pushUndo();
      // Swap the clip data between the two scene slots for this track
      const srcScene = song.scenes[sceneIndex];
      const dstScene = song.scenes[targetSI];
      // For drums, harmony, bass, melody — swap the data fields
      const tmp = structuredClone(srcScene[track]);
      srcScene[track] = structuredClone(dstScene[track]);
      dstScene[track] = tmp;
      const tl = srcScene.launch?.[track];
      const tdl = dstScene.launch?.[track];
      if (srcScene.launch && dstScene.launch) {
        srcScene.launch[track] = structuredClone(tdl);
        dstScene.launch[track] = structuredClone(tl);
      }
      renderSession();
    } else if (!moved) {
      openClipProps(sceneIndex, track);
    }
  };
  document.addEventListener("pointermove", move, { passive: true });
  document.addEventListener("pointerup", up);
}

function openNewClipSheet(sceneIndex, track) {
  // An empty slot was tapped — offer to create a clip or do nothing
  // For now, opening the editor on an empty slot makes sense (adds content on edit)
  openEditor(sceneIndex, track);
}

// Scene label cell: single tap = launch, long press = Scene Options
function bindSceneCell(launch, sceneIndex) {
  let timer = 0;
  let longPress = false;
  let startX = 0, startY = 0;
  const clear = () => { clearTimeout(timer); timer = 0; };
  launch.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".scene-opt-btn")) return;
    longPress = false;
    startX = e.clientX; startY = e.clientY;
    timer = window.setTimeout(() => {
      longPress = true;
      clear();
      openSceneOptions(sceneIndex);
    }, 480);
  });
  launch.addEventListener("pointermove", (e) => {
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > 12) clear();
  });
  launch.addEventListener("pointerup", clear);
  launch.addEventListener("pointercancel", clear);
  launch.addEventListener("click", async () => {
    if (longPress) return;
    await ensureStarted();
    // While playing, a launch only QUEUES — the engine's queue event paints
    // the queued state next frame and the boundary tick flips it to playing.
    // Marking it playing here painted the new scene green a bar early, then
    // the next step event snapped it back: the launch-flash bug.
    const wasPlaying = audio.playing;
    audio.launchScene(sceneIndex);
    if (!wasPlaying) setPlaying(sceneIndex);
    updatePlayBtn(true);
  });
}

function openSceneOptions(sceneIndex) {
  const scene = song.scenes[sceneIndex];
  resetSheet("#e8b84b");
  sheet.appendChild(sheetBar("Scene Options", `Scene ${scene.tag}`));
  sheet.appendChild(
    el("div", { class: "tfrow" }, [
      el("div", { class: "tfbtn", text: "▶ Launch", onclick: async () => {
        closeEditor();
        await ensureStarted();
        audio.launchScene(sceneIndex);
        setPlaying(sceneIndex);
        updatePlayBtn(true);
      }}),
      el("div", { class: "tfbtn", text: "Duplicate", onclick: () => {
        pushUndo();
        const cloned = cloneScene(scene);
        insertSceneAt(sceneIndex + 1, cloned);
        closeEditor();
        renderSession();
      }}),
      el("div", { class: "tfbtn", text: "Move Up", onclick: () => {
        if (sceneIndex === 0) return;
        pushUndo();
        swapScenes(sceneIndex, sceneIndex - 1);
        closeEditor();
        renderSession();
      }}),
      el("div", { class: "tfbtn", text: "Move Down", onclick: () => {
        if (sceneIndex >= song.scenes.length - 1) return;
        pushUndo();
        swapScenes(sceneIndex, sceneIndex + 1);
        closeEditor();
        renderSession();
      }}),
      el("div", { class: "tfbtn", style: "color:#d24b4b", text: "Delete", onclick: () => {
        if (song.scenes.length <= 1) { closeEditor(); return; }
        pushUndo();
        deleteSceneAt(sceneIndex);
        closeEditor();
        renderSession();
        if (view === "arrangement") renderArrangement();
      }}),
    ])
  );
  openSheet();
}

function renderSession() {
  sessionEl.innerHTML = "";
  sceneEls.length = 0;
  invalidateGridState();
  const grid = el("div", { class: "grid" });
  grid.style.gridTemplateColumns = `58px repeat(${TRACKS.length}, 1fr)`;
  grid.appendChild(el("div", { class: "head corner" }, [viewMixButton()]));
  for (const t of TRACKS) {
    const head = el("div", {
      class: "head track-head",
      style: `--tc:${t.color}`,
      "data-track": t.key,
      "data-sheet": `sound:${t.key}`,
    }, [
      el("div", { class: "head-name", text: t.name }),
      el("div", { class: "head-ms" }, [trackToggleButton(t.key, "mute"), trackToggleButton(t.key, "solo")]),
      el("div", { class: "more", text: "⋯" }),
    ]);
    bindTrackHeader(head, t.key);
    grid.appendChild(head);
  }
  song.scenes.forEach((scene, i) => {
    const refs = { clips: {}, pies: {} };
    const launch = el("div", {
      class: "scenecell",
      "data-scene": String(i),
    }, [el("div", { class: "tri", text: "▶" }), el("div", { text: scene.tag }), el("div", { class: "more", text: "⋯" })]);
    bindSceneCell(launch, i);
    refs.row = launch;
    grid.appendChild(launch);

    for (const t of TRACKS) {
      const content = clipContent(scene, t.key);
      const filled = content !== null;
      const clip = el("div", {
        class: `clip ${filled ? "filled" : "empty"}`,
        style: `--tc:${t.color}`,
        "data-scene": String(i),
        "data-track": t.key,
      });
      if (filled) {
        clip.appendChild(el("div", { class: "tri", text: "▶" }));
        clip.appendChild(content);
        const badge = launchBadge(scene, t.key);
        if (badge) clip.appendChild(badge);
        const state = stateBadge(scene, t.key);
        if (state) clip.appendChild(state);
        refs.pies[t.key] = clip.appendChild(el("div", { class: "pie" }));
      } else {
        clip.textContent = "+";
        refs.pies[t.key] = null;
      }
      bindSessionClip(clip, i, t.key, filled);
      refs.clips[t.key] = clip;
      grid.appendChild(clip);
    }
    sceneEls.push(refs);
  });

  // "+" add-scene cell at the very bottom of the scene column
  const addSceneCell = el("div", {
    class: "scenecell scene-add-cell",
    title: "Add scene",
    onclick: openAddSceneSheet,
  }, [el("div", { class: "tri", style: "color:#e8b84b;font-size:22px", text: "+" })]);
  grid.appendChild(addSceneCell);
  // The rest of the row is a ghost scene — same tap as +, reads as "more
  // stacks here" instead of "this is everything".
  grid.appendChild(
    el("div", { class: "clip ghost", style: "grid-column: 2 / -1", title: "Add scene", onclick: openAddSceneSheet, text: "+ scene" })
  );

  sessionEl.appendChild(grid);
  applyPlaying();
  updateTrackMixUI();
}

// The step event arrives every 16th; repainting the whole grid that often
// costs main-thread time right when beat visuals need to land. Both sweeps
// below skip when their state hasn't changed since the last paint.
let lastActiveKey = null;
let lastQueuedKey = null;
function invalidateGridState() {
  lastActiveKey = null;
  lastQueuedKey = null;
}
function setPlaying(i) {
  playingScene = i;
  for (const t of TRACKS) playingTracks[t.key] = i;
  invalidateGridState();
  applyPlaying();
}
function setActiveTracks(activeScenes) {
  const key = TRACKS.map((t) => activeScenes[t.key] ?? -1).join(",");
  if (key === lastActiveKey) return;
  lastActiveKey = key;
  for (const t of TRACKS) playingTracks[t.key] = activeScenes[t.key] ?? -1;
  const first = playingTracks[TRACKS[0].key];
  playingScene = first >= 0 && TRACKS.every((t) => playingTracks[t.key] === first) ? first : -1;
  applyPlaying();
}
// Playback visuals, pinned to the audio clock. Each frame, read the position
// being HEARD right now (audio.heardNow) and derive every playing clip's pie —
// prog = (now - cycleStart) / cycleDur — and the arrangement playhead's bar
// from their anchors. No CSS transition interpolating on a second clock, no
// dependence on a discrete event landing on this frame — both are pure
// functions of playback, re-derived every frame, so they can't drift. Residual
// limits: one display frame of granularity, and the platform's output-latency
// estimate (see audio.heardNow).
let pieAnchors = {}; // track -> { start, dur } in AudioContext seconds
let arrAnchor = null; // { start, barSec, len, loop } for the arrangement playhead
let clockPumpRAF = 0;
let pieFrame = false;
function clockPump() {
  clockPumpRAF = 0;
  const now = audio.heardNow();
  // Pies paint every OTHER frame: a radial fill at 30 Hz is indistinguishable
  // and short loops otherwise land a conic-gradient repaint per clip per
  // frame (quantization can't help a 2 s loop that moves >0.5% per frame).
  pieFrame = !pieFrame;
  if (pieFrame) for (const t of TRACKS) {
    const a = pieAnchors[t.key];
    const sceneIdx = playingTracks[t.key];
    if (!a || sceneIdx < 0) continue;
    // Write on the pie LEAF, never the clip: an inherited custom property set
    // on the clip invalidated its whole subtree per write (see the .pie CSS).
    const pieEl = sceneEls[sceneIdx]?.pies[t.key];
    if (!pieEl) continue;
    const prog = a.dur > 0 ? Math.min(1, Math.max(0, (now - a.start) / a.dur)) : 0;
    // Quantize to half-percent steps and skip unchanged writes: a pie on a
    // long loop moves well under 0.5%/frame, and every skipped write is a
    // conic-gradient repaint the A16 doesn't pay for. Still the audio clock —
    // each write that does land is exact.
    const pct = Math.round(prog * 200) / 2;
    if (pieEl.__pct !== pct) {
      pieEl.__pct = pct;
      pieEl.style.setProperty("--pct", String(pct));
    }
  }
  if (arrAnchor && arrPlayhead) {
    let barF = (now - arrAnchor.start) / arrAnchor.barSec;
    const lp = arrAnchor.loop;
    if (lp && barF >= lp.end) barF = lp.start + ((barF - lp.start) % (lp.end - lp.start));
    // The clamp bounds runaway extrapolation, not the loop: a loop dragged
    // past the last clip ends in empty grid the transport still traverses,
    // so the ceiling is whichever is further — content or loop end.
    barF = Math.max(0, Math.min(barF, lp ? Math.max(arrAnchor.len, lp.end) : arrAnchor.len));
    const x = Math.round(barF * ppb * 4) / 4; // quarter-pixel steps, skip no-op writes
    if (arrPlayhead.__x !== x) {
      arrPlayhead.__x = x;
      arrPlayhead.style.transform = `translateX(${x}px)`;
    }
  }
  if (audio.playing) clockPumpRAF = requestAnimationFrame(clockPump);
}

function applyPlaying() {
  sceneEls.forEach((r, i) => {
    const rowOn = i === playingScene;
    r.row.classList.toggle("playing", rowOn);
    // Row is "queued" if ALL tracks are queued to this scene
    const rowQueued = !rowOn && TRACKS.every((t) => queuedSceneTracks[t.key] === i);
    r.row.classList.toggle("queued", rowQueued);
    for (const t of TRACKS) {
      const c = r.clips[t.key];
      if (c && c.classList.contains("filled")) {
        c.classList.toggle("playing", playingTracks[t.key] === i);
        c.classList.toggle("queued", queuedSceneTracks[t.key] === i && playingTracks[t.key] !== i);
      }
    }
  });
}

let lastQueueEpoch = -1;
function applyQueued(qt, epoch = Infinity) {
  // Snapshots still in flight behind the visual lookahead arrive AFTER a
  // fresher immediate event; the epoch keeps old data from flickering it off.
  if (epoch < lastQueueEpoch) return;
  lastQueueEpoch = epoch === Infinity ? lastQueueEpoch : epoch;
  const key = TRACKS.map((t) => qt?.[t.key] ?? -1).join(",");
  if (key === lastQueuedKey) return;
  lastQueuedKey = key;
  for (const t of TRACKS) queuedSceneTracks[t.key] = qt?.[t.key] ?? -1;
  applyPlaying();
}

// ---------------------------------------------------------------------------
// Editor sheet
// ---------------------------------------------------------------------------
const sheet = document.getElementById("sheet");
const scrim = document.getElementById("scrim");
let editor = null; // { scene, track, stepEls, cursor }
let suppressOutsideClick = false;
// Which view the open sheet IS (mixer / sound:<track> / master / about),
// set by the openers, so a button targeting the already-open view can be a
// true no-op. Without it the outside-tap close below fired on the button's
// pointerdown and its click reopened the same sheet — a full close+reopen
// animation for a tap that should change nothing.
let sheetId = null;

scrim.addEventListener("click", closeEditor);
document.addEventListener("pointerdown", (e) => {
  if (!sheet.classList.contains("open")) return;
  if (sheet.contains(e.target)) return;
  if (e.target.closest(".tbtn.play")) return;

  // The button for the view that is already open is a no-op, not a
  // close-then-reopen. The scrim sits over every view button (only the
  // transport rides above it), so the tap's target is the scrim itself —
  // hit-test under the point for the button the finger was aiming at, and
  // when it names the open sheet, swallow the tap: no close, and the
  // click-suppressor below eats the scrim's own close-click.
  const opener = e.target === scrim
    ? document.elementsFromPoint(e.clientX, e.clientY).find((n) => n.dataset?.sheet)
    : e.target.closest("[data-sheet]");
  if (opener && !e.target.closest("[data-track-toggle]") && sheetId && opener.dataset.sheet === sheetId) {
    suppressOutsideClick = true;
    return;
  }

  closeEditor();
  if (e.target.closest("#transport")) {
    suppressOutsideClick = true;
    e.preventDefault();
    e.stopPropagation();
  }
}, true);
document.addEventListener("click", (e) => {
  if (!suppressOutsideClick) return;
  suppressOutsideClick = false;
  e.preventDefault();
  e.stopPropagation();
}, true);

function openEditor(sceneIndex, track) {
  const scene = song.scenes[sceneIndex];
  resetSheet(trackColor(track));
  editor = { scene: sceneIndex, track, moveCursor: null };

  const title = track === "drums" ? "Drum Rack" : track === "harmony" ? "Chords" : "Piano Roll";
  sheet.appendChild(
    sheetBar(title, `${TRACKS.find((t) => t.key === track).name} · Scene ${scene.tag}`, {
      buttons: [el("div", { class: "close", style: "margin-right:6px", text: "Options", onclick: () => openClipProps(sceneIndex, track) })],
    })
  );

  if (track === "drums") buildDrumEditor(scene);
  else if (track === "harmony") buildHarmonyEditor(sceneIndex, scene);
  else buildPianoEditor(sceneIndex, scene, track);

  openSheet();
}

function closeEditor() {
  if (sheetId === "circle") circleView.closed();
  editorCircle?.closed();
  editorCircle = null;
  editor = null;
  sheetId = null;
  cancelAnimationFrame(mixerRAF);
  mixerRAF = 0;
  audio.setMetersActive(false); // park the analyser taps with the meter loop
  audio.disarmMotion();
  scrim.classList.remove("open");
  sheet.classList.remove("open");
}

// Every sheet goes through the same three moves: reset the sheet (also stops a
// running mixer meter loop), append a title bar, open. Keep them here so no
// opener can forget one.
function resetSheet(color) {
  if (sheetId === "circle") circleView.closed();
  editorCircle?.closed();
  editorCircle = null;
  editor = null;
  sheetId = null;
  cancelAnimationFrame(mixerRAF);
  mixerRAF = 0;
  audio.setMetersActive(false); // park the analyser taps with the meter loop
  sheet.innerHTML = "";
  sheet.classList.remove("snd"); // sound-sheet sizing mode, set by openSoundSheet
  sheet.style.setProperty("--tc", color);
}

function sheetBar(title, sub, { buttons = [], onDone = closeEditor } = {}) {
  return el("div", { class: "sheet-bar" }, [
    el("div", { class: "swatch" }),
    el("div", { class: "title", text: title }),
    el("div", { class: "sub", text: sub }),
    ...buttons,
    el("div", { class: "close", text: "Done", onclick: onDone }),
  ]);
}

function openSheet() {
  scrim.classList.add("open");
  sheet.classList.add("open");
}

function choice(label, on, onclick, attrs = {}) {
  return el("div", { class: "choice" + (on ? " on" : ""), text: label, onclick, ...attrs });
}

function openClipProps(sceneIndex, track) {
  const scene = song.scenes[sceneIndex];
  const launch = clipLaunch(scene, track);
  const meta = TRACKS.find((t) => t.key === track);
  resetSheet(meta.color);

  const setLaunch = (patch) => {
    const changed = Object.entries(patch).some(([k, v]) => launch[k] !== v);
    if (!changed) return;
    pushUndo();
    Object.assign(launch, patch);
    refreshClip(sceneIndex, track);
    openClipProps(sceneIndex, track);
  };

  sheet.appendChild(sheetBar("Clip Properties", `${meta.name} · Scene ${scene.tag}`));

  sheet.appendChild(
    el("div", { class: "propsection" }, [
      el("div", { class: "proplabel", text: "launch mode" }),
      el("div", { class: "choicegrid two" }, [
        choice("Loop", launch.mode === "loop", () => setLaunch({ mode: "loop" }), { "data-action": "mode-loop" }),
        choice("One-shot", launch.mode === "oneshot", () => setLaunch({ mode: "oneshot" }), { "data-action": "mode-oneshot" }),
      ]),
    ])
  );

  const followLabels = { none: "None", next: "Next", prev: "Prev", random: "Random" };
  sheet.appendChild(
    el("div", { class: "propsection" }, [
      el("div", { class: "proplabel", text: "follow action" }),
      el("div", { class: "choicegrid four" },
        FOLLOW_ACTIONS.map((action) =>
          choice(followLabels[action], launch.follow === action, () => setLaunch({ follow: action }), {
            "data-action": `follow-${action}`,
          })
        )
      ),
    ])
  );

  const bars = el("div", { class: "numval", text: `${launch.followBars} bar${launch.followBars === 1 ? "" : "s"}` });
  const afterSection = el("div", { class: "propsection" + (launch.follow === "none" ? " disabled" : ""), style: launch.follow === "none" ? "opacity: 0.3; pointer-events: none;" : "" }, [
    el("div", { class: "proplabel", text: "after" }),
    el("div", { class: "numrow" }, [
      el("div", {
        class: "choice stepper",
        text: "-",
        onclick: () => setLaunch({ followBars: Math.max(1, launch.followBars - 1) }),
      }),
      bars,
      el("div", {
        class: "choice stepper",
        text: "+",
        onclick: () => setLaunch({ followBars: Math.min(16, launch.followBars + 1) }),
      }),
    ]),
  ]);
  sheet.appendChild(afterSection);

  sheet.appendChild(
    el("div", { class: "tfrow" }, [
      el("div", {
        class: "tfbtn",
        text: "Launch",
        onclick: async () => {
          await ensureStarted();
          const wasPlaying = audio.playing;
          audio.launchClip(sceneIndex, track);
          // Same rule as a scene launch: playing means QUEUED — the engine's
          // queue event paints it, and the boundary flips it to playing.
          if (!wasPlaying) {
            for (const t of TRACKS) playingTracks[t.key] = -1;
            playingTracks[track] = sceneIndex;
            applyPlaying();
          }
          updatePlayBtn(true);
        },
      }),
      el("div", { class: "tfbtn", text: "Edit", onclick: () => openEditor(sceneIndex, track) }),
      el("div", {
        class: "tfbtn",
        text: "Duplicate Scene",
        "data-action": "duplicate-scene",
        onclick: () => {
          pushUndo();
          const next = insertSceneAt(song.scenes.length, cloneScene(scene));
          renderSession();
          openClipProps(next, track);
        },
      }),
      el("div", {
        class: "tfbtn",
        style: "color:#d24b4b",
        text: "Delete Clip",
        onclick: () => {
          pushUndo();
          if (track === "drums") {
            for (const v of DRUM_VOICES) for (let s = 0; s < 16; s++) scene.drums[v][s] = false;
          } else if (track === "melody" || track === "bass") {
            for (let s = 0; s < 16; s++) scene[track][s] = null;
          } else if (track === "harmony") {
            scene.harmony = [];
          }
          closeEditor();
          renderSession();
        },
      }),
    ])
  );

  openSheet();
}

// ---------------------------------------------------------------------------
// Mixer + devices
// ---------------------------------------------------------------------------
let mixerRAF = 0;
// Dry by default: every send parks at the knob floor (-30 is off). The dry mix
// is the meaty one — the master chain does the gluing, and reverb/echo are
// there to be dialed in per track, not baked into the cold open. Reset Sends
// returns here, i.e. to silence.
const MIX_DEFAULTS = {
  harmony: { vol: DEFAULT_TRACK_VOLUME_DB, pan: 0, verb: -30, echo: -30, mute: false, solo: false },
  drums: { vol: DEFAULT_TRACK_VOLUME_DB, pan: 0, verb: -30, echo: -30, mute: false, solo: false },
  bass: { vol: DEFAULT_TRACK_VOLUME_DB, pan: 0, verb: -30, echo: -30, mute: false, solo: false },
  melody: { vol: DEFAULT_TRACK_VOLUME_DB, pan: 0, verb: -30, echo: -30, mute: false, solo: false },
};
const mixState = structuredClone(MIX_DEFAULTS);

function knob(label, min, max, step, val, onChange, format = (v) => v) {
  const container = el("div", { class: "knob-container" });
  const lbl = el("div", { class: "knob-label", text: label });
  const dial = el("div", { class: "knob-dial" });
  const indicator = el("div", { class: "knob-indicator" });
  const valEl = el("div", { class: "knob-val", text: format(val) });
  // The value lives inside the dial; the freed row below lets the dial grow.
  dial.append(indicator, valEl);
  container.append(lbl, dial);

  let currentVal = val;
  const updateVisuals = () => {
    const pct = (currentVal - min) / (max - min);
    const deg = -135 + pct * 270;
    indicator.style.transform = `rotate(${deg}deg)`;
    valEl.textContent = format(currentVal);
  };
  updateVisuals();

  let startY = 0;
  let startVal = 0;
  
  dial.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    startY = e.clientY;
    startVal = currentVal;
    
    const move = (ev) => {
      const deltaY = startY - ev.clientY;
      const range = max - min;
      let newVal = startVal + (deltaY / 120) * range;
      newVal = Math.max(min, Math.min(max, newVal));
      newVal = Math.round(newVal / step) * step;
      if (Math.abs(newVal - currentVal) > 1e-5) {
        currentVal = newVal;
        updateVisuals();
        onChange(currentVal);
      }
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
  });
  
  return container;
}

function applyTrackMix(track) {
  const ms = mixState[track];
  if (!ms) return;
  ms.vol = clampTrackDb(ms.vol);
  audio.setVol(track, ms.vol);
  audio.setPan(track, ms.pan);
  audio.setSend(track, ms.verb);
  audio.setEcho(track, ms.echo);
  audio.setMute(track, ms.mute);
  audio.setSolo(track, ms.solo);
}

function applyMixState() {
  for (const t of TRACKS) applyTrackMix(t.key);
  updateTrackMixUI();
}

// The dice owns the sends (DECISIONS D9): a wet roll sets them, a dry roll
// clears them back to default — otherwise wetness would accumulate across
// rolls. Faders, pan, and mutes stay the player's. vibe.wet is keyed by
// track and send, so the routing discipline (what gets wet at all) has one
// home in rollVibe and this stays a plain merge. Engine-push only: both
// callers repaint the full UI right after, so no updateTrackMixUI here.
function applyVibeMix(vibe) {
  for (const t of TRACKS) {
    for (const send of ["verb", "echo"]) {
      mixState[t.key][send] = vibe?.wet?.[t.key]?.[send] ?? MIX_DEFAULTS[t.key][send];
    }
    applyTrackMix(t.key);
  }
}

function resetTrackMix(track, { sendsOnly = false } = {}) {
  const next = structuredClone(MIX_DEFAULTS[track]);
  if (!next) return;
  if (sendsOnly) {
    mixState[track].verb = next.verb;
    mixState[track].echo = next.echo;
  } else {
    Object.assign(mixState[track], next);
  }
  applyTrackMix(track);
  updateTrackMixUI();
}

function resetAllMix({ sendsOnly = false } = {}) {
  for (const t of TRACKS) resetTrackMix(t.key, { sendsOnly });
}

function trackMutedByState(track) {
  const anySolo = Object.values(mixState).some((s) => s.solo);
  return mixState[track]?.mute || (anySolo && !mixState[track]?.solo);
}
function updateTrackMixUI() {
  document.querySelectorAll("[data-track-toggle]").forEach((btn) => {
    const state = mixState[btn.dataset.track];
    const kind = btn.dataset.trackToggle;
    const on = !!state?.[kind];
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", String(on));
  });
  document.querySelectorAll(".track-head[data-track], .arr-thead[data-track], .mx-strip[data-track]").forEach((node) => {
    const track = node.dataset.track;
    node.classList.toggle("muted", trackMutedByState(track));
    node.classList.toggle("soloed", !!mixState[track]?.solo);
  });
  document.querySelectorAll(".clip[data-track], .arr-lane[data-track]").forEach((node) => {
    node.classList.toggle("track-muted", trackMutedByState(node.dataset.track));
  });
}
function setTrackMute(track, on) {
  if (!mixState[track] || mixState[track].mute === on) return;
  mixState[track].mute = on;
  audio.setMute(track, on);
  updateTrackMixUI();
}
function setTrackSolo(track, on) {
  if (!mixState[track] || mixState[track].solo === on) return;
  mixState[track].solo = on;
  audio.setSolo(track, on);
  updateTrackMixUI();
}
function toggleTrackMute(track) {
  setTrackMute(track, !mixState[track]?.mute);
}
function toggleTrackSolo(track) {
  setTrackSolo(track, !mixState[track]?.solo);
}
function trackToggleButton(track, kind) {
  const isMute = kind === "mute";
  return el("div", {
    class: `msbtn ${mixState[track]?.[kind] ? "on" : ""}`,
    text: isMute ? "M" : "S",
    role: "button",
    "aria-pressed": String(!!mixState[track]?.[kind]),
    "data-track": track,
    "data-track-toggle": kind,
    onpointerdown: (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isMute) toggleTrackMute(track);
      else toggleTrackSolo(track);
    },
  });
}
function viewMixButton() {
  // Corner Mix buttons in session/arrangement headers — kept for legacy layout compat
  return el("div", {
    class: "view-mix",
    text: "Mix",
    "data-sheet": "mixer",
    onclick: (e) => {
      e.stopPropagation();
      openMixer();
    },
  });
}
// One element, both jobs: the meter is the fader. The body fills with RMS
// (perceived level), an instantaneous peak bar rides above it, a hold tick
// with a numeric readout marks the recent maximum, and on tracks a handle
// riding the same column sets the volume — Ableton's channel strip, sized
// for a thumb.
function makeVolMeter(state, { withHandle = false } = {}) {
  state.rmsEl = el("div", { class: "mv-rms" });
  state.peakEl = el("div", { class: "mv-peak" });
  state.holdEl = el("div", { class: "mv-hold" });
  state.labelEl = el("div", { class: "mv-label" });
  state.rmsDb = -Infinity;
  state.peakDb = -Infinity;
  state.holdDb = -Infinity;
  state.holdUntil = 0;
  const kids = [state.rmsEl, state.peakEl, state.holdEl, state.labelEl];
  if (withHandle) {
    state.handleEl = el("div", { class: "mv-handle" });
    kids.push(state.handleEl);
  }
  return el("div", { class: "mx-vol" + (withHandle ? " grab" : "") }, kids);
}

// Ableton-ish ballistics: RMS attacks fast and releases slow, peak falls at a
// fixed rate, the hold tick keeps the recent maximum for a beat then lets go.
function advanceMeter(state, levels, now) {
  state.rmsDb = Number.isFinite(state.rmsDb)
    ? state.rmsDb + (levels.rms - state.rmsDb) * (levels.rms > state.rmsDb ? 0.5 : 0.12)
    : levels.rms;
  state.peakDb = levels.peak > state.peakDb ? levels.peak : state.peakDb - 1.1;
  if (levels.peak >= state.holdDb) {
    state.holdDb = levels.peak;
    state.holdUntil = now + 1200;
  } else if (now > state.holdUntil) {
    state.holdDb -= 0.6;
  }
  // Dirty-check every write: idle meters used to issue ~30 unconditional
  // style/text writes per frame across the five strips.
  const write = (key, node, prop, value) => {
    if (state[key] === value) return;
    state[key] = value;
    if (prop === "text") node.textContent = value;
    else node.style[prop] = value;
  };
  write("_rms", state.rmsEl, "transform", `scaleY(${meterLevel(state.rmsDb).toFixed(3)})`);
  const showPeak = Number.isFinite(state.peakDb) && state.peakDb > METER_MIN_DB;
  write("_peakShow", state.peakEl, "display", showPeak ? "block" : "none");
  if (showPeak) write("_peakTop", state.peakEl, "top", `${((1 - meterLevel(state.peakDb)) * 100).toFixed(1)}%`);
  const showHold = Number.isFinite(state.holdDb) && state.holdDb > METER_MIN_DB;
  write("_holdShow", state.holdEl, "display", showHold ? "block" : "none");
  write("_label", state.labelEl, "text", showHold ? String(Math.round(state.holdDb)) : "");
  if (showHold) write("_holdTop", state.holdEl, "top", `${((1 - meterLevel(state.holdDb)) * 100).toFixed(1)}%`);
}

const volToPct = (db) => (1 - (db - TRACK_VOLUME_MIN_DB) / (TRACK_VOLUME_MAX_DB - TRACK_VOLUME_MIN_DB)) * 100;
function bindTrackHeader(node, track) {
  let timer = 0;
  let longPressed = false;
  let startX = 0;
  let startY = 0;
  const clear = () => {
    clearTimeout(timer);
    timer = 0;
    node.classList.remove("pressing");
  };
  node.addEventListener("pointerdown", (e) => {
    if (e.target.closest("[data-track-toggle]")) return;
    longPressed = false;
    startX = e.clientX;
    startY = e.clientY;
    node.classList.add("pressing");
    timer = window.setTimeout(() => {
      longPressed = true;
      clear();
      openTrackOptions(track);
    }, 520);
  });
  node.addEventListener("pointermove", (e) => {
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > 12) clear();
  });
  node.addEventListener("pointerup", clear);
  node.addEventListener("pointercancel", clear);
  // Tap = this track's Sound page (the play surface), long-press = Track
  // Options. The M/S buttons keep their own gesture (guarded here because
  // their pointerdown stopPropagation doesn't reach the separately-
  // dispatched click).
  node.addEventListener("click", (e) => {
    if (longPressed) {
      longPressed = false;
      return;
    }
    if (e.target.closest("[data-track-toggle]")) return;
    openSoundSheet(track);
  });
}
function openTrackOptions(track) {
  const meta = TRACKS.find((t) => t.key === track);
  if (!meta) return;
  resetSheet(meta.color);
  const trackChoice = (kind, label) =>
    el("div", {
      class: `choice track-choice ${mixState[track][kind] ? "on" : ""}`,
      text: label,
      "data-track": track,
      "data-track-toggle": kind,
      onpointerdown: (e) => {
        e.preventDefault();
        if (kind === "mute") toggleTrackMute(track);
        else toggleTrackSolo(track);
      },
    });
  sheet.appendChild(sheetBar("Track Options", meta.name));
  sheet.appendChild(
    el("div", { class: "propsection" }, [
      el("div", { class: "proplabel", text: "state" }),
      el("div", { class: "choicegrid two" }, [trackChoice("mute", "Mute"), trackChoice("solo", "Solo")]),
    ])
  );
  sheet.appendChild(
    el("div", { class: "tfrow" }, [
      el("div", { class: "tfbtn accent", text: "✦ Sound", onclick: () => openSoundSheet(track) }),
      el("div", { class: "tfbtn", text: "Mixer Strip", onclick: () => openMixer(track) }),
      el("div", { class: "tfbtn", text: "Reset Mix", onclick: () => { resetTrackMix(track); openTrackOptions(track); } }),
      el("div", { class: "tfbtn", text: "Reset Sends", onclick: () => { resetTrackMix(track, { sendsOnly: true }); openTrackOptions(track); } }),
    ])
  );
  openSheet();
  updateTrackMixUI();
}

function openMixer(focusTrack = null) {
  resetSheet("#8a8a90");
  sheetId = "mixer";
  sheet.appendChild(
    sheetBar("Mixer", "levels · sends · devices", {
      buttons: [el("div", { class: "close", style: "font-size:11px;padding:5px 7px", text: "Reset", onclick: () => { resetAllMix(); openMixer(focusTrack); } })],
    })
  );

  const container = el("div", { class: "mx-container" });
  const meterBars = {};
  for (const t of TRACKS) {
    const k = t.key;
    const ms = mixState[k];
    ms.vol = clampTrackDb(ms.vol);
    const mState = {};
    meterBars[k] = mState;
    const volMeter = makeVolMeter(mState, { withHandle: true });
    const volLabel = el("div", { class: "mx-val", text: formatDb(ms.vol) });
    mState.handleEl.style.top = `${volToPct(ms.vol)}%`;
    // Relative drag anywhere on the column — no jump if you grab off-handle.
    volMeter.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const startY = e.clientY;
      const startVol = ms.vol;
      const range = TRACK_VOLUME_MAX_DB - TRACK_VOLUME_MIN_DB;
      const height = volMeter.getBoundingClientRect().height || 1;
      capturePointer(volMeter, e.pointerId);
      const move = (ev) => {
        const next = clampTrackDb(startVol + (-(ev.clientY - startY) / height) * range);
        if (next === ms.vol) return;
        ms.vol = next;
        audio.setVol(k, next);
        mState.handleEl.style.top = `${volToPct(next)}%`;
        volLabel.textContent = formatDb(next);
      };
      const up = () => {
        volMeter.removeEventListener("pointermove", move);
        volMeter.removeEventListener("pointerup", up);
        volMeter.removeEventListener("pointercancel", up);
      };
      volMeter.addEventListener("pointermove", move);
      volMeter.addEventListener("pointerup", up);
      volMeter.addEventListener("pointercancel", up);
    });

    const panSlider = knob("pan", -1, 1, 0.05, ms.pan, (v) => { ms.pan = v; audio.setPan(k, v); }, (v) => (v === 0 ? "C" : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`));
    const verbSlider = knob("verb", -30, 0, 1, ms.verb, (v) => { ms.verb = v; audio.setSend(k, v); });
    const echoSlider = knob("echo", -30, 0, 1, ms.echo, (v) => { ms.echo = v; audio.setEcho(k, v); });

    // One path to the device: the sound sheet. The old preset dropdowns were
    // a third, flattened way to pick corners the pad already owns, and the
    // corner-name label above this button was a fourth — dropped too; the
    // sound page itself shows where the patch sits.
    const devSection = el("div", { class: "mx-dev-section" }, [
      el("div", { class: "mx-sound", text: "✦ sound", "data-action": `sound-${k}`, onclick: () => openSoundSheet(k) }),
    ]);

    const strip = el("div", { class: "mx-strip" + (focusTrack === k ? " focus" : ""), style: `--tc:${t.color}`, "data-track": k }, [
      el("div", { class: "mx-name" }, [el("span", { class: "mx-dot" }), el("span", { text: t.name })]),
      el("div", { class: "mx-ms" }, [trackToggleButton(k, "mute"), trackToggleButton(k, "solo")]),
      volMeter,
      volLabel,
      panSlider,
      verbSlider,
      echoSlider,
      devSection,
    ]);
    container.appendChild(strip);
  }
  const masterMeterState = {};
  meterBars.master = masterMeterState;
  // The master strip is a door, same interaction as a track's parameters:
  // tap the meter (or the name) and the mix bus editor opens.
  container.appendChild(
    el("div", {
      class: "mx-strip mx-master",
      style: "--tc:#d2d2d4",
      "data-track": "master",
      role: "button",
      "data-action": "master-open",
      onclick: openMasterSheet,
    }, [
      el("div", { class: "mx-name" }, [el("span", { text: "Master" })]),
      makeVolMeter(masterMeterState),
    ])
  );
  sheet.appendChild(container);

  openSheet();
  if (focusTrack) {
    setTimeout(() => sheet.querySelector(`.mx-strip[data-track="${focusTrack}"]`)?.scrollIntoView({ inline: "center", block: "nearest" }), 30);
  }
  updateTrackMixUI();
  audio.setMetersActive(true); // wake the analyser taps for the visible meters
  const tick = () => {
    const now = performance.now();
    for (const t of TRACKS) advanceMeter(meterBars[t.key], audio.meterLevels(t.key), now);
    advanceMeter(meterBars.master, audio.meterLevels("master"), now);
    mixerRAF = requestAnimationFrame(tick);
  };
  cancelAnimationFrame(mixerRAF);
  mixerRAF = requestAnimationFrame(tick);
}

// ---------------------------------------------------------------------------
// Master sheet — the mix bus, editable like a track device. Four knobs over
// the chain's own levers (audio.setMaster), defaults equal the compiled
// character, and exports render whatever is set here.
// ---------------------------------------------------------------------------
function openMasterSheet() {
  resetSheet("#d2d2d4");
  sheetId = "master";
  sheet.appendChild(sheetBar("Master", "the mix bus"));
  const body = el("div", { class: "editor-scroll" });
  sheet.appendChild(body);
  const m = audio.master();
  const dbFmt = (v) => `${v > 0 ? "+" : ""}${Math.round(v)}`;
  const pctFmt = (v) => `${Math.round(v * 100)}%`;
  const masterKnob = (name, min, max, step, val, fmt) => {
    const k = knob(name, min, max, step, val, (v) => audio.setMaster({ [name]: v }), fmt);
    k.dataset.action = `master-${name}`;
    return k;
  };
  body.appendChild(
    el("div", { class: "propsection" }, [
      el("div", { class: "proplabel", text: "level · juice · weight · glue" }),
      el("div", { class: "knobrow" }, [
        masterKnob("level", -12, 6, 1, m.level, dbFmt),
        masterKnob("juice", 0, 1, 0.01, m.juice, pctFmt),
        masterKnob("weight", 0, 1, 0.01, m.weight, pctFmt),
        masterKnob("glue", 0, 1, 0.01, m.glue, pctFmt),
      ]),
    ])
  );
  body.appendChild(
    el("div", { class: "tfrow" }, [
      el("div", {
        class: "tfbtn",
        text: "Reset",
        "data-action": "master-reset",
        onclick: () => {
          audio.setMaster({ ...MASTER_DEFAULTS });
          openMasterSheet();
        },
      }),
    ])
  );
  openSheet();
}

// ---------------------------------------------------------------------------
// Sound sheet — the morph pad between a track's four presets, plus one color.
// The dropdown names are the corners; the space between them is the point of
// this sheet. Everything auditions live while the loop plays.
// ---------------------------------------------------------------------------
function openSoundSheet(track) {
  const meta = TRACKS.find((t) => t.key === track);
  resetSheet(meta.color);
  sheetId = `sound:${track}`;
  // Motion capture: arm ●, play, and perform on the pad — the ride is written
  // into the playing scene's lanes, quantized to 16ths, and loops from then on.
  const recBtn = el("div", {
    class: "close rec-motion" + (audio.motionArmed(track) ? " on" : ""),
    style: "margin-right:6px",
    text: "● ride",
    title: "Record motion: arm, play, ride the pad",
    "data-action": `motion-rec-${track}`,
    onclick: () => {
      audio.armMotion(track, !audio.motionArmed(track));
      openSoundSheet(track);
    },
  });
  const soundDice = el("div", {
    class: "close",
    style: "margin-right:6px",
    text: "🎲",
    "data-action": `sound-dice-${track}`,
    onclick: () => {
      audio.setPatch(track, track === "bass" ? rolledBassPatch() : rolledPatch(track));
      openSoundSheet(track);
    },
  });
  sheet.appendChild(sheetBar("Sound", meta.name, { buttons: [recBtn, soundDice] }));
  // The Sound page is the play surface: it takes the full height it can get
  // and every control stays on screen — the morph pad is the flexible element
  // and absorbs whatever the fixed rows leave over (overflow scroll remains
  // only as a small-viewport safety net).
  sheet.classList.add("snd");
  const body = el("div", { class: "editor-scroll sound-body" });
  sheet.appendChild(body);
  const patch = audio.patch(track);
  const isDrums = track === "drums";

  if (isDrums) {
    const bankChips = el("div", { class: "choicegrid two" });
    for (const bank of DRUM_BANKS) {
      bankChips.appendChild(
        choice(bank === "sample" ? "samples" : "synth", patch.bank === bank, () => {
          audio.setPatch(track, { bank });
          openSoundSheet(track);
        }, { "data-action": `bank-${bank}` })
      );
    }
    body.appendChild(el("div", { class: "propsection" }, [el("div", { class: "proplabel", text: "bank" }), bankChips]));
  }

  // The melody track's two sources (DECISIONS P4): the synth, or the chop
  // deck — load any sample and it lands sliced across the piano roll's rows.
  if (track === "melody") {
    const info = audio.chopInfo();
    const srcChips = el("div", { class: "choicegrid two" }, [
      choice("synth", patch.source !== "chops", () => {
        audio.setPatch(track, { source: "synth" });
        openSoundSheet(track);
      }, { "data-action": "melody-src-synth" }),
      choice("chops", patch.source === "chops", () => {
        audio.setPatch(track, { source: "chops" });
        openSoundSheet(track);
      }, { "data-action": "melody-src-chops" }),
    ]);
    const rows = [el("div", { class: "proplabel", text: "source" }), srcChips];
    if (patch.source === "chops") {
      const chopFile = el("input", { type: "file", accept: "audio/*,.wav,.mp3,.m4a,.ogg", style: "display:none" });
      const fileBtn = el("div", {
        class: "tfbtn" + (info ? "" : " accent"),
        text: info ? `${info.name} · ${info.count} slices` : "load a sample…",
        "data-action": "chop-load",
        onclick: () => chopFile.click(),
      });
      chopFile.addEventListener("change", async () => {
        const f = chopFile.files?.[0];
        if (!f) return;
        fileBtn.textContent = "slicing…";
        try {
          await ensureStarted();
          await audio.loadChopSample(await f.arrayBuffer(), f.name.replace(/\.[^.]+$/, ""), audio.chopInfo()?.mode || "auto");
          openSoundSheet(track);
        } catch {
          fileBtn.textContent = "couldn't read that file";
        }
      });
      rows.push(el("div", { class: "tfrow" }, [fileBtn, chopFile]));
      if (info) {
        rows.push(
          el("div", { class: "proplabel", text: "slice at" }),
          el("div", { class: "choicegrid two" }, [
            choice("hits", info.mode !== "grid", () => {
              audio.setChopMode("auto");
              openSoundSheet(track);
            }, { "data-action": "chop-auto" }),
            choice("grid", info.mode === "grid", () => {
              audio.setChopMode("grid");
              openSoundSheet(track);
            }, { "data-action": "chop-grid" }),
          ])
        );
      }
    }
    body.appendChild(el("div", { class: "propsection" }, rows));
  }

  {
    const padWrap = el("div", { class: "propsection pad-section" }, [el("div", { class: "proplabel", text: "morph" })]);
    const xy = el("div", { class: "xy-pad", style: `--tc:${meta.color}`, "data-action": `xy-${track}` });
    const names = isDrums ? drumCornerNames(patch) : CORNERS[track];
    const cornerPos = ["tl", "tr", "bl", "br"];
    names.forEach((n, i) => xy.appendChild(el("div", { class: `xy-corner ${cornerPos[i]}`, text: n })));
    const dot = el("div", { class: "xy-dot" });
    xy.appendChild(dot);
    const placeDot = (p) => {
      dot.style.left = `${p.x * 100}%`;
      dot.style.top = `${p.y * 100}%`;
    };
    placeDot(patch);
    xy.addEventListener("pointerdown", async (e) => {
      e.preventDefault();
      await ensureStarted();
      const rect = xy.getBoundingClientRect();
      const set = (ev) => {
        const x = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
        const y = Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height));
        placeDot(audio.setPatch(track, { x, y }));
      };
      set(e);
      capturePointer(xy, e.pointerId);
      const move = (ev) => set(ev);
      const up = () => {
        xy.removeEventListener("pointermove", move);
        xy.removeEventListener("pointerup", up);
        xy.removeEventListener("pointercancel", up);
      };
      xy.addEventListener("pointermove", move);
      xy.addEventListener("pointerup", up);
      xy.addEventListener("pointercancel", up);
    });
    padWrap.appendChild(xy);
    body.appendChild(padWrap);
  }

  const chips = el("div", { class: "choicegrid six" });
  const chipEls = {};
  for (const c of colorNamesFor(track)) {
    chipEls[c] = choice(c, patch.color === c, () => {
      const next = audio.setPatch(track, { color: c });
      for (const [name, elc] of Object.entries(chipEls)) elc.classList.toggle("on", name === next.color);
    }, { "data-action": `color-${c}` });
    chips.appendChild(chipEls[c]);
  }
  body.appendChild(el("div", { class: "propsection" }, [el("div", { class: "proplabel", text: "color" }), chips]));

  const pctFmt = (v) => `${Math.round(v * 100)}%`;
  const sendFmt = (v) => (v <= -29 ? "off" : `${Math.round(v)}`);
  const mix = mixState[track];
  const knobs = [
    knob("amount", 0, 1, 0.01, patch.amount, (v) => audio.setPatch(track, { amount: v }), pctFmt),
    knob("motion", 0, 1, 0.01, patch.motion, (v) => audio.setPatch(track, { motion: v }), pctFmt),
  ];
  if (track !== "harmony") {
    // Per-track pocket: overrides the global GROOV for this track only.
    knobs.push(
      knob("pocket", 0, 0.6, 0.01, song.trackSwing?.[track] ?? song.swing, (v) => {
        (song.trackSwing ||= {})[track] = v;
      }, pctFmt)
    );
  }
  // The ride surface owns the sends too: with the arm on this sheet, a verb
  // or echo sweep here records a lane exactly like amount/motion. Writes go
  // through the mixer's state so its strip reopens where you left it.
  knobs.push(
    knob("verb", -30, 0, 1, mix.verb, (v) => {
      mix.verb = v;
      audio.setSend(track, v);
    }, sendFmt),
    knob("echo", -30, 0, 1, mix.echo, (v) => {
      mix.echo = v;
      audio.setEcho(track, v);
    }, sendFmt)
  );
  body.appendChild(
    el("div", { class: "propsection" }, [
      el("div", { class: "proplabel", text: track === "harmony" ? "amount · motion · verb · echo" : "amount · motion · pocket · verb · echo" }),
      el("div", { class: "knobrow" + (knobs.length >= 5 ? " five" : "") }, knobs),
    ])
  );

  if (isDrums && patch.bank === "sample") {
    // 2×2, not four full rows: the drum Sound page is the tallest and this
    // is what keeps it under the fold with the pad still worth touching.
    const grid = el("div", { class: "oneshot-grid" });
    for (const v of DRUM_VOICES) {
      const pin = patch.pins?.[v];
      const label = pin === "user" ? (audio.userSampleName(v) || "your wav") : pin || "follows the kit";
      grid.appendChild(
        el("div", { class: "srow", "data-action": `pick-${v}`, onclick: () => openDrumSamplePicker(v) }, [
          el("div", { class: "srow-voice", style: `--pc:${padHex(v)}`, text: DRUM_META[v].label }),
          el("div", { class: "srow-pin" + (pin ? " pinned" : ""), text: label }),
        ])
      );
    }
    body.appendChild(el("div", { class: "propsection" }, [el("div", { class: "proplabel", text: "one-shots" }), grid]));
  }

  // A recorded ride lives in the playing scene; offer the way out.
  const sceneIdx = playingTracks[track] >= 0 ? playingTracks[track] : 0;
  const motionScene = song.scenes[sceneIdx];
  if (motionScene?.motion?.[track] && Object.keys(motionScene.motion[track]).length) {
    body.appendChild(
      el("div", { class: "tfrow" }, [
        el("div", {
          class: "tfbtn",
          text: `Clear motion (scene ${motionScene.tag})`,
          "data-action": `motion-clear-${track}`,
          onclick: () => {
            pushUndo();
            delete motionScene.motion[track];
            openSoundSheet(track);
          },
        }),
      ])
    );
  }
  openSheet();
  // The sheet often cuts cleanly at a section edge and LOOKS complete; hint
  // that it scrolls, and remove the hint at the first scroll.
  requestAnimationFrame(() => {
    if (body.scrollHeight > body.clientHeight + 8) {
      const hint = el("div", { class: "scroll-hint", text: "⌄" });
      sheet.appendChild(hint);
      body.addEventListener("scroll", () => hint.remove(), { once: true });
    }
  });
}

// Per-voice one-shot picker: the bundled library organized by kit character,
// plus your own WAV. Every choice auditions immediately.
function openDrumSamplePicker(voice) {
  const meta = TRACKS.find((t) => t.key === "drums");
  resetSheet(meta.color);
  sheet.appendChild(sheetBar("One-shot", DRUM_META[voice].label, { onDone: () => openSoundSheet("drums") }));
  const body = el("div", { class: "editor-scroll" });
  sheet.appendChild(body);
  const patch = audio.patch("drums");
  const current = patch.pins?.[voice] || null;

  const setPin = async (pin) => {
    const pins = { ...audio.patch("drums").pins };
    if (pin) pins[voice] = pin;
    else delete pins[voice];
    audio.setPatch("drums", { pins });
    await ensureStarted();
    audio.previewHit(voice);
    openDrumSamplePicker(voice);
  };

  const list = el("div", { class: "choicegrid two" });
  list.appendChild(choice("follows the kit", !current, () => setPin(null), { "data-action": "pin-kit" }));
  for (const kit of SAMPLE_KIT_NAMES) {
    const name = `${kit}-${voice}`;
    list.appendChild(choice(`${kit} ${DRUM_META[voice].label}`, current === name, () => setPin(name), { "data-action": `pin-${name}` }));
  }
  const fileInput = el("input", { class: "project-file", type: "file", accept: "audio/wav,audio/*" });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      await audio.loadUserSample(voice, await file.arrayBuffer(), file.name);
      setPin("user");
    } catch {
      openDrumSamplePicker(voice);
    }
  });
  const userLabel = current === "user" && audio.userSampleName(voice) ? audio.userSampleName(voice) : "load a wav…";
  list.appendChild(choice(userLabel, current === "user", () => fileInput.click(), { "data-action": "pin-user" }));
  if (navigator.mediaDevices?.getUserMedia) {
    list.appendChild(choice("🎙 record", false, () => openMicCapture(voice), { "data-action": "pin-mic" }));
  }
  body.appendChild(el("div", { class: "propsection" }, [el("div", { class: "proplabel", text: "pick one — it auditions as you tap" }), list, fileInput]));
  openSheet();
}

// Beatbox a drum: boom into the mic, it becomes the kick. Playback pauses so
// the take doesn't catch the speakers; the conditioned one-shot pins itself
// and auditions the moment you stop.
function openMicCapture(voice) {
  const meta = TRACKS.find((t) => t.key === "drums");
  resetSheet(meta.color);
  sheet.appendChild(sheetBar("Record", DRUM_META[voice].label, { onDone: () => openDrumSamplePicker(voice) }));
  const status = el("div", { class: "exp-status", text: "mouth ready?" });
  const big = el("div", { class: "mic-big", "data-action": "mic-go", text: "🎙 tap, then make the sound" });
  sheet.appendChild(el("div", { class: "propsection" }, [big, status]));

  let capture = null;
  const keep = async () => {
    big.classList.remove("live");
    big.textContent = "…";
    const cap = capture;
    capture = null;
    try {
      await cap.stop();
      const pins = { ...audio.patch("drums").pins, [voice]: "user" };
      audio.setPatch("drums", { pins });
      await ensureStarted();
      audio.previewHit(voice);
      openDrumSamplePicker(voice);
    } catch (e) {
      status.textContent = e?.message === "too quiet" ? "too quiet — get closer, go again" : "take failed — go again";
      big.textContent = "🎙 tap, then make the sound";
    }
  };
  big.addEventListener("click", async () => {
    if (capture) {
      keep();
      return;
    }
    try {
      if (audio.playing) {
        audio.stop();
        updatePlayBtn(false);
        status.textContent = "paused the beat so the mic hears only you";
      }
      capture = await audio.beginMicCapture(voice);
      big.classList.add("live");
      big.textContent = "● recording — tap to keep";
      status.textContent = "boom / psst / tss — it trims itself";
      capture.done.then(() => {
        if (capture) keep();
      }).catch(() => {});
    } catch {
      status.textContent = "mic blocked — allow microphone access and retry";
    }
  });
  openSheet();
}

// Piano-roll zoom: 17px cells are the smallest target in the app, so the
// roll pages between all 16 steps and fat 8-step halves. Sticky across opens.
let pianoView = 0; // 0 = 16 steps, 1 = steps 1-8, 2 = steps 9-16
let gridBar = 0; // which bar of a multi-bar lane the editors show
// Bar pager for multi-bar lanes: the same chip idiom the motion-lane picker
// uses. Null when the lane is one bar - no chrome for the common case.
function barPager(sceneIndex, track, clipLen) {
  const bars = Math.ceil(clipLen / 16);
  if (bars <= 1) return null;
  return el(
    "div",
    { class: "lane-ctl grid-bars" },
    [
      el("div", { class: "swlabel", text: "bar" }),
      ...Array.from({ length: bars }, (_, b) =>
        el("div", {
          class: "lane-bar" + (b === gridBar ? " on" : ""),
          text: String(b + 1),
          "data-action": `grid-bar-${b}`,
          onclick: () => {
            gridBar = b;
            openEditor(sceneIndex, track);
          },
        })
      ),
    ]
  );
}
const PIANO_VIEWS = ["⊞ 16", "◧ 1–8", "◨ 9–16"];

// Loop-length control. Below a bar it walks by steps (polymeter, 2..16);
// at 16 the + steps up in WHOLE BARS (32/48/64) so a lane can hold the
// whole progression. Growing past a bar unrolls the loop - the existing
// bar tiles into the new space, so the sound doesn't change until you
// edit bar 2 - and shrinking keeps the data (playback just loops early).
function stepLenControl(scene, track) {
  const set = (d) => {
    pushUndo();
    const cur = stepsFor(scene, track);
    let next;
    if (d > 0) next = cur >= 16 ? Math.min(64, cur + 16) : cur + 1;
    else next = cur > 16 ? cur - 16 : Math.max(2, cur - 1);
    (scene.steps ||= { drums: 16, bass: 16, melody: 16 })[track] = next;
    if (next > cur && next > 16) {
      const tile = (arr) => {
        for (let i = arr.length; i < next; i++) arr[i] = structuredClone(arr[i % cur] ?? null);
      };
      if (track === "drums") for (const v of DRUM_VOICES) tile(scene.drums[v]);
      else tile(scene[track]);
    }
    gridBar = Math.min(gridBar, Math.ceil(next / 16) - 1);
    openEditor(editor.scene, track);
    refreshClip(editor.scene, track);
  };
  const len = stepsFor(scene, track);
  return el("div", { class: "steplenctl", title: "Loop length: steps below a bar, whole bars above" }, [
    el("div", { class: "tfbtn", text: "−", onclick: () => set(-1) }),
    el("div", { class: "numval steplen", text: len > 16 ? `${len / 16} bars` : `${len}` }),
    el("div", { class: "tfbtn", text: "+", onclick: () => set(1) }),
  ]);
}

function buildDrumEditor(scene) {
  const tfd = el("div", { class: "tfrow" }, [
    el("div", {
      class: "tfbtn",
      text: "🎲",
      onclick: () => {
        pushUndo();
        // The same drummer the song hired (a weighted stranger when an old
        // save carries no vibe), dealing a fresh take at the clip's own
        // length — this button used to spray fixed densities over one flat
        // rock backbeat no archetype plays.
        const len = Math.max(16, stepsFor(scene, "drums"));
        const rolled = rollDrumPhrase(Math.floor(len / 16), song.vibe?.groove);
        for (const v of DRUM_VOICES) {
          for (let s = 0; s < len; s++) scene.drums[v][s] = rolled[v][s];
        }
        openEditor(editor.scene, "drums");
        refreshClip(editor.scene, "drums");
      },
    }),
    el("div", {
      class: "tfbtn",
      text: "Humanize",
      onclick: () => {
        pushUndo();
        for (const v of DRUM_VOICES) {
          for (let s = 0; s < scene.drums[v].length; s++) {
            if (scene.drums[v][s] > 0) {
              scene.drums[v][s] = Math.max(0.4, Math.min(1, scene.drums[v][s] + (Math.random() * 0.4 - 0.2)));
            }
          }
        }
        openEditor(editor.scene, "drums");
        refreshClip(editor.scene, "drums");
      },
    }),
    el("div", {
      class: "tfbtn",
      text: "Clear",
      onclick: () => {
        pushUndo();
        for (const v of DRUM_VOICES) for (let s = 0; s < scene.drums[v].length; s++) scene.drums[v][s] = 0;
        openEditor(editor.scene, "drums");
        refreshClip(editor.scene, "drums");
      },
    }),
    stepLenControl(scene, "drums"),
  ]);
  sheet.appendChild(tfd);

  const clipLen = stepsFor(scene, "drums");
  gridBar = Math.min(gridBar, Math.ceil(clipLen / 16) - 1);
  const B = gridBar * 16; // the visible page's offset into the lane
  const pager = barPager(editor.scene, "drums", clipLen);
  if (pager) sheet.appendChild(pager);
  const stepEls = {};
  const scrollContainer = el("div", { class: "editor-scroll" });
  for (const v of DRUM_VOICES) {
    stepEls[v] = [];
    const steps = el("div", { class: "steps", style: "touch-action:none" });
    // Drag-paint: pointerdown sets add/delete mode based on initial cell state;
    // dragging over subsequent cells applies the same action to each.
    let drumDragMode = null; // 'add' | 'delete' | null
    let drumDragPre = null;
    const stepsArr = [];
    for (let s = 0; s < 16; s++) {
      const on = scene.drums[v][B + s];
      const cell = el("div", {
        class: `step ${Math.floor(s / 4) % 2 ? "" : "g"} ${on ? "on" : ""}${B + s >= clipLen ? " off" : ""}`,
        style: `--pc:${padHex(v)}`,
      });
      stepsArr.push(cell);
      stepEls[v].push(cell);
      steps.appendChild(cell);
    }

    // Hit-test against a rect read ONCE per gesture: a fresh
    // getBoundingClientRect per pointermove, interleaved with the paint's
    // height writes, forced a synchronous layout per painted cell. The row's
    // geometry can't change mid-drag — the sheet is modal and doesn't scroll
    // horizontally.
    let dragRect = null;
    const stepAtX = (clientX) => {
      const rect = dragRect || (dragRect = steps.getBoundingClientRect());
      const idx = Math.floor((clientX - rect.left) / (rect.width / 16));
      return Math.max(0, Math.min(15, idx));
    };

    steps.addEventListener("pointerdown", async (e) => {
      e.preventDefault();
      await ensureStarted();
      drumDragPre = snapshot();
      dragRect = null; // fresh read at gesture start, reused for the drag
      const s0 = stepAtX(e.clientX);
      if (B + s0 >= clipLen) return;
      drumDragMode = scene.drums[v][B + s0] > 0 ? "delete" : "add";
      scene.drums[v][B + s0] = drumDragMode === "add" ? 0.9 : 0;
      stepsArr[s0].classList.toggle("on", scene.drums[v][B + s0] > 0);
      if (drumDragMode === "add") {
        audio.previewHit(v);
        buzz();
      }
      paintClipMini(editor.scene, "drums");
      if (typeof paintDrums === "function") paintDrums();
      capturePointer(steps, e.pointerId);
    });
    steps.addEventListener("pointermove", (e) => {
      if (drumDragMode === null) return;
      const s = stepAtX(e.clientX);
      if (B + s >= clipLen) return;
      const shouldOn = drumDragMode === "add";
      const isOn = scene.drums[v][B + s] > 0;
      if (isOn !== shouldOn) {
        scene.drums[v][B + s] = shouldOn ? 0.9 : 0;
        stepsArr[s].classList.toggle("on", shouldOn);
        paintClipMini(editor.scene, "drums");
        if (typeof paintDrums === "function") paintDrums();
      }
    });
    steps.addEventListener("pointerup", () => {
      if (drumDragPre) commitUndo(drumDragPre);
      drumDragMode = null;
      drumDragPre = null;
    });
    steps.addEventListener("pointercancel", () => {
      drumDragMode = null;
      drumDragPre = null;
    });

    const pad = el("div", {
      class: "pad",
      style: `--pc:${padHex(v)}`,
      text: DRUM_META[v].label,
      onclick: async () => {
        await ensureStarted();
        audio.previewHit(v);
        buzz();
      },
    });
    scrollContainer.appendChild(el("div", { class: "drumrow" }, [pad, steps]));
  }
  sheet.appendChild(scrollContainer);

  // .drums variant: match the 54px pad column so bars sit under their steps.
  // Same lane picker as the piano editors: velocity or a captured ride.
  let laneParam = "vel";
  let laneBar = 0;
  const laneParams = () => ["vel", ...Object.keys(scene.motion?.drums || {})];
  const vlane = el("div", { class: "vlane drums" });
  const vbars = [];
  const vkey = el("div", {
    class: "vkey vkey-pick",
    role: "button",
    text: "vel",
    onclick: () => {
      const ps = laneParams();
      laneParam = ps[(ps.indexOf(laneParam) + 1) % ps.length];
      laneBar = 0;
      laneChrome();
      paintDrums();
    },
  });
  vlane.appendChild(vkey);
  const vsteps = el("div", { class: "vsteps" });
  for (let s = 0; s < 16; s++) {
    const fill = el("i", { style: `--tc:${trackColor("drums")}` });
    const bar = el("div", { class: "vbar" }, [fill]);
    bar.addEventListener("pointerdown", (e) => onDrumVelDown(e, s, bar));
    vbars.push(fill);
    vsteps.appendChild(bar);
  }
  vlane.appendChild(vsteps);
  sheet.appendChild(vlane);
  const barChips = el("div", { class: "lane-bars" });
  const clearChip = el("div", {
    class: "lane-clear",
    text: "✕ clear ride",
    onclick: () => {
      if (laneParam === "vel" || !scene.motion?.drums) return;
      pushUndo();
      delete scene.motion.drums[laneParam];
      if (!Object.keys(scene.motion.drums).length) delete scene.motion.drums;
      laneParam = "vel";
      laneChrome();
      paintDrums();
      refreshClip(editor.scene, "drums");
    },
  });
  const laneCtl = el("div", { class: "lane-ctl" }, [barChips, clearChip]);
  sheet.appendChild(laneCtl);
  function laneChrome() {
    vkey.textContent = laneParam;
    vkey.classList.toggle("on", laneParam !== "vel");
    laneCtl.style.display = laneParam === "vel" ? "none" : "";
    const arr = scene.motion?.drums?.[laneParam];
    barChips.innerHTML = "";
    const nBars = arr ? Math.round(arr.length / 16) : 1;
    if (laneParam !== "vel" && nBars > 1) {
      for (let b = 0; b < nBars; b++) {
        barChips.appendChild(
          el("div", {
            class: "lane-bar" + (b === laneBar ? " on" : ""),
            text: String(b + 1),
            onclick: () => {
              laneBar = b;
              laneChrome();
              paintDrums();
            },
          })
        );
      }
    }
  }
  laneChrome();

  function paintDrums() {
    // A picked motion ride owns the lane; velocity painting resumes on vel.
    const marr = laneParam === "vel" ? null : scene.motion?.drums?.[laneParam];
    if (marr) {
      for (let s = 0; s < 16; s++) {
        const h = Math.round(marr[(laneBar * 16 + s) % marr.length] * 100) + "%";
        if (vbars[s].__h !== h) {
          vbars[s].__h = h;
          vbars[s].style.height = h;
          vbars[s].parentElement.style.opacity = 1;
        }
      }
      return;
    }
    // Dirty-checked: a drag-paint calls this per painted cell, and fifteen of
    // the sixteen columns haven't moved — unconditional height writes were
    // sixteen layout-dirtying styles per painted step.
    for (let s = 0; s < 16; s++) {
      let maxVel = 0;
      for (const v of DRUM_VOICES) {
        if (scene.drums[v][B + s] > maxVel) maxVel = scene.drums[v][B + s];
      }
      const h = maxVel > 0 ? Math.round(maxVel * 100) + "%" : "0%";
      if (vbars[s].__h !== h) {
        vbars[s].__h = h;
        vbars[s].style.height = h;
        vbars[s].parentElement.style.opacity = maxVel > 0 ? 1 : 0.3;
      }
    }
  }

  async function onDrumVelDown(e, s, bar) {
    e.preventDefault();
    if (laneParam !== "vel") {
      const arr = scene.motion?.drums?.[laneParam];
      if (!arr) return;
      pushUndo();
      const mrect = bar.getBoundingClientRect();
      const mset = (ev) => {
        arr[(laneBar * 16 + s) % arr.length] = Math.max(0, Math.min(1, 1 - (ev.clientY - mrect.top) / mrect.height));
        paintDrums();
      };
      mset(e);
      capturePointer(bar, e.pointerId);
      const mmove = (ev) => mset(ev);
      const mup = () => {
        bar.removeEventListener("pointermove", mmove);
        bar.removeEventListener("pointerup", mup);
        bar.removeEventListener("pointercancel", mup);
      };
      bar.addEventListener("pointermove", mmove);
      bar.addEventListener("pointerup", mup);
      bar.addEventListener("pointercancel", mup);
      return;
    }
    let hasNotes = false;
    for (const v of DRUM_VOICES) if (scene.drums[v][B + s] > 0) hasNotes = true;
    if (!hasNotes) return;
    await ensureStarted();
    pushUndo();
    const rect = bar.getBoundingClientRect();
    const set = (ev) => {
      const vel = Math.max(0.05, Math.min(1, 1 - (ev.clientY - rect.top) / rect.height));
      for (const v of DRUM_VOICES) {
        if (scene.drums[v][B + s] > 0) scene.drums[v][B + s] = vel;
      }
      paintDrums();
    };
    set(e);
    capturePointer(bar, e.pointerId);
    const move = (ev) => set(ev);
    const up = () => {
      bar.removeEventListener("pointermove", move);
      bar.removeEventListener("pointerup", up);
      bar.removeEventListener("pointercancel", up);
      paintClipMini(editor.scene, "drums");
    };
    bar.addEventListener("pointermove", move);
    bar.addEventListener("pointerup", up);
    bar.addEventListener("pointercancel", up);
  }

  paintDrums();

  editor.stepEls = stepEls;
  editor.moveCursor = makeStepCursor(scrollContainer, (i) => stepEls.kick[i], 0, 16, (i) => stepEls.clap[i]);
}

// One transform-moved overlay instead of class sweeps across every cell in a
// column: the sweep measured ~900 class ops/s at 120 BPM with a piano editor
// open. Geometry is read once per editor build, never per 16th.
function makeStepCursor(container, cellFor, first, count, lastCellFor = cellFor) {
  const cursor = el("div", { class: "step-cursor" });
  container.appendChild(cursor);
  let geo = null;
  let shown = false;
  return (s) => {
    if (s < first || s >= first + count) {
      if (shown) {
        cursor.style.display = "none";
        shown = false;
      }
      return;
    }
    if (!geo) {
      geo = {};
      for (let i = first; i < first + count; i++) {
        const c = cellFor(i);
        if (c) geo[i] = { x: c.offsetLeft, w: c.offsetWidth };
      }
      const top = cellFor(s);
      const bottom = lastCellFor(s);
      if (top && bottom) {
        cursor.style.top = `${top.offsetTop}px`;
        cursor.style.height = `${bottom.offsetTop + bottom.offsetHeight - top.offsetTop}px`;
      }
      cursor.style.width = `${geo[s]?.w || 0}px`;
    }
    if (!geo[s]) return;
    if (!shown) {
      cursor.style.display = "block";
      shown = true;
    }
    cursor.style.transform = `translateX(${geo[s].x}px)`;
  };
}

function buildPianoEditor(sceneIndex, scene, track) {
  const cfg = PIANO[track];
  // Chops mode: rows ARE slices (midi 60 = slice 1), the upper run replays
  // the set at double speed. Otherwise, the scale-snapped pitch rows.
  const chops = track === "melody" && audio.patch("melody").source === "chops" ? audio.chopInfo() : null;
  const rows = chops
    ? Array.from({ length: Math.min(32, chops.count * 2) }, (_, i) => 60 + i).reverse()
    : scaleNotes(cfg.base, cfg.rows).reverse(); // high pitch on top
  const rowLabel = (midi) =>
    chops ? `s${((midi - 60) % chops.count) + 1}${midi - 60 >= chops.count ? "×2" : ""}` : noteName(midi);
  const lane = scene[track];
  const tc = trackColor(track);

  // One-tap transforms.
  const pcToMidi = (pc, base) => {
    let m = base - (((base % 12) + 12) % 12) + (((pc % 12) + 12) % 12);
    while (m < base) m += 12;
    return m;
  };
  const applyTf = (fn) => {
    pushUndo();
    fn();
    paint();
    refreshClip(sceneIndex, track);
    scrollToNotes();
  };
  const tf = el("div", { class: "tfrow" }, [
    el("div", {
      class: "tfbtn",
      text: "Arp",
      onclick: () =>
        applyTf(() => {
          for (let b = 0; b < 4; b++) {
            const ch = harmonyChord(scene.harmony[b % scene.harmony.length]);
            for (let k = 0; k < 4; k++) {
              let midi = pcToMidi(ch.pcs[k % 3], cfg.base);
              if (k === 3) midi += 12;
              setNoteSlot(lane, b * 4 + k, [{ midi, len: 1, vel: 0.85 }]);
            }
          }
        }),
    }),
    el("div", { class: "tfbtn", text: "Oct−", onclick: () => applyTf(() => { for (let s = 0; s < lane.length; s++) for (const n of noteSlot(lane[s])) n.midi -= 12; }) }),
    el("div", { class: "tfbtn", text: "Oct+", onclick: () => applyTf(() => { for (let s = 0; s < lane.length; s++) for (const n of noteSlot(lane[s])) n.midi += 12; }) }),
    el("div", {
      class: "tfbtn",
      text: "Humanize",
      onclick: () => applyTf(() => { for (let s = 0; s < lane.length; s++) for (const n of noteSlot(lane[s])) n.vel = Math.max(0.4, Math.min(1, n.vel + (Math.random() * 0.4 - 0.2))); }),
    }),
    el("div", {
      class: "tfbtn",
      text: "🎲",
      onclick: () =>
        applyTf(() => {
          // Roll inside one 2-octave in-scale window (14 notes = base..B+2oct),
          // placed low for bass and mid for melody — the full cfg.rows range
          // scattered notes across eight octaves, which never sounded like a
          // line. Windows sit between octave 2 and octave 5.
          const base = pick(track === "bass" ? [36, 48] : [48, 60]);
          const ns = scaleNotes(base, 14);
          for (let s = 0; s < Math.max(16, stepsFor(scene, track)); s++) {
            if (Math.random() >= 0.5) {
              lane[s] = null;
              continue;
            }
            const count = track === "melody" && Math.random() < 0.22 ? 2 + Math.floor(Math.random() * 2) : 1;
            const notes = [];
            for (let i = 0; i < count; i++) {
              notes.push({ midi: ns[Math.floor(Math.random() * ns.length)], len: 1, vel: 0.6 + Math.random() * 0.4 });
            }
            setNoteSlot(lane, s, notes);
          }
        }),
    }),
    el("div", { class: "tfbtn", text: "Clear", onclick: () => applyTf(() => { for (let s = 0; s < lane.length; s++) lane[s] = null; }) }),
    el("div", {
      class: "tfbtn",
      text: PIANO_VIEWS[pianoView],
      "data-action": "piano-zoom",
      onclick: () => {
        pianoView = (pianoView + 1) % 3;
        openEditor(sceneIndex, track);
      },
    }),
    stepLenControl(scene, track),
  ]);
  sheet.appendChild(tf);
  const clipLen = stepsFor(scene, track);
  gridBar = Math.min(gridBar, Math.ceil(clipLen / 16) - 1);
  const viewOff = gridBar * 16 + (pianoView === 2 ? 8 : 0);
  const viewCount = pianoView === 0 ? 16 : 8;
  const pager = barPager(sceneIndex, track, clipLen);
  if (pager) sheet.appendChild(pager);

  // The roll's own staff (DESIGN-STAFF): noteheads on the step grid, treble
  // for melody, a drawn F clef for bass — per-track clef IS the grand-staff
  // call, since the tracks are separate editors. Hidden in chops mode:
  // slices aren't pitches.
  const rollStaff = chops ? null : el("canvas", { class: "rollstaff" });
  if (rollStaff) sheet.appendChild(rollStaff);
  let rollStaffRAF = 0;
  const laneMidis = lane.flatMap((slot) => noteSlot(slot).map((n) => n.midi)).sort((a, b) => a - b);
  const bassClef = laneMidis.length ? laneMidis[Math.floor(laneMidis.length / 2)] < 57 : track === "bass";
  function drawRollStaff() {
    if (!rollStaff) return;
    const w = rollStaff.clientWidth;
    if (!w) return;
    const h = 94;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    rollStaff.width = Math.round(w * dpr);
    rollStaff.height = Math.round(h * dpr);
    const c = rollStaff.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const S = 8;
    const bass = bassClef; // the lane's register picks the clef, not the track name
    const baseStep = bass ? 25 : 37; // bottom line: G2 on the bass staff, E4 on the treble
    // Bass parts are WRITTEN an octave above sounding - the bass-guitar
    // convention, marked by the small 8 under the clef. Without it a rolled
    // E1 sits five ledger lines under the staff and its head clips right
    // off the canvas: notes that play but never show.
    const written = track === "bass" ? 12 : 0;
    const bottomY = h - 24;
    const yOf = (step) => bottomY - (step - baseStep) * (S / 2);
    c.strokeStyle = "rgba(255,255,255,0.3)";
    c.lineWidth = 1;
    for (let l = 0; l < 5; l++) {
      const y = bottomY - l * S;
      c.beginPath();
      c.moveTo(4, y);
      c.lineTo(w - 4, y);
      c.stroke();
    }
    c.fillStyle = "rgba(240,240,244,0.85)";
    c.strokeStyle = "rgba(240,240,244,0.85)";
    c.textBaseline = "middle";
    drawStaffLetters(c, yOf, baseStep, bass, S);
    if (bass) drawFClef(c, S * 2.2, yOf(baseStep + 6), S);
    else drawGClef(c, S * 2.3, yOf(baseStep + 2), S);
    if (written) {
      // The sub-octave numeral: this staff sounds an octave lower than written.
      c.font = `700 ${Math.round(S * 1.1)}px system-ui, sans-serif`;
      c.textAlign = "center";
      c.fillText("8", S * 3.2, yOf(baseStep) + S * 0.9);
    }
    const sig = keySignature(song.key, song.scale);
    const units = sig > 0 ? [8, 5, 9, 6, 3, 7, 4] : [4, 7, 3, 6, 2, 5, 1];
    c.textAlign = "center";
    c.font = `600 ${Math.round(S * 2)}px system-ui, sans-serif`;
    let sx = S * 5.9;
    for (let i = 0; i < Math.abs(sig); i++) {
      const u = units[i] - (bass ? 2 : 0);
      c.fillText(sig > 0 ? "♯" : "♭", sx, yOf(baseStep + u) - (sig < 0 ? S * 0.3 : 0));
      sx += S * 0.9;
    }
    const cell0 = rowCells[0]?.[viewOff];
    if (!cell0) return;
    const cRect = rollStaff.getBoundingClientRect();
    const gRect = cell0.getBoundingClientRect();
    const colW = gRect.width;
    const x0 = gRect.left - cRect.left + colW / 2;
    for (let s = viewOff; s < viewOff + viewCount; s++) {
      const x = x0 + (s - viewOff) * colW;
      for (const n of noteSlot(lane[s])) {
        const sp = spellPitch(n.midi + written);
        const rel = sp.step - baseStep;
        c.strokeStyle = "rgba(255,255,255,0.3)";
        c.lineWidth = 1;
        for (let u = -2; u >= rel; u -= 2) {
          const y = yOf(baseStep + u);
          c.beginPath();
          c.moveTo(x - S, y);
          c.lineTo(x + S, y);
          c.stroke();
        }
        for (let u = 10; u <= rel; u += 2) {
          const y = yOf(baseStep + u);
          c.beginPath();
          c.moveTo(x - S, y);
          c.lineTo(x + S, y);
          c.stroke();
        }
        if (sp.acc !== signatureAccFor(sp.letter, sig)) {
          c.fillStyle = "rgba(240,240,244,0.9)";
          c.font = `600 ${Math.round(S * 1.7)}px system-ui, sans-serif`;
          c.textAlign = "right";
          c.fillText(sp.acc > 0 ? "♯" : sp.acc < 0 ? "♭" : "♮", x - S * 0.75, yOf(sp.step) - (sp.acc < 0 ? S * 0.25 : 0));
          c.textAlign = "center";
        }
        c.fillStyle = "#f0f0f4";
        c.beginPath();
        c.ellipse(x, yOf(sp.step), S * 0.55, S * 0.42, -0.25, 0, Math.PI * 2);
        c.fill();
      }
    }
  }

  const scrollContainer = el("div", { class: "editor-scroll" });
  const grid = el("div", { class: "proll" });
  const rowCells = []; // [rowIndex][step]

  const noteAt = (step, midi = null) => {
    for (let st = 0; st < lane.length; st++) {
      const notes = noteSlot(lane[st]);
      for (let i = 0; i < notes.length; i++) {
        const n = notes[i];
        if (step >= st && step < st + n.len && (midi === null || n.midi === midi)) {
          return { step: st, index: i, note: n };
        }
      }
    }
    return null;
  };

  rows.forEach((midi, ri) => {
    const cells = [];
    const rowSteps = el("div", { class: "psteps", style: `grid-template-columns: repeat(${viewCount}, 1fr)` });
    for (let s = viewOff; s < viewOff + viewCount; s++) {
      const cell = el("div", { class: "pcell", style: `--tc:${tc}` });
      cell.addEventListener("pointerdown", (e) => onNoteDown(e, s, midi, cell));
      cells[s] = cell;
      rowSteps.appendChild(cell);
    }
    rowCells.push(cells);
    // Row labels wear their degree's function hue — the wheel's color
    // language under the note editors, quiet enough to ignore.
    const deg = chops ? -1 : scaleDegreeOfPc(midi % 12);
    grid.appendChild(
      el("div", { class: "prow" }, [
        el("div", {
          class: "pkey" + (!chops && midi % 12 === 0 ? " c" : ""),
          text: rowLabel(midi),
          style: deg >= 0 ? `color:${hex(hslInt(CHORDS[deg].hue, 34, 66))}` : "",
        }),
        rowSteps,
      ])
    );
  });
  scrollContainer.appendChild(grid);
  sheet.appendChild(scrollContainer);

  // The lane below the grid, with a picker (D5's second half): velocity, or
  // any motion ride the ● captured — tap the label to cycle, chips pick the
  // bar of a long lane, ✕ clears the picked ride.
  let laneParam = "vel";
  let laneBar = 0;
  const laneParams = () => ["vel", ...Object.keys(scene.motion?.[track] || {})];
  const vlane = el("div", { class: "vlane" });
  const vbars = [];
  const vkey = el("div", {
    class: "vkey vkey-pick",
    role: "button",
    text: "vel",
    onclick: () => {
      const ps = laneParams();
      laneParam = ps[(ps.indexOf(laneParam) + 1) % ps.length];
      laneBar = 0;
      laneChrome();
      paint();
    },
  });
  vlane.appendChild(vkey);
  const vsteps = el("div", { class: "vsteps", style: `grid-template-columns: repeat(${viewCount}, 1fr)` });
  for (let s = viewOff; s < viewOff + viewCount; s++) {
    const fill = el("i", { style: `--tc:${tc}` });
    const bar = el("div", { class: "vbar" }, [fill]);
    bar.addEventListener("pointerdown", (e) => onVelDown(e, s, bar));
    vbars[s] = fill;
    vsteps.appendChild(bar);
  }
  vlane.appendChild(vsteps);
  sheet.appendChild(vlane);
  const barChips = el("div", { class: "lane-bars" });
  const clearChip = el("div", {
    class: "lane-clear",
    text: "✕ clear ride",
    onclick: () => {
      if (laneParam === "vel" || !scene.motion?.[track]) return;
      pushUndo();
      delete scene.motion[track][laneParam];
      if (!Object.keys(scene.motion[track]).length) delete scene.motion[track];
      laneParam = "vel";
      laneChrome();
      paint();
      refreshClip(sceneIndex, track);
    },
  });
  const laneCtl = el("div", { class: "lane-ctl" }, [barChips, clearChip]);
  sheet.appendChild(laneCtl);
  function laneChrome() {
    vkey.textContent = laneParam;
    vkey.classList.toggle("on", laneParam !== "vel");
    laneCtl.style.display = laneParam === "vel" ? "none" : "";
    const arr = scene.motion?.[track]?.[laneParam];
    barChips.innerHTML = "";
    const nBars = arr ? Math.round(arr.length / 16) : 1;
    if (laneParam !== "vel" && nBars > 1) {
      for (let b = 0; b < nBars; b++) {
        barChips.appendChild(
          el("div", {
            class: "lane-bar" + (b === laneBar ? " on" : ""),
            text: String(b + 1),
            onclick: () => {
              laneBar = b;
              laneChrome();
              paint();
            },
          })
        );
      }
    }
  }
  laneChrome();

  function paint() {
    rows.forEach((midi, ri) => {
      for (let s = viewOff; s < viewOff + viewCount; s++) {
        const hit = noteAt(s, midi);
        rowCells[ri][s].className = `pcell${Math.floor(s / 4) % 2 ? "" : " g"}${hit ? " on" : ""}${hit && hit.step === s ? " nstart" : ""}${s >= clipLen ? " off" : ""}`;
      }
    });
    const arr = laneParam === "vel" ? null : scene.motion?.[track]?.[laneParam];
    for (let s = viewOff; s < viewOff + viewCount; s++) {
      if (arr) {
        vbars[s].style.height = Math.round(arr[(laneBar * 16 + s) % arr.length] * 100) + "%";
        vbars[s].parentElement.style.opacity = 1;
      } else {
        const notes = noteSlot(lane[s]);
        vbars[s].style.height = notes.length ? Math.round(slotPeakVel(lane[s]) * 100) + "%" : "0%";
        vbars[s].parentElement.style.opacity = notes.length ? 1 : 0.3;
      }
    }
    // Coalesced: paint() runs per pointermove during a note stretch, and a
    // sync staff redraw there is two forced layouts per move on little cores.
    if (!rollStaffRAF) {
      rollStaffRAF = requestAnimationFrame(() => {
        rollStaffRAF = 0;
        drawRollStaff();
      });
    }
  }

  const scrollToNotes = () => {
    const activeRow = scrollContainer.querySelector(".pcell.on")?.closest(".prow");
    if (activeRow) {
      scrollContainer.scrollTop = activeRow.offsetTop - scrollContainer.clientHeight / 2 + activeRow.clientHeight / 2;
    } else {
      const defaultMidi = track === "bass" ? 36 : 60; // C2 or C4
      const targetRi = rows.findIndex(m => m <= defaultMidi);
      if (targetRi >= 0) {
        const rowEl = grid.children[targetRi];
        if (rowEl) scrollContainer.scrollTop = rowEl.offsetTop - scrollContainer.clientHeight / 2 + rowEl.clientHeight / 2;
      }
    }
  };

  function onNoteDown(e, s, midi, cell) {
    e.preventDefault();
    if (s >= clipLen) return;
    pushUndo();
    const existing = noteAt(s, midi);
    const start = existing?.step ?? s;
    let note = existing?.note;
    if (!note) {
      // setNoteSlot stores normalized clones — the drag below must mutate the
      // note the lane holds, or the length snaps back to 1 on repaint.
      setNoteSlot(lane, s, [...noteSlot(lane[s]), { midi, len: 1, vel: slotPeakVel(lane[s]) || 0.9 }]);
      note = noteAt(s, midi).note;
      // Only the preview needs audio. Awaiting init before wiring the gesture
      // dropped the whole drag on a session's first press (150 ms+ of primer),
      // which read as "you must press twice to stretch a note".
      ensureStarted().then(() => audio.previewNote(track, midi)).catch(() => {});
    }
    paint();
    let moved = false;
    const rect = cell.parentElement.getBoundingClientRect();
    const cw = rect.width / viewCount;
    capturePointer(cell, e.pointerId);
    const move = (ev) => {
      const cur = Math.max(start, Math.min(viewOff + viewCount - 1, viewOff + Math.floor((ev.clientX - rect.left) / cw)));
      const len = cur - start + 1;
      if (len !== note.len) {
        removePitchInRange(lane, midi, start + 1, Math.min(15, start + len - 1), start);
        note.len = len;
        moved = true;
        paint();
      }
    };
    const up = () => {
      cell.removeEventListener("pointermove", move);
      cell.removeEventListener("pointerup", up);
      cell.removeEventListener("pointercancel", up);
      if (!moved && existing) {
        removeNoteFromSlot(lane, existing.step, existing.index);
        paint();
      }
      paintClipMini(sceneIndex, track);
    };
    cell.addEventListener("pointermove", move);
    cell.addEventListener("pointerup", up);
    cell.addEventListener("pointercancel", up);
  }

  function onVelDown(e, s, bar) {
    e.preventDefault();
    // A picked motion ride draws straight into its lane, same gesture.
    if (laneParam !== "vel") {
      const arr = scene.motion?.[track]?.[laneParam];
      if (!arr) return;
      pushUndo();
      const mrect = bar.getBoundingClientRect();
      const mset = (ev) => {
        arr[(laneBar * 16 + s) % arr.length] = Math.max(0, Math.min(1, 1 - (ev.clientY - mrect.top) / mrect.height));
        paint();
      };
      mset(e);
      capturePointer(bar, e.pointerId);
      const mmove = (ev) => mset(ev);
      const mup = () => {
        bar.removeEventListener("pointermove", mmove);
        bar.removeEventListener("pointerup", mup);
        bar.removeEventListener("pointercancel", mup);
      };
      bar.addEventListener("pointermove", mmove);
      bar.addEventListener("pointerup", mup);
      bar.addEventListener("pointercancel", mup);
      return;
    }
    if (!noteSlot(lane[s]).length) return;
    ensureStarted().catch(() => {}); // warm the context; the drag itself makes no sound
    pushUndo();
    const rect = bar.getBoundingClientRect();
    const set = (ev) => {
      const vel = Math.max(0.05, Math.min(1, 1 - (ev.clientY - rect.top) / rect.height));
      for (const n of noteSlot(lane[s])) n.vel = vel;
      paint();
    };
    set(e);
    capturePointer(bar, e.pointerId);
    const move = (ev) => set(ev);
    const up = () => {
      bar.removeEventListener("pointermove", move);
      bar.removeEventListener("pointerup", up);
      bar.removeEventListener("pointercancel", up);
      paintClipMini(sceneIndex, track);
    };
    bar.addEventListener("pointermove", move);
    bar.addEventListener("pointerup", up);
    bar.addEventListener("pointercancel", up);
  }

  paint();
  setTimeout(scrollToNotes, 20); // wait for layout to settle
  editor.moveCursor = makeStepCursor(grid, (i) => rowCells[0]?.[i], viewOff, viewCount, (i) => rowCells[rowCells.length - 1]?.[i]);
}

function buildHarmonyEditor(sceneIndex, scene) {
  if (!scene.harmony || scene.harmony.length === 0) scene.harmony = [0, 0, 0, 0];
  let selected = 0;
  // Whole-clip octave, like the piano editors' Oct buttons but on the scene:
  // chords are stored as degrees, so the shift lives in playback, not the data.
  const octLabel = () => `oct ${scene.harmonyOct > 0 ? "+" : ""}${scene.harmonyOct || 0}`;
  const octVal = el("div", { class: "numval", text: octLabel() });
  const setOct = async (d) => {
    const next = Math.max(-1, Math.min(1, (scene.harmonyOct || 0) + d));
    if (next === scene.harmonyOct) return;
    pushUndo();
    scene.harmonyOct = next;
    octVal.textContent = octLabel();
    drawStaff(); // the register move is visible: the engraving shifts an octave
    await ensureStarted();
    audio.preview(scene.harmony[selected], scene.harmonyOct);
  };
  sheet.appendChild(
    el("div", { class: "tfrow oct-row" }, [
      el("div", { class: "tfbtn", text: "Oct−", onclick: () => setOct(-1) }),
      octVal,
      el("div", { class: "tfbtn", text: "Oct+", onclick: () => setOct(1) }),
    ])
  );
  const scrollContainer = el("div", { class: "editor-scroll" });
  // The staff: the same clip, wearing the costume. Treble clef, the key's
  // real signature, and each slot's chord engraved AS ITS HEARD VOICING —
  // the voiceLead chain, not root position. Accidentals print only where a
  // tone breaks the signature's promise, and since harmony is one chord per
  // bar, per-chord accidentals are engraving-correct: every slot is its own
  // measure. Borrowed chords arrive with their accidentals on; that's the
  // whole reveal.
  const staffCanvas = el("canvas", { class: "staffview" });
  scrollContainer.appendChild(staffCanvas);
  function drawStaff() {
    const w = staffCanvas.clientWidth;
    if (!w || !scene.harmony.length) return;
    const h = 190;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    staffCanvas.width = Math.round(w * dpr);
    staffCanvas.height = Math.round(h * dpr);
    const c = staffCanvas.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const geo = paintChordStaff(c, {
      w,
      h,
      S: 11,
      key: song.key,
      scale: song.scale,
      harmony: scene.harmony,
      harmonyOct: scene.harmonyOct || 0,
      gridGap: 8, // the chordrow's grid gap: bar centers land on slot centers
    });
    // One grid: the chord slots adopt the engraving's bar columns, so each
    // tower sits exactly over the slot it sounds from.
    row.style.paddingLeft = `${geo.startX}px`;
    row.style.paddingRight = `${w - geo.right}px`;
  }
  const row = el("div", { class: "chordrow" });
  const slots = scene.harmony.map((ci, idx) => {
    const slot = el("div", {
      class: "cslot" + (idx === 0 ? " sel" : ""),
      style: `--tc:${trackColor("harmony")}`,
      html: chordMarkup(ci, { notes: true }),
      onclick: () => {
        selected = idx;
        slots.forEach((s, k) => s.classList.toggle("sel", k === idx));
        refreshRungRow();
        refreshInvRow();
      },
    });
    return slot;
  });
  slots.forEach((s) => row.appendChild(s));
  scrollContainer.appendChild(row);

  // The ladder, controllable where arranging happens: rung chips rebuild the
  // selected bar's stack — triad up the numbers to 13, or a sus swap — with
  // the exact arithmetic the wheel's bloom pads use (ladderPcs). Collapsing
  // back to a plain diatonic triad hands the slot its degree number again,
  // so it keeps following the key.
  const rungRow = el("div", { class: "lane-ctl rung-row" });
  scrollContainer.appendChild(rungRow);
  function refreshRungRow() {
    rungRow.innerHTML = "";
    const entry = scene.harmony[selected];
    const cur = ladderRungOf(entry);
    for (const rung of LADDER_RUNGS) {
      rungRow.appendChild(
        el("div", {
          class: "lane-bar" + (rung === cur ? " on" : ""),
          text: rung,
          "data-action": `rung-${rung}`,
          onclick: async () => {
            if (rung === cur) return;
            pushUndo();
            const pcs = ladderPcs(entry, rung);
            const inv = Math.min((typeof entry === "object" && entry.inv) || 0, Math.min(3, pcs.length - 1));
            const asDegree = CHORDS.findIndex((c) => c.pcs.join() === pcs.join());
            scene.harmony[selected] = inv === 0 && asDegree >= 0 ? asDegree : inv > 0 ? { pcs, inv } : { pcs };
            slots[selected].innerHTML = chordMarkup(scene.harmony[selected], { notes: true });
            refreshRungRow();
            refreshInvRow();
            scheduleEditorPaint();
            await ensureStarted();
            audio.preview(scene.harmony[selected], scene.harmonyOct);
          },
        })
      );
    }
  }
  refreshRungRow();

  // Inversions, controllable where arranging happens: chips under the slots
  // pick the selected bar's bass — root, /3, /5, /7 when the stack has one.
  // A degree entry stays a degree at root position (key-following intact)
  // and materializes to pcs only when a slash is chosen; the sub voices the
  // chosen bass, which is the inversion made audible.
  const invRow = el("div", { class: "lane-ctl inv-row" });
  scrollContainer.appendChild(invRow);
  function refreshInvRow() {
    invRow.innerHTML = "";
    const entry = scene.harmony[selected];
    const ch = harmonyChord(entry);
    const n = Math.min(4, ch.pcs.length);
    const cur = (typeof entry === "object" && entry.inv) || 0;
    // Chips wear the actual note that would be the bass — C/E's E, not an
    // interval numeral — so choosing an inversion teaches what it chooses.
    const tones = spellChordTones(entry);
    const chipLabel = (k) => (k === 0 ? "root" : "/" + "CDEFGAB"[tones[k].letter] + (tones[k].acc > 0 ? "♯" : tones[k].acc < 0 ? "♭" : ""));
    Array.from({ length: n }, (_, k) => chipLabel(k)).forEach((label, k) => {
      invRow.appendChild(
        el("div", {
          class: "lane-bar" + (k === cur ? " on" : ""),
          text: label,
          "data-action": `inv-${k}`,
          onclick: async () => {
            if (k === cur) return;
            pushUndo();
            scene.harmony[selected] =
              k === 0 && typeof entry === "number" ? entry : k === 0 ? { pcs: ch.pcs.slice() } : { pcs: ch.pcs.slice(), inv: k };
            slots[selected].innerHTML = chordMarkup(scene.harmony[selected], { notes: true });
            refreshInvRow();
            scheduleEditorPaint();
            await ensureStarted();
            audio.preview(scene.harmony[selected], scene.harmonyOct);
          },
        })
      );
    });
  }
  refreshInvRow();

  requestAnimationFrame(() => {
    drawStaff();
    // Once more next frame: the sheet-open transition can hand the first
    // paint a half-laid-out width; the second pass engraves at rest.
    scheduleEditorPaint();
  });

  // The wheel IS the palette — the same instrument as the key sheet, mounted
  // small, always armed because editing is the intent. Taps write the
  // selected bar; a strum paints bars in a row (the origin wedge joins the
  // run and the selection walks forward); blooms write sevenths, the dim
  // wedges write borrowed chords, the mirror writes reflections. One
  // harmonic surface everywhere.
  const advanceSel = () => {
    selected = (selected + 1) % scene.harmony.length;
    slots.forEach((s, k) => s.classList.toggle("sel", k === selected));
  };
  // Writes repaint on the next frame, once per burst — a four-wedge strum is
  // one event turn, and drawing staff + threads + clip per wedge inside it
  // measured a 109 ms long task on a desktop (an audible gap's worth on the
  // A16). One undo per strum gesture for the same reason: structuredClone
  // per wedge is GC food.
  let editorPaintRAF = 0;
  const scheduleEditorPaint = () => {
    if (editorPaintRAF) return;
    editorPaintRAF = requestAnimationFrame(() => {
      editorPaintRAF = 0;
      drawStaff();
      refreshRungRow();
      refreshInvRow();
      refreshClip(sceneIndex, "harmony");
    });
  };
  editorCircle = createCircleView({
    song,
    audio,
    ensureStarted,
    commitKeyScale: circleKeyScale,
    commitMode: circleDoorMode,
    captureChord: (chord, ctx = {}) => {
      const entry = chord.degree >= 0 ? chord.degree : { pcs: chord.pcs.slice(0, 7) };
      if (harmonyEntryEquals(scene.harmony[selected], entry)) {
        if (ctx.strum) advanceSel();
        return false;
      }
      if (!ctx.strum || ctx.start) pushUndo();
      scene.harmony[selected] = entry;
      slots[selected].innerHTML = chordMarkup(entry, { notes: true });
      scheduleEditorPaint();
      if (ctx.strum) advanceSel();
      return true;
    },
    getHarmonyOct: () => scene.harmonyOct || 0,
    buzz,
    sizeCap: 236,
    strumWrites: true,
    debugHandle: false,
  });
  scrollContainer.appendChild(editorCircle.el);
  // Size the wheel NOW, not next frame: a virgin canvas is born 300×150
  // with zero hit geometry, so a tap landing before a deferred resize was
  // silently eaten (the smoke's strum caught this ~1 run in 4). clientWidth
  // reads 0 mid-build and resize's || 320 fallback still respects sizeCap,
  // so the sync call is safe; the rAF re-measures once layout settles
  // (resize is idempotent).
  editorCircle.opened();
  requestAnimationFrame(() => editorCircle?.opened());
  sheet.appendChild(scrollContainer);
}

function refreshClip(sceneIndex, track) {
  const refs = sceneEls[sceneIndex];
  if (!refs) return;
  const clip = refs.clips[track];
  const content = clipContent(song.scenes[sceneIndex], track);
  clip.innerHTML = "";
  clip.classList.toggle("filled", content !== null);
  clip.classList.toggle("empty", content === null);
  if (!content) {
    clip.textContent = "+";
    refs.pies[track] = null;
    return;
  }
  clip.appendChild(el("div", { class: "tri", text: "▶" }));
  clip.appendChild(content);
  const badge = launchBadge(song.scenes[sceneIndex], track);
  if (badge) clip.appendChild(badge);
  const state = stateBadge(song.scenes[sceneIndex], track);
  if (state) clip.appendChild(state);
  refs.pies[track] = clip.appendChild(el("div", { class: "pie" }));
}

// The drag-paint repaint: write the 16 mini-bar heights of the session cell
// in place instead of rebuilding the cell per painted step (the innerHTML
// path measured 12+ forced layouts a second under a drum sweep). Falls back
// to the full refreshClip whenever the cell's structure is at stake — the
// clip filling or emptying, or no mini to write into. Badge changes (launch,
// steps, motion) keep going through refreshClip; a paint can't cause them.
function paintClipMini(sceneIndex, track) {
  const clip = sceneEls[sceneIndex]?.clips[track];
  if (!clip || track === "harmony") return refreshClip(sceneIndex, track);
  const scene = song.scenes[sceneIndex];
  const filled = track === "drums"
    ? Object.values(scene.drums).some((v) => v.some((x) => x))
    : scene[track].some((n) => n !== null);
  const mini = clip.querySelector(".mini");
  if (!mini || !filled) return refreshClip(sceneIndex, track);
  const bars = mini.children;
  for (let s = 0; s < 16; s++) {
    const h = track === "drums" ? drumBarHeight(scene.drums, s) : noteBarHeight(scene[track][s]);
    const bar = bars[s];
    if (bar && bar.__h !== h) {
      bar.__h = h;
      bar.style.height = h + "px";
    }
  }
}

// ---------------------------------------------------------------------------
// Arrangement view (Ableton's linear timeline, mobile-first)
// ---------------------------------------------------------------------------
let arrScroll = null;
let arrContentEl = null;
let arrPlayhead = null;

function arrMini(scene, track) {
  if (track === "harmony") {
    return el("div", { class: "arr-harmony-mini", html: scene.harmony.map((c) => `<div>${chordMarkup(c)}</div>`).join("") });
  }
  if (track === "drums") {
    const mini = el("div", { class: "cmini" });
    for (let s = 0; s < 16; s++) {
      const hit = scene.drums.kick[s] || scene.drums.snare[s] || scene.drums.clap[s];
      mini.appendChild(el("i", { style: `height:${hit ? 13 : scene.drums.hat[s] ? 7 : 3}px` }));
    }
    return mini;
  }
  const lane = scene[track];
  const mini = el("div", { class: "cmini" });
  for (let s = 0; s < 16; s++) {
    const notes = noteSlot(lane[s]);
    const height = notes.length ? Math.round(3 + slotPeakVel(lane[s]) * 7 + Math.min(4, notes.length - 1) * 2) : 3;
    mini.appendChild(el("i", { style: `height:${height}px` }));
  }
  return mini;
}

function ensureArrShell() {
  const arrEl = document.getElementById("arrangement");
  if (arrScroll) return;
  const headers = el("div", { class: "arr-headers" }, [el("div", { class: "arr-corner" }, [viewMixButton()])]);
  for (const t of ARRANGE_TRACKS) {
    const meta = TRACKS.find((x) => x.key === t);
    const head = el("div", { class: "arr-thead track-head", style: `--tc:${meta.color}`, "data-track": t, "data-sheet": `sound:${t}` }, [
        el("div", { class: "dot" }),
        el("div", { class: "nm", text: meta.name }),
        el("div", { class: "ms" }, [trackToggleButton(t, "mute"), trackToggleButton(t, "solo")]),
        el("div", { class: "more", text: "⋯" }),
      ]);
    bindTrackHeader(head, t);
    headers.appendChild(head);
  }
  arrScroll = el("div", { class: "arr-scroll" });
  attachArrGestures(arrScroll);
  arrEl.appendChild(el("div", { class: "arr-wrap" }, [headers, arrScroll]));
}

function buildArrClip(track, idx, clip, color) {
  const scene = song.scenes[clip.scene];
  const sel = selClip && selClip.track === track && selClip.idx === idx;
  const cl = el("div", {
    class: "arr-clip" + (sel ? " sel" : ""),
    style: `left:${clip.start * ppb}px; width:${clip.len * ppb - 2}px; --tc:${color}`,
  });
  cl.appendChild(el("div", { class: "cnm", text: scene.tag }));
  const mini = arrMini(scene, track);
  if (mini) cl.appendChild(mini);
  const rz = el("div", { class: "rz" });
  cl.appendChild(rz);
  cl.addEventListener("pointerdown", (e) => onClipDown(e, track, idx, cl, rz));
  return cl;
}

function renderArrangement() {
  ensureArrShell();
  // The grid covers the loop even when it reaches past the last clip — the
  // transport plays that empty space, so the ruler and lanes must exist there.
  const totalBars = Math.max(arrangeLength(song), song.loop ? song.loop.start + song.loop.len : 0) + 4;
  // Adaptive grid: reveal beats, then 16ths, as the bar gets wide enough to
  // read them; keep ruler numbers from crowding at the same time.
  const grid = ppb / 16 >= 7 ? "g-16" : ppb / 4 >= 13 ? "g-beats" : "g-bars";
  const content = el("div", { class: `arr-content ${grid}`, style: `width:${totalBars * ppb}px; --ppb:${ppb}px` });

  const ruler = el("div", { class: "arr-ruler" });
  const every = ppb >= 60 ? 1 : ppb >= 30 ? 2 : 4;
  for (let b = 0; b < totalBars; b++) {
    if (b % every === 0)
      ruler.appendChild(el("div", { class: "arr-tick", style: `left:${b * ppb}px`, text: String(b + 1) }));
  }
  const loop = song.loop;
  // The bottom strip of the ruler is the loop's own lane: body drags move it,
  // either edge grip resizes it, a tap toggles it, and dragging across empty
  // lane space paints a new loop right there.
  const lane = el("div", { class: "arr-looplane", onpointerdown: onLoopLaneDown });
  const brace = el("div", {
    class: "arr-loop" + (loop.on ? " on" : ""),
    style: `left:${loop.start * ppb}px; width:${loop.len * ppb}px`,
  }, [el("div", { class: "lz left" }), el("div", { class: "lz right" })]);
  lane.appendChild(brace);
  ruler.appendChild(lane);
  content.appendChild(ruler);

  ARRANGE_TRACKS.forEach((t) => {
    const meta = TRACKS.find((x) => x.key === t);
    const lane = el("div", {
      class: "arr-lane",
      "data-track": t,
      style: `--tc:${meta.color}`,
    });
    song.arrangement[t].forEach((clip, idx) => lane.appendChild(buildArrClip(t, idx, clip, meta.color)));
    // Recorded performance mutes, shaded as runs over the lane (painted after
    // the clips, so the silence reads on top of whatever it silences).
    const ml = song.mutes?.[t];
    if (ml) {
      for (let b = 0; b < totalBars; b++) {
        if (!ml[b]) continue;
        let end = b + 1;
        while (end < totalBars && ml[end]) end++;
        lane.appendChild(el("div", { class: "arr-mute", style: `left:${b * ppb}px; width:${(end - b) * ppb}px` }));
        b = end - 1;
      }
    }
    content.appendChild(lane);
  });

  // No transition: while playing, the clock pump re-derives the transform from
  // the audio clock every frame; stopped, it sits where playback left it.
  arrPlayhead = el("div", {
    class: "arr-playhead",
    style: `transform:translateX(${arrPlayBar * ppb}px)`,
  });
  content.appendChild(arrPlayhead);

  arrScroll.innerHTML = "";
  arrScroll.appendChild(content);
  arrContentEl = content;
  updateArrToolbar();
  updateTrackMixUI();
}

// Content-space bar under a client X, computed FRESH so it stays exact while
// the view auto-pans underneath the pointer.
const barFromX = (x) => Math.max(0, Math.round((x - arrContentEl.getBoundingClientRect().left) / ppb));

// Edge auto-pan for horizontal drags: hover near either edge of the
// arrangement viewport and it scrolls, faster the closer to the edge, calling
// onFrame so the drag math re-applies under the moving content.
const PAN_EDGE = 48;
function makeAutoPan(getClientX, onFrame) {
  let raf = 0;
  const tick = () => {
    raf = 0;
    if (arrPinching) return; // a pinch owns the viewport — no edge-panning under it
    const x = getClientX();
    const vw = arrScroll.getBoundingClientRect();
    let v = 0;
    if (x > vw.right - PAN_EDGE) v = Math.min(20, (x - (vw.right - PAN_EDGE)) * 0.4);
    else if (x < vw.left + PAN_EDGE) v = -Math.min(20, (vw.left + PAN_EDGE - x) * 0.4);
    if (v !== 0) {
      const before = arrScroll.scrollLeft;
      arrScroll.scrollLeft = Math.max(0, before + v);
      if (arrScroll.scrollLeft !== before) onFrame();
      raf = requestAnimationFrame(tick);
    }
  };
  return {
    poke() {
      if (!raf) raf = requestAnimationFrame(tick);
    },
    stop() {
      cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}

// A tap on the ruler moves the playhead there; a tap on empty lane space drops
// a 4-bar clip of the current scene. Both fire from attachArrGestures on a
// clean tap, so a drag pans the timeline instead of scrubbing or littering
// clips.
function arrRulerTap(clientX) {
  arrPlayBar = barFromX(clientX);
  if (audioReady) audio.setArrangePos(arrPlayBar);
  if (arrPlayhead) arrPlayhead.style.transform = `translateX(${arrPlayBar * ppb}px)`;
  selClip = null;
  updateArrToolbar();
  arrContentEl.querySelectorAll(".arr-clip.sel").forEach((n) => n.classList.remove("sel"));
}

function arrLaneTap(track, clientX) {
  pushUndo();
  const bar = barFromX(clientX);
  const sceneIdx = playingScene >= 0 ? playingScene : 0;
  song.arrangement[track].push({ scene: sceneIdx, start: bar, len: 4 });
  selClip = { track, idx: song.arrangement[track].length - 1 };
  renderArrangement();
}

async function onClipDown(e, track, idx, cl, rz) {
  e.stopPropagation();
  e.preventDefault();
  await ensureStarted();
  selClip = { track, idx };
  arrContentEl.querySelectorAll(".arr-clip.sel").forEach((n) => n.classList.remove("sel"));
  cl.classList.add("sel");
  updateArrToolbar();

  const clip = song.arrangement[track][idx];
  const resize = e.target === rz;
  const grabOffset = barFromX(e.clientX) - clip.start;
  const laneRects = resize
    ? []
    : [...arrContentEl.querySelectorAll(".arr-lane")].map((l) => ({ track: l.dataset.track, rect: l.getBoundingClientRect() }));
  const homeTop = laneRects.find((L) => L.track === track)?.rect.top ?? 0;
  let targetTrack = track;
  const pre = snapshot();
  let changed = false;
  let lastX = e.clientX;
  let lastY = e.clientY;
  capturePointer(cl, e.pointerId);
  const applyFromXY = (x, y) => {
    changed = true;
    const bar = barFromX(x);
    if (resize) {
      clip.len = Math.max(1, bar - clip.start);
      cl.style.width = clip.len * ppb - 2 + "px";
    } else {
      clip.start = Math.max(0, bar - grabOffset);
      cl.style.left = clip.start * ppb + "px";
      const hit = laneRects.find((L) => y >= L.rect.top && y < L.rect.bottom);
      targetTrack = hit ? hit.track : track;
      cl.style.transform = targetTrack !== track ? `translateY(${laneRects.find((L) => L.track === targetTrack).rect.top - homeTop}px)` : "";
      cl.style.zIndex = 8;
    }
    const tools = arrContentEl.querySelector(".arr-tools");
    if (tools) tools.style.left = clip.start * ppb + "px";
  };
  const pan = makeAutoPan(() => lastX, () => applyFromXY(lastX, lastY));
  const move = (ev) => {
    if (arrPinching) return; // second finger landed — the pinch owns this touch now
    lastX = ev.clientX;
    lastY = ev.clientY;
    applyFromXY(ev.clientX, ev.clientY);
    pan.poke();
  };
  const up = () => {
    pan.stop();
    cl.removeEventListener("pointermove", move);
    cl.removeEventListener("pointerup", up);
    if (!resize && targetTrack !== track) {
      const moved = song.arrangement[track].splice(idx, 1)[0];
      song.arrangement[targetTrack].push(moved);
      selClip = { track: targetTrack, idx: song.arrangement[targetTrack].length - 1 };
    }
    if (changed) commitUndo(pre);
    renderArrangement();
  };
  cl.addEventListener("pointermove", move);
  cl.addEventListener("pointerup", up);
}

function onLoopLaneDown(e) {
  e.stopPropagation();
  e.preventDefault();
  const lane = e.currentTarget;
  const brace = lane.querySelector(".arr-loop");
  const loop = song.loop;
  const pre = snapshot();
  const downBar = barFromX(e.clientX);
  const mode = e.target.classList.contains("left")
    ? "left"
    : e.target.classList.contains("right")
      ? "right"
      : e.target.closest(".arr-loop")
        ? "move"
        : "paint";
  const o = { start: loop.start, end: loop.start + loop.len };
  let changed = false;
  let lastX = e.clientX;
  capturePointer(lane, e.pointerId);
  const apply = () => {
    brace.style.left = loop.start * ppb + "px";
    brace.style.width = loop.len * ppb + "px";
  };
  const applyFromX = (x) => {
    const bar = barFromX(x);
    if (mode === "move") {
      const next = Math.max(0, o.start + (bar - downBar));
      if (next !== loop.start) {
        loop.start = next;
        changed = true;
      }
    } else if (mode === "right") {
      const len = Math.max(1, bar - o.start);
      if (len !== loop.len) {
        loop.len = len;
        changed = true;
      }
    } else if (mode === "left") {
      const start = Math.max(0, Math.min(bar, o.end - 1));
      if (start !== loop.start) {
        loop.start = start;
        loop.len = o.end - start;
        changed = true;
      }
    } else if (bar !== downBar) {
      loop.start = Math.min(downBar, bar);
      loop.len = Math.max(1, Math.abs(bar - downBar));
      loop.on = true;
      brace.classList.add("on");
      changed = true;
    }
    apply();
  };
  const pan = makeAutoPan(() => lastX, () => applyFromX(lastX));
  const move = (ev) => {
    if (arrPinching) return; // second finger landed — the pinch owns this touch now
    lastX = ev.clientX;
    applyFromX(ev.clientX);
    pan.poke();
  };
  const up = () => {
    pan.stop();
    lane.removeEventListener("pointermove", move);
    lane.removeEventListener("pointerup", up);
    lane.removeEventListener("pointercancel", up);
    if (!changed) {
      if (mode === "paint") {
        // Tap on empty lane: bring the loop here, keep its length and state.
        if (downBar !== loop.start) {
          loop.start = downBar;
          changed = true;
        }
      } else {
        loop.on = !loop.on;
        changed = true;
      }
    }
    if (changed) commitUndo(pre);
    renderArrangement();
  };
  lane.addEventListener("pointermove", move);
  lane.addEventListener("pointerup", up);
  lane.addEventListener("pointercancel", up);
}

function updateArrToolbar() {
  const old = arrContentEl?.querySelector(".arr-tools");
  if (old) old.remove();
  if (!selClip || !arrContentEl) return;
  const clip = song.arrangement[selClip.track][selClip.idx];
  if (!clip) {
    selClip = null;
    return;
  }
  const vw = arrScroll.clientWidth || 360;
  const toolLeft = Math.max(
    arrScroll.scrollLeft + 4,
    Math.min(clip.start * ppb, arrScroll.scrollLeft + vw - 150)
  );
  const tools = el("div", { class: "arr-tools", style: `left:${toolLeft}px` }, [
    el("div", {
      text: "Split",
      onpointerdown: (e) => {
        e.stopPropagation();
        const c = song.arrangement[selClip.track][selClip.idx];
        if (arrPlayBar > c.start && arrPlayBar < c.start + c.len) {
          pushUndo();
          song.arrangement[selClip.track].push({ scene: c.scene, start: arrPlayBar, len: c.start + c.len - arrPlayBar });
          c.len = arrPlayBar - c.start;
          renderArrangement();
        }
      },
    }),
    el("div", {
      text: "Dup",
      onpointerdown: (e) => {
        e.stopPropagation();
        pushUndo();
        const c = song.arrangement[selClip.track][selClip.idx];
        song.arrangement[selClip.track].push({ scene: c.scene, start: c.start + c.len, len: c.len });
        selClip = { track: selClip.track, idx: song.arrangement[selClip.track].length - 1 };
        renderArrangement();
      },
    }),
    el("div", {
      text: "Del",
      onpointerdown: (e) => {
        e.stopPropagation();
        pushUndo();
        song.arrangement[selClip.track].splice(selClip.idx, 1);
        selClip = null;
        renderArrangement();
      },
    }),
  ]);
  arrContentEl.appendChild(tools);
}

// Arrangement gestures. One finger taps to drop a clip / move the playhead and
// drags to pan the timeline; two fingers pinch-zoom, anchored so the bar under
// your fingers stays put instead of drifting. Clips and the loop grip claim
// their own pointers (stopPropagation), so grabbing one never drops a clip.
//
// Panning is the browser's own inertial scroll (touch-action: pan-x) — the
// flick-with-momentum feel of a real timeline, which a manual scrollLeft can't
// match. We intercept ONLY the two-finger pinch, over Touch events with
// preventDefault so native scroll doesn't fight it, and scale the existing DOM
// with a transform that commits real layout once on release (no per-frame
// rebuild to stutter a cheap phone). Taps are read over pointer events: a drag
// scrolls natively and fires pointercancel, so only a clean tap dispatches.
const ARR_MIN_PPB = 22;
const ARR_MAX_PPB = 220;
const ARR_TAP_SLOP = 8;
function attachArrGestures(scroll) {
  const leftOf = () => scroll.getBoundingClientRect().left;
  let startDist = 0, startPpb = 0, focalPx = 0, startScroll = 0, lastScale = 1, lastMid = 0, pinching = false;
  let tapId = -1, tapX = 0, tapY = 0, tapTarget = null, tapMoved = false;
  const clearTap = () => { tapId = -1; tapTarget = null; };

  // A canceled or orphaned pinch must never commit: snap the transform away
  // and keep the old ppb. Committing a stale scale later (e.g. from the
  // touchcancel a native-scroll takeover fires) teleports the view.
  const abandonPinch = () => {
    pinching = false; arrPinching = false;
    if (arrContentEl) arrContentEl.style.transform = "";
  };

  scroll.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2) {
      pinching = true; arrPinching = true;
      clearTap(); // the first finger's tap candidate is void — this is a pinch
      const [a, b] = e.touches;
      startDist = Math.max(1, Math.abs(a.clientX - b.clientX));
      startPpb = ppb;
      startScroll = scroll.scrollLeft;
      focalPx = startScroll + ((a.clientX + b.clientX) / 2 - leftOf()); // content px under the pinch center
      lastScale = 1;
    } else if (pinching) {
      abandonPinch(); // a new touch arrived but the pair is gone — stale pinch
    }
  }, { passive: true });

  scroll.addEventListener("touchmove", (e) => {
    if (e.touches.length === 2) {
      e.preventDefault(); // hold off native scroll for the duration of the pinch
      const [a, b] = e.touches;
      const dist = Math.max(1, Math.abs(a.clientX - b.clientX));
      const scale = Math.max(ARR_MIN_PPB, Math.min(ARR_MAX_PPB, startPpb * (dist / startDist))) / startPpb;
      const mid = (a.clientX + b.clientX) / 2 - leftOf();
      arrContentEl.style.transformOrigin = "0 0";
      arrContentEl.style.transform = `translateX(${mid - focalPx * scale + startScroll}px) scaleX(${scale})`; // focal bar stays put
      lastScale = scale; lastMid = mid;
    }
  }, { passive: false });

  const endPinch = (e) => {
    if (!pinching || e.touches.length >= 2) return;
    pinching = false; arrPinching = false;
    // A two-finger tap that never spread isn't a zoom — don't burn a full
    // rebuild on it, just drop any sub-percent transform.
    if (Math.abs(lastScale - 1) < 0.02) {
      arrContentEl.style.transform = "";
      return;
    }
    ppb = Math.max(ARR_MIN_PPB, Math.min(ARR_MAX_PPB, startPpb * lastScale));
    renderArrangement(); // real layout at the new ppb; the transform dies with the old content
    const max = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
    scroll.scrollLeft = Math.max(0, Math.min(max, focalPx * lastScale - lastMid));
  };
  scroll.addEventListener("touchend", endPinch);
  // Deliberate release commits; a system-canceled gesture reverts.
  scroll.addEventListener("touchcancel", () => { if (pinching) abandonPinch(); });

  // Tap to drop a clip / move the playhead, without stealing the scroll: track
  // one pointer, and only act if it neither moved past the slop nor pinched.
  scroll.addEventListener("pointerdown", (e) => {
    if (pinching) return;
    tapId = e.pointerId; tapX = e.clientX; tapY = e.clientY; tapMoved = false;
    tapTarget = e.target.closest(".arr-ruler") ? { kind: "ruler" }
      : e.target.closest(".arr-lane") ? { kind: "lane", track: e.target.closest(".arr-lane").dataset.track }
      : null;
  });
  scroll.addEventListener("pointermove", (e) => {
    if (e.pointerId === tapId && Math.hypot(e.clientX - tapX, e.clientY - tapY) > ARR_TAP_SLOP) tapMoved = true;
  });
  scroll.addEventListener("pointerup", (e) => {
    if (e.pointerId === tapId && !tapMoved && !pinching && tapTarget) {
      if (tapTarget.kind === "ruler") arrRulerTap(tapX);
      else arrLaneTap(tapTarget.track, tapX);
    }
    clearTap();
  });
  scroll.addEventListener("pointercancel", clearTap);

  // A scroll we didn't cause — a manual flick or its momentum — briefly holds
  // off follow so it doesn't yank the view back off what you're reading.
  scroll.addEventListener("scroll", () => {
    if (Math.abs(scroll.scrollLeft - arrLastFollowLeft) > 2) arrFollowResumeAt = Date.now() + 1200;
  });
}

// ---------------------------------------------------------------------------
// Project + WAV Export
// ---------------------------------------------------------------------------
function encodeWav(buffer) {
  const numCh = buffer.numberOfChannels;
  const sr = buffer.sampleRate;
  const len = buffer.length;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numCh * bytesPerSample;
  const dataSize = len * blockAlign;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, "RIFF"); view.setUint32(4, 36 + dataSize, true); writeStr(8, "WAVE");
  writeStr(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true); view.setUint32(24, sr, true);
  view.setUint32(28, sr * blockAlign, true); view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true); writeStr(36, "data"); view.setUint32(40, dataSize, true);
  const channels = [];
  for (let c = 0; c < numCh; c++) channels.push(buffer.getChannelData(c));
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      off += 2;
    }
  }
  return new Blob([buf], { type: "audio/wav" });
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function projectDevices() {
  return {
    drums: { kit: audio.kit(), patch: audio.patch("drums") },
    harmony: { preset: audio.harmonyPreset(), patch: audio.patch("harmony") },
    bass: { preset: audio.bassPreset(), patch: audio.patch("bass") },
    melody: { preset: audio.melodyPreset(), patch: audio.patch("melody") },
  };
}

// The master bus is app character, not project state (D22, and the
// builder's "no backward-compatibility needed"): every song, fresh or
// loaded, plays through the same compiled master. The panel still moves
// it live; it just doesn't travel in files.
function projectMix() {
  return Object.fromEntries(TRACKS.map((t) => [t.key, structuredClone(mixState[t.key])]));
}

function captureProject() {
  return {
    schema: PROJECT_SCHEMA,
    version: PROJECT_VERSION,
    savedAt: new Date().toISOString(),
    song: snapshot(),
    mix: projectMix(),
    devices: projectDevices(),
  };
}

function downloadProject() {
  const json = JSON.stringify(captureProject(), null, 2);
  downloadBlob(new Blob([json], { type: "application/json" }), "noodles-project.noodles");
}

function restoreDevices(devices = {}) {
  // Names are corners; full patch specs win when present. Early v2 drum
  // patches had no x/y — keep the kit corner instead of defaulting to 0,0.
  if (KIT_NAMES.includes(devices.drums?.kit)) audio.setKit(devices.drums.kit);
  const legacy = { harmony: HARMONY_PRESET_NAMES, bass: BASS_PRESET_NAMES, melody: MELODY_PRESET_NAMES };
  for (const t of ["harmony", "bass", "melody", "drums"]) {
    const d = devices[t] || {};
    if (d.patch && typeof d.patch === "object") {
      const patch = { ...d.patch };
      if (!("x" in patch)) {
        const cur = audio.patch(t);
        patch.x = cur.x;
        patch.y = cur.y;
      }
      audio.setPatch(t, patch);
    } else if (t !== "drums" && legacy[t].includes(d.preset)) {
      if (t === "harmony") audio.setHarmonyPreset(d.preset);
      else if (t === "bass") audio.setBassPreset(d.preset);
      else audio.setMelodyPreset(d.preset);
    }
  }
}

function restoreMix(mix = {}) {
  for (const t of TRACKS) {
    const key = t.key;
    const defaults = MIX_DEFAULTS[key];
    const src = mix[key] || {};
    const parsed = {
      vol: Number.isFinite(Number(src.vol)) ? Number(src.vol) : defaults.vol,
      pan: Number.isFinite(Number(src.pan)) ? Number(src.pan) : defaults.pan,
      verb: Number.isFinite(Number(src.verb)) ? Number(src.verb) : Number.isFinite(Number(src.send)) ? Number(src.send) : defaults.verb,
      echo: Number.isFinite(Number(src.echo)) ? Number(src.echo) : defaults.echo,
      mute: !!src.mute,
      solo: !!src.solo,
    };
    Object.assign(mixState[key], parsed);
  }
  // The master never rides a file (D22): a load resets it to the compiled
  // defaults, whatever the file or this session had dialed in.
  audio.setMaster({ ...MASTER_DEFAULTS });
  applyMixState();
}

function applyProject(rawProject) {
  const project = rawProject?.schema === PROJECT_SCHEMA ? rawProject : { song: rawProject };
  const nextSong = structuredClone(project.song);
  if (!nextSong || !Array.isArray(nextSong.scenes) || !nextSong.scenes.length) {
    throw new Error("Not a valid Noodles project.");
  }
  nextSong.scenes.forEach(normalizeScene);
  if (!nextSong.arrangement) nextSong.arrangement = {};
  for (const t of TRACKS) if (!Array.isArray(nextSong.arrangement[t.key])) nextSong.arrangement[t.key] = [];
  if (!nextSong.loop) nextSong.loop = { on: false, start: 0, len: 4 };
  if (!nextSong.trackSwing || typeof nextSong.trackSwing !== "object") nextSong.trackSwing = {};
  if (!nextSong.mutes || typeof nextSong.mutes !== "object") nextSong.mutes = {};
  for (const t of TRACKS) if (nextSong.mutes[t.key] && !Array.isArray(nextSong.mutes[t.key])) nextSong.mutes[t.key] = [];
  if (!Number.isFinite(Number(nextSong.tempo))) nextSong.tempo = 92;
  if (!Number.isFinite(Number(nextSong.key))) nextSong.key = 0;
  if (!nextSong.scale) nextSong.scale = "major";

  pushUndo();
  for (const key of Object.keys(song)) delete song[key];
  Object.assign(song, nextSong);
  restoreMix(project.mix);
  restoreDevices(project.devices);
  selClip = null;
  arrPlayBar = 0;
  playingScene = -1;
  for (const t of TRACKS) playingTracks[t.key] = -1;
  refreshAll();
  // A dare rides the file: someone's words, shown once per load, never
  // enforced — the constraint is social, the app just remembers it.
  if (typeof song.dare === "string" && song.dare.trim()) showDareBanner(song.dare.trim().slice(0, 200));
}

// The dare banner: her words over your session, dismissible, nothing graded.
function showDareBanner(text) {
  document.querySelector(".dare-banner")?.remove();
  const card = el("div", { class: "dare-banner" }, [
    el("span", { class: "dare-text", text }),
    el("div", { class: "dare-x", text: "✕", onclick: () => card.remove() }),
  ]);
  document.getElementById("app").appendChild(card);
}

async function loadProjectFile(file, status) {
  if (!file) return;
  try {
    applyProject(JSON.parse(await file.text()));
    status.textContent = "Project loaded";
  } catch (e) {
    status.textContent = "Load failed: " + e.message;
  }
}

function saveLocalProject(status) {
  try {
    const had = !!localStorage.getItem(LOCAL_PROJECT_KEY);
    localStorage.setItem(LOCAL_PROJECT_KEY, JSON.stringify(captureProject()));
    status.textContent = had ? "Kept on this device (replaced the previous one)" : "Kept on this device";
  } catch (e) {
    status.textContent = "Save failed: " + e.message;
  }
}

function loadLocalProject(status) {
  try {
    const raw = localStorage.getItem(LOCAL_PROJECT_KEY);
    if (!raw) {
      status.textContent = "Nothing kept on this device yet";
      return;
    }
    applyProject(JSON.parse(raw));
    status.textContent = "Loaded from this device";
  } catch (e) {
    status.textContent = "Load failed: " + e.message;
  }
}

// A render outlives the sheet: results and status live at module level, and
// openExport re-binds them to whatever sheet is currently on screen. Closing
// the sheet mid-render loses nothing \u2014 reopen and the finished files are there.
let exporting = false;
let exportOffers = []; // { url, blob, name, label }
let expStatusEl = null;
let expLinksEl = null;

function setExportStatus(text) {
  if (expStatusEl?.isConnected) expStatusEl.textContent = text;
}

function clearExportOffers() {
  for (const o of exportOffers) {
    clearTimeout(o.ttl);
    URL.revokeObjectURL(o.url); // don't leak old WAV blobs
  }
  exportOffers = [];
  renderExportOffers();
}

// A WAV render runs for several seconds; on a phone that outlives the tap's
// transient activation, so a script-triggered download after the await is
// silently blocked \u2014 the status said "exported" but no file ever landed.
// Hand the finished file back as a button the user taps: a fresh gesture
// that downloads, or opens the native share sheet, reliably.
function renderExportOffers() {
  if (!expLinksEl?.isConnected) return;
  expLinksEl.innerHTML = "";
  for (const o of exportOffers) {
    const a = el("a", { class: "exp-btn save", href: o.url, download: o.name, text: `\u2913  ${o.label}` });
    a.addEventListener("click", async (e) => {
      try {
        const file = new File([o.blob], o.name, { type: o.name.endsWith(".png") ? "image/png" : "audio/wav" });
        if (navigator.canShare?.({ files: [file] })) {
          e.preventDefault();
          await navigator.share({ files: [file], title: o.name });
        }
      } catch { /* share dismissed or unsupported \u2014 the download attribute stands in */ }
    });
    expLinksEl.appendChild(a);
  }
}

function offerSave(blob, name, label) {
  const offer = { url: URL.createObjectURL(blob), blob, name, label };
  // A rendered WAV is tens of MB, and the object URL pins it in memory until
  // revoked - which used to be "whenever the NEXT export starts", i.e. maybe
  // never. Offers expire after 15 minutes instead: long enough to save or
  // share, never a session-long hold on a phone's heap.
  offer.ttl = setTimeout(() => {
    URL.revokeObjectURL(offer.url);
    const i = exportOffers.indexOf(offer);
    if (i >= 0) exportOffers.splice(i, 1);
    renderExportOffers();
  }, 15 * 60 * 1000);
  exportOffers.push(offer);
  renderExportOffers();
  // Offers land at the bottom of a sheet that now scrolls — walk each fresh
  // render into view so "ready" never points at something off-screen.
  if (expLinksEl?.isConnected) expLinksEl.lastElementChild?.scrollIntoView({ block: "nearest" });
}

async function doExport(mode) {
  if (exporting) return;
  exporting = true;
  clearExportOffers();
  setExportStatus(mode === "loop" ? "Rendering loop\u2026" : mode === "master" ? "Rendering master\u2026" : "Rendering stems\u2026");
  try {
    // Files carry their key (Eb-dorian, F#-major): the later-improvement
    // pass in another tool starts with the one fact it always needs.
    const keySlug = `${keyDisplayName(song.key, song.scale).replace("\u266f", "#").replace("\u266d", "b")}-${song.scale}`;
    if (mode === "loop") {
      const buf = await audio.renderOffline(null, { loop: { start: song.loop.start, len: song.loop.len } });
      offerSave(encodeWav(buf), `noodles-${keySlug}-loop.wav`, `Save loop \u00b7 ${song.loop.len} ${song.loop.len === 1 ? "bar" : "bars"}`);
      setExportStatus("Seamless loop ready \u2014 tap to save:");
    } else if (mode === "master") {
      const buf = await audio.renderOffline(null);
      offerSave(encodeWav(buf), `noodles-${keySlug}.wav`, "Save master WAV");
      setExportStatus("Master ready \u2014 tap to save:");
    } else {
      for (const t of TRACKS) {
        setExportStatus(`Rendering ${t.name}\u2026`);
        const buf = await audio.renderOffline(t.key);
        offerSave(encodeWav(buf), `noodles-${keySlug}-${t.key}.wav`, `Save ${t.name} stem`);
      }
      setExportStatus("Stems ready \u2014 tap to save:");
    }
  } catch (e) {
    setExportStatus("Export failed: " + e.message);
  }
  exporting = false;
}

// The round-trip principle, on paper: the same painter the harmony editor
// reads from engraves the playing line into a PNG you can set on a music
// stand — or send to the lady teaching you 9th chords. v1 is one scene's
// harmony line: the first scene that has one.
function exportStaffPng() {
  const si = song.scenes.findIndex((sc) => sc.harmony?.length);
  if (si < 0) {
    setExportStatus("Nothing to engrave yet — write a chord line first.");
    return;
  }
  const sc = song.scenes[si];
  const keySlug = `${keyDisplayName(song.key, song.scale).replace("♯", "#").replace("♭", "b")}-${song.scale}`;
  const w = 1400;
  const h = 360;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext("2d");
  paintChordStaff(c, {
    w,
    h,
    S: 16,
    key: song.key,
    scale: song.scale,
    harmony: sc.harmony,
    harmonyOct: sc.harmonyOct || 0,
    bg: "#0e0e0f",
    title: `${keyDisplayName(song.key, song.scale)} ${song.scale} · ${song.tempo} BPM · scene ${si + 1} · noodles`,
  });
  canvas.toBlob((blob) => {
    if (!blob) {
      setExportStatus("Engraving failed.");
      return;
    }
    offerSave(blob, `noodles-${keySlug}-staff.png`, "Save staff PNG");
    setExportStatus("Engraving ready — tap to save:");
  }, "image/png");
}

function openExport() {
  resetSheet("#e8b84b");
  const status = el("div", { class: "exp-status", text: exporting ? "Rendering\u2026" : "" });
  const links = el("div", { class: "exp-links" });
  expStatusEl = status;
  expLinksEl = links;
  const fileInput = el("input", { class: "project-file", type: "file", accept: ".noodles,application/json" });
  fileInput.addEventListener("change", () => loadProjectFile(fileInput.files?.[0], status));

  sheet.appendChild(sheetBar("Export", "project · WAV"));
  // Four stem offers plus both sections outgrow the sheet's 78% cap on a
  // phone — the body scrolls like the editors do, or the offers are cut off.
  const body = el("div", { class: "editor-scroll" });
  body.appendChild(
    el("div", { class: "propsection" }, [
      el("div", { class: "proplabel", text: "project" }),
      el("div", { class: "exp-grid" }, [
        el("div", { class: "exp-btn", text: "Download Project", "data-action": "download-project", onclick: downloadProject }),
        el("div", { class: "exp-btn", text: "Load Project", "data-action": "load-project", onclick: () => fileInput.click() }),
        el("div", { class: "exp-btn", text: "Keep on device", "data-action": "save-local-project", onclick: () => saveLocalProject(status) }),
        el("div", { class: "exp-btn", text: "Load from device", "data-action": "load-local-project", onclick: () => loadLocalProject(status) }),
      ]),
      fileInput,
      // The dare: write a line, save the project, hand it over. Homework that
      // feels like a game of HORSE — the words travel with the file and greet
      // whoever loads it. The app never checks; that's the teacher's job.
      el("div", { class: "dare-row" }, [
        el("input", {
          class: "dare-input",
          type: "text",
          maxlength: "200",
          placeholder: song.dare ? song.dare : "write a dare… (“stay in E♭, one step per voice”)",
          "data-action": "dare-input",
        }),
        el("div", {
          class: "exp-btn",
          text: "Save Dare",
          "data-action": "save-dare",
          onclick: (e) => {
            const input = e.target.parentElement.querySelector(".dare-input");
            const text = input.value.trim() || song.dare || "";
            if (!text) {
              input.focus();
              return;
            }
            pushUndo();
            song.dare = text.slice(0, 200);
            const json = JSON.stringify(captureProject(), null, 2);
            downloadBlob(new Blob([json], { type: "application/json" }), "noodles-dare.noodles");
            status.textContent = "Dare saved — send it to someone.";
          },
        }),
      ]),
    ])
  );
  // Loop-first: when a loop is set on the arrangement, it IS the backing track
  // \u2014 the primary thing you render. The full song and stems sit below it.
  const audioSection = [el("div", { class: "proplabel", text: "audio" })];
  if (song.loop?.on && song.loop.len >= 1) {
    audioSection.push(el("div", {
      class: "exp-btn loop-primary",
      text: `\uD83D\uDD01  Export loop \u00B7 ${song.loop.len} ${song.loop.len === 1 ? "bar" : "bars"}`,
      "data-action": "export-loop",
      onclick: () => doExport("loop"),
    }));
  }
  audioSection.push(el("div", { class: "exp-grid" }, [
    el("div", { class: "exp-btn", text: "\uD83C\uDFB5  Master WAV", "data-action": "export-master-wav", onclick: () => doExport("master") }),
    el("div", { class: "exp-btn", text: "\uD83C\uDFDA  Stems (4\u00d7)", "data-action": "export-stems", onclick: () => doExport("stems") }),
    el("div", { class: "exp-btn", text: "\uD83C\uDFBC  Staff PNG", "data-action": "export-staff", onclick: exportStaffPng }),
  ]));
  body.appendChild(el("div", { class: "propsection" }, audioSection));
  body.appendChild(status);
  body.appendChild(links);
  sheet.appendChild(body);
  renderExportOffers(); // finished renders from an earlier open are still here
  openSheet();
}

// ---------------------------------------------------------------------------
// Playback → UI sync
// ---------------------------------------------------------------------------
if ("serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // No controller at load = the worker's first install, same code as this
    // page — nothing to swap.
    if (!hadController) return;
    if (userTouched) swUpdateReady = true;
    else location.reload();
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, {
        scope: import.meta.env.BASE_URL,
        updateViaCache: "none", // always ask the network; Pages caches sw.js for 600 s
      })
      .then((reg) => {
        // An installed app can sit open for days, and the browser only checks
        // on navigation. Check when it comes back to the foreground too.
        let lastCheck = Date.now();
        document.addEventListener("visibilitychange", () => {
          if (document.hidden || Date.now() - lastCheck < 15 * 60 * 1000) return;
          lastCheck = Date.now();
          reg.update().catch(() => {});
        });
      })
      .catch(() => {});
  });
}

// Install: Chrome fires beforeinstallprompt when the app qualifies (manifest +
// service worker + not already installed). Stash it — never act on it. The
// browser's own menu is one path; the ? page offers the other, on a tap, like
// every other thing this app knows how to do.
let installPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
});
window.addEventListener("appinstalled", () => {
  installPrompt = null;
});

// Pull-only perf receipts: a bottom-edge overlay with frame and audio-clock
// health, toggled from the ? page (or forced with ?perf in the URL). The A16
// gate needs numbers from the couch, not adjectives — pure diagnostics,
// invisible unless asked for. The toggle persists so it survives reloads
// mid-investigation.
const PERF_HUD_KEY = "noodles:perf-hud";
let perfHudEl = null;
let perfHudRAF = 0;
function perfHudOn() {
  return !!perfHudEl;
}
function stopPerfHud() {
  cancelAnimationFrame(perfHudRAF);
  perfHudRAF = 0;
  perfHudEl?.remove();
  perfHudEl = null;
}
function startPerfHud() {
  if (perfHudEl) return;
  perfHudEl = el("div", { id: "perf-hud", text: "perf…" });
  document.body.appendChild(perfHudEl);
  let frames = 0;
  let jank = 0;
  let worst = 0;
  let last = performance.now();
  let winStart = last;
  let audioLast = 0;
  const tick = (now) => {
    const gap = now - last;
    last = now;
    frames += 1;
    if (gap > 50) jank += 1;
    if (gap > worst) worst = gap;
    if (now - winStart >= 1000) {
      const raw = window.__noodlesTone?.getContext()?.rawContext;
      const dt = (now - winStart) / 1000;
      // Audio clock vs wall clock: a running context below 1.00× is the
      // audio thread starving (underruns) — the stutter, quantified.
      const aud = raw ? (raw.currentTime - audioLast) / dt : 0;
      if (raw) audioLast = raw.currentTime;
      // bl = the context's own buffer, ol = what the OS admits to past it.
      // ol reading 0 means the device won't say — the real chain is bigger
      // than anything shown here, and the ? sync nudge is the ear's fix.
      const bl = raw ? Math.round((raw.baseLatency || 0) * 1000) : 0;
      const ol = raw ? Math.round((raw.outputLatency || 0) * 1000) : 0;
      perfHudEl.textContent = `${Math.round(frames / dt)}fps jank${jank} worst${Math.round(worst)}ms · aud×${aud.toFixed(2)} bl${bl} ol${ol} ${raw?.state ?? "?"}`;
      frames = 0;
      jank = 0;
      worst = 0;
      winStart = now;
    }
    perfHudRAF = requestAnimationFrame(tick);
  };
  perfHudRAF = requestAnimationFrame(tick);
}
if (new URLSearchParams(location.search).has("perf") || localStorage.getItem(PERF_HUD_KEY) === "1") startPerfHud();

audio.onVisual((e) => {
  if (e.type === "arr") {
    const frac = e.bar + e.stepInBar / 16;
    arrPlayBar = e.bar;
    if (e.anchor) {
      arrAnchor = e.anchor; // the clock pump owns the playhead transform
      pieAnchors = {}; // and arrangement mode owns it — drop stale scene pies
      if (!clockPumpRAF) clockPumpRAF = requestAnimationFrame(clockPump);
    }
    // Follow the playhead by paging, but yield during a pinch and for a moment
    // after a manual scroll, so a look-ahead isn't yanked back under you.
    if (arrScroll && !arrPinching && Date.now() > arrFollowResumeAt) {
      const x = frac * ppb;
      const left = arrScroll.scrollLeft;
      if (x < left + 24 || x > left + arrScroll.clientWidth - 48) {
        arrLastFollowLeft = Math.max(0, x - arrScroll.clientWidth * 0.3);
        arrScroll.scrollLeft = arrLastFollowLeft;
      }
    }
    return;
  }
  if (e.activeScenes) setActiveTracks(e.activeScenes);
  else if (e.scene !== undefined && e.scene !== playingScene) setPlaying(e.scene);
  // Always sync queued state from audio engine
  if (e.queuedTracks !== undefined) applyQueued(e.queuedTracks, e.queueEpoch);

  // The song walks the wheel: playback chords feed the circle's trail, and
  // the heard bar is where an armed tap lands.
  if (e.type === "chord" || e.type === "arrchord") {
    circleBar = e.bar;
    circleView.onPlaybackChord(e.chord);
    editorCircle?.onPlaybackChord(e.chord);
  }

  if (e.type === "step") {
    if (sessionRecord && audio.playing && e.stepInBar === 0 && view === "session") {
      for (const track of ARRANGE_TRACKS) {
        const sceneIdx = e.activeScenes[track];
        const trackArr = song.arrangement[track];

        // The mute performance is part of the take: write this bar's effective
        // audibility (mute OR un-soloed) into the track's mute lane, quantized
        // to the bar like scene launches. Re-recording a section overwrites it.
        ((song.mutes ||= {})[track] ||= [])[arrPlayBar] = trackMutedByState(track) ? 1 : 0;

        // Truncate or remove existing clips that overlap the current arrPlayBar
        for (let i = trackArr.length - 1; i >= 0; i--) {
          const c = trackArr[i];
          if (arrPlayBar >= c.start && arrPlayBar < c.start + c.len) {
            if (arrPlayBar === c.start) {
              c.start += 1;
              c.len -= 1;
              if (c.len <= 0) trackArr.splice(i, 1);
            } else {
              c.len = arrPlayBar - c.start;
            }
          }
        }

        if (sceneIdx !== undefined && sceneIdx >= 0) {
          let extended = false;
          for (const c of trackArr) {
            if (c.scene === sceneIdx && c.start + c.len === arrPlayBar) {
              c.len += 1;
              extended = true;
              break;
            }
          }
          if (!extended) {
            trackArr.push({ scene: sceneIdx, start: arrPlayBar, len: 1 });
          }
        }
      }
      arrPlayBar++;
    }

    if (e.anchors) {
      pieAnchors = e.anchors;
      arrAnchor = null; // scene mode owns the pump; don't crawl a stale playhead
      if (!clockPumpRAF) clockPumpRAF = requestAnimationFrame(clockPump);
    }

    // The queued pulse blinks ON the grid: this event is pinned to the heard
    // beat (scheduleVisual), so toggling here puts the blink at the quarter-
    // note boundary instead of a free-running CSS animation that restarts
    // wherever a repaint catches it. Gated on something actually being queued:
    // a class flip on #session invalidates the whole grid's styles, and the
    // ungated form paid that twice a beat for every minute of plain playback.
    sessionEl.classList.toggle("qblink", e.stepInBar % 4 < 2 && TRACKS.some((t) => queuedSceneTracks[t.key] >= 0));

    editor?.moveCursor?.(e.stepInBar);
  }
});

applyVibeMix(song.vibe); // the cold open's roll includes its space
renderTransport();
renderSession();

document.addEventListener("visibilitychange", () => {
  if (document.hidden && audio.playing) {
    audio.stop();
    updatePlayBtn(false);
  }
});

document.addEventListener("keydown", (e) => {
  if (e.code !== "Space" || e.repeat) return;
  const tag = e.target?.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || e.target?.isContentEditable) return;
  e.preventDefault();
  togglePlayback();
});

// Debug/measurement handle for the headless harnesses (smoke, calibrate).
// Not a public API — the scripts drive the same audio engine the UI does.
window.__noodles = { song, audio, applyProject };
