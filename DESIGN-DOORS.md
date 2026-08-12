# DESIGN-DOORS — the Three Doors program, and this branch's state

Execution brief for whoever (or whatever) works this repo next. Written in
the style of `AGENTS.md`: read fully, then act. The design reasoning lives
in the woodshed repo (`ampactor-labs/woodshed`, branch
`claude/led-zeppelin-research-report-5q9led`, `research/` — specifically
`songwriting.md` (the framework), `noodles-doors.md` (the mapping),
`vamp-archetype.md` (the dice spec)); this file carries what a session in
THIS repo needs to finish the program without reading anything else.

The builder's mandate, verbatim: noodles should (1) be the centerpiece tool
for the Three Doors songwriting framework, (2) be upgraded to facilitate it,
(3) eventually be not needed — "albeit fun and forever useful." Requirement
3 is a design law for everything below: **every scaffold gets an off.**

---

## 0. What is ALREADY ON THIS BRANCH (`claude/vamp-archetype`)

The vamp archetype — "what the dice should feel like" — implemented in
`src/model.js`, three edits, all consumed only when present (older
archetypes untouched):

1. **`GROOVES.vamp`** — new archetype: tempo 108–122, swing ≤ 0.08 (the
   reference's offbeat measured at 52% of the beat — straight, not
   shuffled), pocket drums() with per-slot ghost snares, dark hires,
   dusty/warm/808 kits. Introduces three OPTIONAL archetype fields:
   - `scales`: weights consulted in `makeSong` — the archetype re-rolls
     the song's mode toward its home turf (vamp: dorian 3-to-1). Key
     stays put; only the mode moves.
   - `harmonyFam`: family weights for `magicHarmony`'s
     cadence/vamp/static/wander pick (vamp lives on vamps, 55).
   - `voicing`: rung weights (`"9"`/`"7"`/`"triad"`) — rolled degrees are
     dressed through `ladderPcs` per slot. A vamp arrives wearing its 9ths.
   - `borrow`: minor-side violet probability — dorian/minor already own
     ♭III and ♭VII, so the visitors dealt are ♭VI major (60%) and the
     minor iv (40%), the two colors the reference track kept reaching for.
2. **`magicHarmony`** — consults `harmonyFam`/`voicing`/`borrow` when the
   hired archetype carries them; the legacy 30%-sevenths path is intact
   for everyone else (verified by probe).
3. **`makeSong`** — `const scale` → `let scale`, plus the archetype
   scale re-roll before any scene is dealt. The 🎲 reroll path calls
   `makeSong` (main.js), so the dice inherits everything.

Plus: **`scripts/vamp-probe.mjs`** wired as **`npm run probe:vamp`** — a
Monte Carlo receipt (600 songs through the real `makeSong`) asserting:
hire rate sane, every vamp tempo in band, swing capped, dorian lean,
≥60% extended slots, ghost snares present, and **all archetypes'
scenes normalize clean** (the no-regression gate).

### Verification state — be honest about this
- ✅ `npm run probe:vamp`: ALL OK (68/600 vamp hires, dorian 34/68,
  ghosts 57/68).
- ✅ `npm run build`: clean (dist + PWA emitted).
- ❌ `npm run smoke`: **NOT run** — the working session was interrupted
  before it executed. Run it first (`CHROME_BIN=<chromium path> npm run
  smoke`); nothing in the diff touches the DOM, but the gate exists to be
  run, not reasoned about.
- ❌ Not heard on a phone. The acceptance test is by ear: several 🎲
  presses should land within earshot of `villain-shaped.noodles`
  (woodshed `research/noodles-project/`) without reproducing it.
- Merge to `main` **auto-deploys via Pages** to the builder's installed
  PWA. The merge is the builder's call, after ears.

### Tuning knobs if the ears say "close but not it"
All in `GROOVES.vamp`: `weight` (16 → hire rate), `harmonyFam` (more/less
static), `voicing` triad weight (brightness of the deal), `borrow` (violet
frequency), ghost probability (0.5 in `drums()`), the `perc` coin (0.5),
and `scales`. One knob per listen; it's a band, not an equalizer.

---

## 1. The remaining program, in priority order

Each item: what, where, acceptance, and the principle it answers to. House
rules apply to all: no gamification, learning is pull, every scaffold gets
an off, receipts in `.tmp/` plus a committed gate when the behavior is
load-bearing, screenshots for the builder, A16 performance is a
first-class constraint.

### P1-A — Name it while warm (smallest, highest value)
- **What:** one optional text line at export/save — "what it is, what it
  wants" — stamped into filenames and stored in the project beside `dare`.
  Filename shape: `2026-08-12-g-dorian-115-<slug>.wav`.
- **Where:** `src/main.js` — `downloadProject()` (~line 4743),
  `captureProject()` (add `song.note`), the WAV export buttons in the
  export sheet (search `"Download Project"` / `encodeWav`), and
  `applyProject` (carry `note` through like `dare`).
