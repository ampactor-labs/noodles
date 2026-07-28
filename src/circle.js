// The circle of fifths as a playable surface — a projection of the song
// model, never a second copy of it. Every harmonic truth on screen comes from
// model.js (CHORDS, the station arithmetic, the signature math); this file
// only decides where things sit and what a finger means.
//
// The load-bearing geometry: lay majors on the outer ring, relative minors
// inside, and the seven diatonic chords of ANY key form a contiguous patch —
// IV I V outside, ii vi iii beneath them, vii° on the boundary. That patch is
// the sector. The wheel never rotates; stations are muscle memory (D is
// always two steps clockwise, always 2♯). Changing key slides the bright
// region around a fixed world, so modulation reads as travel.
//
// Gesture map:
//   tap a wedge        sound its chord (voice-led from wherever you were)
//   hold a wedge       extension bloom (7 · 9 · sus4 · sus2) + the name card
//   drag across wedges strum
//   drag the rim       carry the home sector around the wheel; the sharps
//                      light up in the order they arrive; release to travel
//   thin seam wedge    the diminished chord, living on the sector's edge
//
// Rendering: one static layer (wheel, labels, sector, rim) redrawn only on
// key/scale change or resize, composited each animated frame with the trail,
// pulses, bloom, and drag ghosts. rAF runs only while the sheet is open AND
// something is actually moving; an idle open circle costs zero.

import {
  CHORDS,
  chordColor,
  harmonyChord,
  stationOfPc,
  pcOfStation,
  relMajorPc,
  relMajorOffset,
  keyDisplayName,
  romanFromHome,
  degreeStepSemis,
  sharedPcCount,
  STATION_MAJOR,
  STATION_MINOR,
  SHARP_ORDER,
  FLAT_ORDER,
} from "./model.js";

const TAU = Math.PI * 2;
const STEP = TAU / 12;
const ANG0 = -Math.PI / 2; // C at twelve o'clock
// Radial bands as fractions of the wheel radius.
const R_HOLE = 0.3;
const R_MID = 0.56; // inner/outer ring boundary
const R_OUT = 0.83; // outer ring / rim boundary
const R_RIM = 0.98;
const SEAM_HALF = 0.062; // the vii° sliver's angular half-width
const HOLD_MS = 300;
const TRAIL_MAX = 8;
const TRAIL_FADE = 6.5; // seconds a trail entry lives
const PULSE_S = 0.5;
const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";

const norm12 = (v) => ((v % 12) + 12) % 12;
const hex = (n) => "#" + (n >>> 0).toString(16).padStart(6, "0");
const angleOf = (station) => ANG0 + station * STEP;
const sigLabel = (station) => (station === 0 ? "" : station <= 6 ? `${station}♯` : `${12 - station}♭`);

// Triad quality straight from the interval structure — the model's pcs are
// the truth, the name string never gets parsed.
function quality(pcs) {
  const t = norm12(pcs[1] - pcs[0]);
  const f = norm12(pcs[2] - pcs[0]);
  return t === 3 && f === 6 ? "dim" : t === 3 ? "min" : "maj";
}