- **Why:** the woodshed's 58 unnamed takes are the proof; capture without
  naming is hoarding. An empty field, never a nag (pull, not push).
- **Accept:** exports land in the phone's downloads already identifiable;
  `note` round-trips through save/load; smoke still green.

### P1-B — Chart export (.cho, the woodshed bridge)
- **What:** export sheet gains "Chart (.cho)": ChordPro with `{title:}`
  (from `song.note` if present), `{key: <pcName> <scale>}`, `{tempo:}`,
  one section per scene (`# ✨` tags), chords per bar as
  `harmonyChord(entry).name` with the roman in a comment line above.
  Half-bar slots (harmonyRate 2) render two chords in the bar.
- **Where:** export sheet in `src/main.js`; all data already computed —
  see `chordMarkup()` for the naming path. Format reference: woodshed
  `PROTOCOL.md` (ChordPro chosen there because the builder's partner
  plays a concert-pitch instrument — transposability is the point).
- **Accept:** a couch jam becomes `songs/<slug>/chart.cho` in woodshed
  with zero retyping; a `.cho` opened in any ChordPro tool transposes.

### P1-C — MIDI export (already a named follow-up in ROADMAP.md)
- **What:** mirror of `src/midi.js` import: format-1 SMF, four tracks +
  drums on ch10 via the inverse of `GM_DRUM`, tempo/key meta, scene
  markers, swing rendered as timing offsets (the importer measures swing
  from offbeat 16th placement — export the same convention).
- **Where:** new `src/midiout.js` kept structurally parallel to
  `src/midi.js` (the import/export pair stays diffable, same as the
  midi.js/mid2noodles.mjs pairing); button in the export sheet.
- **Accept:** export → re-import ledger reports zero losses on a
  round-trip of a magic scene; a `.mid` dragged into Ableton lands
  playable. Principle 7: a sketch you love must be liftable.

### P2-D — "Give it its chords" (the one genuinely new feature)
- **What:** a one-tap Transform on melody/bass clips: score the seven
  diatonic chords per bar against the clip's strong-step pitch classes
  (velocity-weighted; strong = steps 0/4/8/12 double), offer the top 3
  harmonizations as candidate harmony lanes; preview by launch, commit by
  tap. Riff tones light up inside each candidate chord (the original
  HANDOFF's "common tones light up," landing where it teaches most —
  `sharedTones`/`sharedPcCount` in model.js are waiting).
- **Where:** model: pure scorer function (`harmonizeLane(lane, steps)` →
  ranked `[degree|pcs][]`) + probe with fixture riffs; UI: the Transforms
  sheet on the roll editors in `src/main.js`.
- **Fork for the builder:** diatonic-only first (teaches function) vs
  including the wheel-adjacent borrowed ring (teaches color). Recommend
  diatonic first.
- **Accept:** the High Tide moment — "hold that riff, give it its
  chords" — is one gesture; the probe proves sensible top-1 on known
  fixtures (a G-minor-pentatonic riff should rank i and ♭VII above vi°).

### P2-E — Palette glow (DEFERRED — paper first)
Monthly palette = a template project + its dare line, zero code. Build the
wheel ring-glow (`palette` array riding the file like `dare`) only if a
month of template use proves the paper version insufficient. Criteria in
woodshed `noodles-doors.md` §3.

### P3 — Obsolescence audit (requirement 3, standing)
- Every scaffold shipped by this program must be fadeable: romans, staff
  threads, any glow — check each lands under the annotation-opacity idea
  (if no global label-opacity control exists yet, that IS the P3 work).
- No tracking, no streaks, no usage metrics — graduation is self-observed
  (the signs live in woodshed `songwriting.md` §2, not in the app).

## 2. Ready-made artifacts (woodshed repo, `research/noodles-project/`)
- `lowtide.noodles` — Door 1 template (E dorian 72, i9/♭VImaj7/IVadd9/v9,
  dare carries the door rule, melody lane deliberately empty).
- `villain-shaped.noodles` — the vamp acceptance test (G dorian 115,
  i9|IV9, ghosts, sub bass forward).
- `fourzones.noodles` — the practice court (pentatonic/dorian/lydian/
  aeolian zones chained by follow-actions).
- `make-*.mjs` — their builders; all validate through THIS repo's
  `src/model.js` before writing a byte. Keep that habit for any new
  template: the model is pure and imports clean in node.

## 3. Session hygiene for whoever picks this up
- Run `npm run probe:vamp` and `npm run smoke` before AND after your
  changes; add a probe when you add behavior (the phrase-length bug in
  ROADMAP.md is the cautionary tale — receipts or it regressed).
- Judge sound and speed on `npm run build && npm run preview -- --host`,
  on the phone, never the dev server (AGENTS.md, target device A16).
- `AGENTS.md` is the source of truth; HANDOFF/DECISIONS/RESEARCH_FINDINGS
  are philosophy-only (stale for features). Add a DECISIONS-style entry
  when you ratify or overturn any fork above.
- Do not merge to `main` casually: Pages deploys to the builder's
  installed PWA on push.