export function createCircleView({ song, audio, ensureStarted, commitKeyScale, captureChord, getHarmonyOct, buzz }) {
  const wrap = document.createElement("div");
  wrap.className = "circle-wrap";
  const canvas = document.createElement("canvas");
  canvas.className = "circle-canvas";
  wrap.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  const staticLayer = document.createElement("canvas");
  const sctx = staticLayer.getContext("2d");

  let open = false;
  let size = 0; // CSS px, square
  let dpr = 1;
  let raf = 0;

  // --- Current-key derivations, recomputed on refreshStatic ---
  let H = 0; // home sector's center station (the relative major's station)
  let wedges = []; // per (ring,station): resolved chord + color, incl. the seam
  let dimDeg = 6;

  const homePc = () => norm12(song.key);
  const homeName = () => keyDisplayName(song.key, song.scale);
  const seamAngle = () => angleOf(H + 1.5); // the sector's dominant edge

  // Resolve what a wedge IS under the current key + scale: a diatonic degree
  // when the model has one there, a borrowed triad otherwise. The six
  // in-sector wedges plus the seam cover all seven degrees — proven for every
  // mode/key pair in .tmp/dbg-circle-theory.mjs.
  function wedgeChord(ring, station) {
    if (ring === "seam") {
      return { ring, station: -1, degree: dimDeg, pcs: CHORDS[dimDeg].pcs, q: "dim", root: CHORDS[dimDeg].pcs[0] };
    }
    const root = ring === "outer" ? pcOfStation(station) : norm12(pcOfStation(station) + 9);
    const want = ring === "outer" ? "maj" : "min";
    const d = CHORDS.findIndex((c) => c.pcs[0] === root && quality(c.pcs) === want);
    if (d >= 0) return { ring, station, degree: d, pcs: CHORDS[d].pcs, q: want, root };
    const pcs = want === "maj" ? [root, norm12(root + 4), norm12(root + 7)] : [root, norm12(root + 3), norm12(root + 7)];
    return { ring, station, degree: -1, pcs, q: want, root };
  }

  function rebuildWedges() {
    H = stationOfPc(relMajorPc(song.key, song.scale));
    dimDeg = Math.max(0, CHORDS.findIndex((c) => quality(c.pcs) === "dim"));
    wedges = { outer: [], inner: [] };
    for (let s = 0; s < 12; s++) {
      wedges.outer.push(wedgeChord("outer", s));
      wedges.inner.push(wedgeChord("inner", s));
    }
    wedges.seam = wedgeChord("seam", -1);
  }

  const inSector = (station) => {
    const rel = norm12(station - H);
    return rel === 0 || rel === 1 || rel === 11;
  };
  // The wedge the home TONIC chord lives on — the mode's front door. Major-ish
  // modes open onto the outer ring, minor-ish onto the inner.
  function homeWedge() {
    const tonic = wedges.outer.concat(wedges.inner).find((w) => w.degree === 0);
    return tonic || wedges.outer[H];
  }

  // --- Chord naming (display only; the model has no 7th-chord concept yet,
  // so these labels live with the surface that plays them) ---
  const rootName = (w) =>
    w.q === "min"
      ? STATION_MINOR[stationOfPc(norm12(w.root + 3))].replace(/^./, (c) => c.toUpperCase()) + "m"
      : STATION_MAJOR[stationOfPc(w.root)] + (w.q === "dim" ? "°" : "");
  function extPcs(w, pad) {
    // Diatonic wedges snap the extension to the scale; borrowed ones take the
    // common-practice intervals (dominant-flavored 7th on either quality).
    const semis = w.degree >= 0 ? degreeStepSemis(w.degree, pad.steps) : { 6: 10, 8: 14, 3: 5, 1: 2 }[pad.steps];
    const added = norm12(w.root + semis);
    if (pad.sus) return [w.pcs[0], added, w.pcs[2]];
    return [...w.pcs, added];
  }
  function extLabel(w, pad) {
    const base = rootName(w);
    if (pad.sus) return base.replace(/m$|°$/, "") + pad.id;
    if (pad.id === "9") return base + "add9";
    const semis = norm12(w.degree >= 0 ? degreeStepSemis(w.degree, 6) : 10);
    if (w.q === "dim") return base.replace("°", semis === 10 ? "ø7" : "°7");
    if (semis === 11) return base + "maj7";
    return base + "7";
  }
  const EXT_PADS = [
    { id: "7", steps: 6 },
    { id: "9", steps: 8 },
    { id: "sus4", steps: 3, sus: true },
    { id: "sus2", steps: 1, sus: true },
  ];

  // --- Live state: trail, pulses, gestures ---
  const trail = []; // { ring, station, pcs, t } — station -1 means the seam
  let flash = null; // { ring, station, t } — a captured write's white blink
  const gestures = new Map(); // pointerId -> gesture
  let rimDrag = null; // { startAngle, delta, cand } — one at a time
  const nowS = () => performance.now() / 1000;

  function pushTrail(w) {
    const t = nowS();
    const last = trail[trail.length - 1];
    if (last && last.ring === w.ring && last.station === w.station && t - last.t < 0.3) {
      last.t = t; // same wedge again: re-pulse, no zero-length segment
    } else {
      trail.push({ ring: w.ring, station: w.station, pcs: w.pcs, t });
      if (trail.length > TRAIL_MAX) trail.shift();
    }
    wake();
  }

  function soundWedge(w) {
    ensureStarted().then(() => audio.previewPcs(w.pcs, getHarmonyOct()));
    pushTrail(w);
  }
  // Only a clean tap writes into the playing clip — a strum is a run, a hold
  // is an audition. One intent, one write.
  function tryCapture(w) {
    if (captureChord(w)) {
      flash = { ring: w.ring, station: w.station, t: nowS() };
      buzz(10);
    }
  }

  // Playback's own chords walk the wheel too: the song watching itself.
  // Entries are degrees or borrowed {pcs}; either resolves to a wedge.
  function onPlaybackChord(entry) {
    if (!open) return;
    const ch = harmonyChord(entry);
    if (!ch?.pcs) return;
    const q = quality(ch.pcs);
    const root = ch.pcs[0];
    if (q === "dim") return pushTrail(wedges.seam);
    const station = q === "min" ? stationOfPc(norm12(root + 3)) : stationOfPc(root);
    pushTrail({ ring: q === "min" ? "inner" : "outer", station, pcs: ch.pcs });
  }

  // --- Geometry / hit-testing (CSS px, origin at canvas top-left) ---
  const center = () => size / 2;
  const R = () => size / 2 - 2;
  function polar(angle, rf) {
    return { x: center() + Math.cos(angle) * R() * rf, y: center() + Math.sin(angle) * R() * rf };
  }
  function wedgePoint(ring, station) {
    if (ring === "seam" || station === -1) return polar(seamAngle(), (R_MID + R_OUT) / 2);
    return polar(angleOf(station), ring === "outer" ? (R_MID + R_OUT) / 2 : (R_HOLE + R_MID) / 2);
  }
  function hitTest(x, y) {
    const dx = x - center();
    const dy = y - center();
    const rf = Math.hypot(dx, dy) / R();
    if (rf < R_HOLE || rf > 1.04) return null;
    const angle = Math.atan2(dy, dx);
    if (rf >= R_OUT) return { kind: "rim", angle };
    // The seam is thin to see and fat to hit.
    let d = angle - seamAngle();
    d = Math.atan2(Math.sin(d), Math.cos(d));
    if (Math.abs(d) < SEAM_HALF + 0.05) return { kind: "wedge", wedge: wedges.seam };
    const station = norm12(Math.round((angle - ANG0) / STEP));
    return { kind: "wedge", wedge: (rf >= R_MID ? wedges.outer : wedges.inner)[station] };
  }

  // --- Static layer ---
  function drawWedgePath(c, station, r0, r1, gap = 0.012) {
    const a0 = angleOf(station) - STEP / 2 + gap;
    const a1 = angleOf(station) + STEP / 2 - gap;
    c.beginPath();
    c.arc(center(), center(), R() * r1, a0, a1);
    c.arc(center(), center(), R() * r0, a1, a0, true);
    c.closePath();
  }
  function drawSeamPath(c, grow = 0) {
    const a = seamAngle();
    c.beginPath();
    c.arc(center(), center(), R() * R_OUT, a - SEAM_HALF - grow, a + SEAM_HALF + grow);
    c.arc(center(), center(), R() * (R_HOLE + 0.02), a + SEAM_HALF + grow, a - SEAM_HALF - grow, true);
    c.closePath();
  }

  function paintStatic() {
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sctx.clearRect(0, 0, size, size);
    sctx.lineJoin = "round";
    // Wedges. In-sector chords wear their function color — the same palette
    // as the chord picker, projected radially; everywhere else stays neutral,
    // majors a shade lighter than minors so the rings read.
    for (let s = 0; s < 12; s++) {
      for (const ring of ["outer", "inner"]) {
        const w = wedges[ring][s];
        const r0 = ring === "outer" ? R_MID : R_HOLE;
        const r1 = ring === "outer" ? R_OUT : R_MID;
        drawWedgePath(sctx, s, r0, r1);
        sctx.fillStyle = w.degree >= 0 ? hex(chordColor(w.degree, ring === "inner" ? -14 : -6)) : ring === "outer" ? "#27272c" : "#202024";
        sctx.fill();
        sctx.strokeStyle = "#0a0a0c";
        sctx.lineWidth = 1;
        sctx.stroke();
      }
    }
    // The diminished sliver on the sector's dominant edge — vii° never had a
    // station on any poster; here the tension chord lives on the boundary.
    drawSeamPath(sctx);
    sctx.fillStyle = hex(chordColor(dimDeg, -4));
    sctx.fill();
    sctx.strokeStyle = "#0a0a0c";
    sctx.stroke();
    // Sector outline + the home front door.
    sctx.strokeStyle = "rgba(232,184,75,0.9)";
    sctx.lineWidth = 2;
    const a0 = angleOf(H - 1.5) + 0.012;
    const a1 = angleOf(H + 1.5) - 0.012;
    sctx.beginPath();
    sctx.arc(center(), center(), R() * R_OUT, a0, a1);
    sctx.arc(center(), center(), R() * R_HOLE, a1, a0, true);
    sctx.closePath();
    sctx.stroke();
    const home = homeWedge();
    if (home.station >= 0) {
      drawWedgePath(sctx, home.station, home.ring === "outer" ? R_MID : R_HOLE, home.ring === "outer" ? R_OUT : R_MID, 0.02);
      sctx.strokeStyle = "rgba(255,255,255,0.85)";
      sctx.lineWidth = 2;
      sctx.stroke();
    }
    // Labels. Case is quality; the sector's wedges add their roman numeral —
    // the name of the JOB, not just the chord.
    sctx.textAlign = "center";
    sctx.textBaseline = "middle";
    for (let s = 0; s < 12; s++) {
      const sect = inSector(s);
      const oP = polar(angleOf(s), 0.695);
      sctx.fillStyle = sect ? "#f2f2f5" : "#8d8d94";
      sctx.font = `700 ${Math.round(size * 0.042)}px ${FONT}`;
      sctx.fillText(STATION_MAJOR[s], oP.x, oP.y - (sect ? size * 0.012 : 0));
      const iP = polar(angleOf(s), 0.435);
      sctx.fillStyle = sect ? "#e8e8ec" : "#77777e";
      sctx.font = `600 ${Math.round(size * 0.033)}px ${FONT}`;
      sctx.fillText(STATION_MINOR[s], iP.x, iP.y - (sect ? size * 0.01 : 0));
      if (sect) {
        sctx.font = `600 ${Math.round(size * 0.026)}px ${FONT}`;
        sctx.fillStyle = "rgba(255,255,255,0.75)";
        const ow = wedges.outer[s];
        const iw = wedges.inner[s];
        if (ow.degree >= 0) sctx.fillText(CHORDS[ow.degree].roman, oP.x, oP.y + size * 0.03);
        if (iw.degree >= 0) sctx.fillText(CHORDS[iw.degree].roman, iP.x, iP.y + size * 0.026);
      }
    }
    if (STATION_MAJOR[6] === "F♯") {
      // The enharmonic seam answers to both names.
      const gP = polar(angleOf(6), 0.775);
      sctx.font = `600 ${Math.round(size * 0.024)}px ${FONT}`;
      sctx.fillStyle = "#77777e";
      sctx.fillText("G♭", gP.x, gP.y);
    }
    // The rim: each station's signature at label-light opacity, and a brighter
    // grab-band over the sector — the handle you drag the key by.
    for (let s = 0; s < 12; s++) {
      drawWedgePath(sctx, s, R_OUT, R_RIM, 0.006);
      sctx.fillStyle = inSector(s) ? "rgba(232,184,75,0.16)" : "rgba(255,255,255,0.03)";
      sctx.fill();
      const label = sigLabel(s);
      if (label) {
        const p = polar(angleOf(s), (R_OUT + R_RIM) / 2);
        sctx.font = `600 ${Math.round(size * 0.026)}px ${FONT}`;
        sctx.fillStyle = inSector(s) ? "rgba(232,184,75,0.85)" : "rgba(255,255,255,0.28)";
        sctx.fillText(label, p.x, p.y);
      }
    }
    // Grab dots on the sector's rim span.
    sctx.fillStyle = "rgba(232,184,75,0.8)";
    for (const off of [-0.3, 0, 0.3]) {
      const p = polar(angleOf(H) + off * STEP, (R_OUT + R_RIM) / 2 + 0.06);
      sctx.beginPath();
      sctx.arc(p.x, p.y, size * 0.006, 0, TAU);
      sctx.fill();
    }
  }

  // --- Dynamic layer ---
  function drawHole(c, name, scaleName, sig) {
    c.beginPath();
    c.arc(center(), center(), R() * (R_HOLE - 0.035), 0, TAU);
    c.fillStyle = "#1b1b1f";
    c.fill();
    c.strokeStyle = "rgba(255,255,255,0.12)";
    c.lineWidth = 1;
    c.stroke();
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillStyle = "#f2f2f5";
    c.font = `700 ${Math.round(size * 0.052)}px ${FONT}`;
    c.fillText(name, center(), center() - size * 0.024);
    c.fillStyle = "#9a9aa1";
    c.font = `600 ${Math.round(size * 0.028)}px ${FONT}`;
    c.fillText(scaleName + (sig ? " · " + sig : ""), center(), center() + size * 0.028);
  }

  function paint() {
    raf = 0;
    const t = nowS();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(staticLayer, 0, 0, size, size);

    // Trail: the progression drawn as chords of the circle, each segment's
    // weight the number of tones the two chords share — near means smooth,
    // and you can see it.
    ctx.lineCap = "round";
    for (let i = 1; i < trail.length; i++) {
      const a = trail[i - 1];
      const b = trail[i];
      const age = t - b.t;
      if (age > TRAIL_FADE) continue;
      const alpha = 0.55 * (1 - age / TRAIL_FADE) * (0.35 + (0.65 * (i + 1)) / trail.length);
      const pA = wedgePoint(a.ring, a.station);
      const pB = wedgePoint(b.ring, b.station);
      ctx.strokeStyle = `rgba(232,184,75,${alpha.toFixed(3)})`;
      ctx.lineWidth = 1 + sharedPcCount(a.pcs, b.pcs) * 2.1;
      ctx.beginPath();
      ctx.moveTo(pA.x, pA.y);
      ctx.lineTo(pB.x, pB.y);
      ctx.stroke();
    }
    // Pulses on freshly sounded wedges.
    for (const e of trail) {
      const age = t - e.t;
      if (age > PULSE_S) continue;
      const k = 1 - age / PULSE_S;
      ctx.strokeStyle = `rgba(255,255,255,${(0.75 * k).toFixed(3)})`;
      ctx.lineWidth = 2 + 2 * k;
      if (e.station === -1) drawSeamPath(ctx, 0.02 * k);
      else drawWedgePath(ctx, e.station, e.ring === "outer" ? R_MID : R_HOLE, e.ring === "outer" ? R_OUT : R_MID, 0.02);
      ctx.stroke();
    }
    // A captured write blinks the wedge — the loop took your chord.
    if (flash) {
      const age = t - flash.t;
      if (age > 0.35) flash = null;
      else {
        ctx.strokeStyle = `rgba(255,255,255,${(0.9 * (1 - age / 0.35)).toFixed(3)})`;
        ctx.lineWidth = 3;
        if (flash.station === -1) drawSeamPath(ctx, 0.015);
        else drawWedgePath(ctx, flash.station, flash.ring === "outer" ? R_MID : R_HOLE, flash.ring === "outer" ? R_OUT : R_MID, 0.018);
        ctx.stroke();
      }
    }

    // The extension bloom: a veil over the wheel and micro-pads fanned away
    // from the thumb — each one the diatonic answer, so the same "7" comes
    // out maj7 on I and dominant on V. Naming happens in the hole.
    let held = null;
    for (const g of gestures.values()) if (g.kind === "wedge" && g.down) held = g;
    if (held?.bloom) {
      ctx.fillStyle = "rgba(10,10,12,0.35)";
      ctx.fillRect(0, 0, size, size);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let i = 0; i < held.pads.length; i++) {
        const p = held.pads[i];
        const sel = held.bloomSel === i;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, TAU);
        ctx.fillStyle = sel ? "#e8b84b" : "#2b2b2e";
        ctx.fill();
        ctx.strokeStyle = "#0a0a0c";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.font = `700 ${Math.round(p.r * 0.62)}px ${FONT}`;
        ctx.fillStyle = sel ? "#141414" : "#e8e8ec";
        ctx.fillText(EXT_PADS[i].id, p.x, p.y);
      }
    }

    // Key travel: carry the sector ghost with the finger and light the
    // accidentals up in the order the walk collects them — F C G D A E B is
    // never taught anywhere; it is just the rim, read in travel order.
    if (rimDrag) {
      const cand = rimDrag.cand;
      ctx.strokeStyle = "rgba(232,184,75,0.55)";
      ctx.lineWidth = 2.5;
      const gA = angleOf(H) + rimDrag.delta;
      ctx.beginPath();
      ctx.arc(center(), center(), R() * R_OUT, gA - 1.5 * STEP + 0.02, gA + 1.5 * STEP - 0.02);
      ctx.arc(center(), center(), R() * R_HOLE, gA + 1.5 * STEP - 0.02, gA - 1.5 * STEP + 0.02, true);
      ctx.closePath();
      ctx.stroke();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const n = cand <= 6 ? cand : 12 - cand;
      for (let i = 1; i <= n; i++) {
        const st = cand <= 6 ? i : norm12(12 - i);
        const p = polar(angleOf(st), (R_OUT + R_RIM) / 2);
        ctx.beginPath();
        ctx.arc(p.x, p.y, size * 0.028, 0, TAU);
        ctx.fillStyle = "rgba(20,20,23,0.9)"; // read over the static counts
        ctx.fill();
        ctx.font = `700 ${Math.round(size * 0.03)}px ${FONT}`;
        ctx.fillStyle = "rgba(232,184,75,0.95)";
        ctx.fillText(cand <= 6 ? SHARP_ORDER[i - 1] : FLAT_ORDER[i - 1], p.x, p.y);
      }
    }

    // The hole is the one name surface, three moments: traveling shows where
    // you'd land, holding names what you're touching, idle says you are here.
    if (rimDrag) {
      const candTonic = norm12(pcOfStation(rimDrag.cand) - relMajorOffset(song.scale));
      drawHole(ctx, keyDisplayName(candTonic, song.scale), song.scale, sigLabel(rimDrag.cand));
    } else if (held) {
      const w = held.curWedge;
      const name = held.bloom && held.bloomSel != null ? extLabel(w, EXT_PADS[held.bloomSel]) : rootName(w);
      const roman = w.degree >= 0 ? CHORDS[w.degree].roman : romanFromHome(homePc(), w.root, w.q === "min");
      const sig = w.ring === "outer" && w.station >= 0 ? sigLabel(w.station) : "";
      drawHole(ctx, name, `${roman} of ${homeName()}`, sig);
    } else {
      drawHole(ctx, homeName(), song.scale, sigLabel(H));
    }

    if (open && needsAnim(t)) raf = requestAnimationFrame(paint);
  }

  function needsAnim(t = nowS()) {
    if (gestures.size || rimDrag || flash) return true;
    return trail.some((e) => t - e.t < TRAIL_FADE);
  }
  function wake() {
    if (open && !raf) raf = requestAnimationFrame(paint);
  }

  // --- Gestures ---
  function padLayout(x, y) {
    // Fan the pads away from the wheel's center so the thumb never covers
    // them, and keep every pad on the canvas.
    const base = Math.atan2(y - center(), x - center());
    const r = Math.max(size * 0.052, 26);
    const dist = r * 2.6;
    return EXT_PADS.map((_, i) => {
      const a = base + (i - 1.5) * 0.62;
      return {
        x: Math.max(r + 2, Math.min(size - r - 2, x + Math.cos(a) * dist)),
        y: Math.max(r + 2, Math.min(size - r - 2, y + Math.sin(a) * dist)),
        r,
      };
    });
  }

  canvas.addEventListener("pointerdown", (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hit = hitTest(x, y);
    if (!hit) return;
    e.preventDefault();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // synthetic streams can end before capture resolves
    }
    if (hit.kind === "rim") {
      if (rimDrag) return; // one hand on the wheel at a time
      rimDrag = { id: e.pointerId, startAngle: hit.angle, delta: 0, cand: H };
      buzz(6);
      wake();
      return;
    }
    const g = {
      kind: "wedge",
      down: true,
      x,
      y,
      startX: x,
      startY: y,
      curWedge: hit.wedge,
      bloom: false,
      bloomSel: null,
      pads: null,
      timer: 0,
    };
    g.timer = window.setTimeout(() => {
      if (!g.down || g.bloom) return;
      g.bloom = true;
      g.pads = padLayout(g.x, g.y);
      buzz(6);
      wake();
    }, HOLD_MS);
    gestures.set(e.pointerId, g);
    soundWedge(hit.wedge);
    wake();
  });

  canvas.addEventListener("pointermove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (rimDrag && rimDrag.id === e.pointerId) {
      const angle = Math.atan2(y - center(), x - center());
      let d = angle - rimDrag.startAngle;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      // Accumulate the normalized per-move step so a long drag keeps going
      // around instead of snapping back at the ±π seam.
      let dd = d - (rimDrag.lastD ?? 0);
      dd = Math.atan2(Math.sin(dd), Math.cos(dd));
      rimDrag.delta += dd;
      rimDrag.lastD = d;
      const cand = norm12(H + Math.round(rimDrag.delta / STEP));
      if (cand !== rimDrag.cand) {
        rimDrag.cand = cand;
        buzz(4);
      }
      wake();
      return;
    }
    const g = gestures.get(e.pointerId);
    if (!g) return;
    g.x = x;
    g.y = y;
    if (g.bloom) {
      let sel = null;
      let best = Infinity;
      for (let i = 0; i < g.pads.length; i++) {
        const p = g.pads[i];
        const d = Math.hypot(x - p.x, y - p.y);
        if (d < p.r * 1.35 && d < best) {
          best = d;
          sel = i;
        }
      }
      if (sel !== g.bloomSel) {
        g.bloomSel = sel;
        if (sel != null) {
          ensureStarted().then(() => audio.previewPcs(extPcs(g.curWedge, EXT_PADS[sel]), getHarmonyOct()));
          buzz(6);
        }
      }
      wake();
      return;
    }
    if (Math.hypot(x - g.startX, y - g.startY) > 14) {
      clearTimeout(g.timer); // moving means strumming, not holding
      g.strummed = true;
      const hit = hitTest(x, y);
      if (hit?.kind === "wedge" && (hit.wedge.ring !== g.curWedge.ring || hit.wedge.station !== g.curWedge.station)) {
        g.curWedge = hit.wedge;
        soundWedge(hit.wedge);
      }
    }
  });

  function endPointer(e) {
    if (rimDrag && rimDrag.id === e.pointerId) {
      const cand = rimDrag.cand;
      const wasCancel = e.type === "pointercancel";
      rimDrag = null;
      // A canceled drag must never commit later — same law as the pinch.
      if (!wasCancel && cand !== H) {
        const tonic = norm12(pcOfStation(cand) - relMajorOffset(song.scale));
        buzz(12);
        commitKeyScale(tonic, song.scale);
        if (!audio.playing) ensureStarted().then(() => audio.previewPcs(CHORDS[0].pcs, 0));
      }
      wake();
      return;
    }
    const g = gestures.get(e.pointerId);
    if (!g) return;
    clearTimeout(g.timer);
    g.down = false;
    gestures.delete(e.pointerId);
    if (e.type === "pointerup" && !g.bloom && !g.strummed) tryCapture(g.curWedge);
    wake();
  }
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);

  // --- Lifecycle ---
  function resize() {
    const w = wrap.clientWidth || 320;
    const target = Math.round(Math.min(w, window.innerHeight * 0.5));
    dpr = Math.min(2, window.devicePixelRatio || 1);
    if (target === size && canvas.width === Math.round(target * dpr)) return;
    size = target;
    canvas.style.width = size + "px";
    canvas.style.height = size + "px";
    canvas.width = staticLayer.width = Math.round(size * dpr);
    canvas.height = staticLayer.height = Math.round(size * dpr);
    paintStatic();
  }

  function refreshStatic() {
    rebuildWedges();
    if (size) paintStatic();
    if (open) {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(paint);
    }
  }

  const view = {
    el: wrap,
    onPlaybackChord,
    refreshStatic,
    opened() {
      open = true;
      resize();
      refreshStatic();
    },
    closed() {
      open = false;
      gestures.clear();
      rimDrag = null;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
    isOpen: () => open,
  };

  rebuildWedges();

  // Debug handle for the headless harness — geometry only, same contract as
  // window.__noodles: not a public API, but smoke depends on it.
  if (typeof window !== "undefined") {
    window.__noodlesCircle = {
      point: (ring, station) => wedgePoint(ring, station),
      rimPoint: (station) => polar(angleOf(station), (R_OUT + R_RIM) / 2),
      home: () => H,
      size: () => size,
      trailLength: () => trail.length,
    };
  }

  return view;
}
