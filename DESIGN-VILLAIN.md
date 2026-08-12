# DESIGN-VILLAIN — the reference track, measured from audio

The builder handed the actual audio of Jaron Lopez's "Villain" (2:51.7,
44.1 kHz, the vamp archetype's reference) with a mandate: own the gap
between what the dice deals and what this record is. This file is the
ground truth from that audio — measured, not recalled — plus the program
it implies. It corrects two claims in the woodshed research
(`vamp-archetype.md`) that were made from a noisier pass, and it
supersedes that file's measurement table. Analysis receipts: the scripts
live in the session scratchpad; every number below came out of numpy on
the decoded waveform, tuning-verified at +0.5 cents from A440.

The band is keys, drums, bass, guitar. No vocals. It plays like a live
quartet, and that fact drives most of what follows.

## 1. Corrections to the woodshed research

1. **The key family was wrong.** Pitch-class energy: G 29.6%, F 20.3%,
   C 11.7%, Bb 10.4%, Eb 9.7%, D 8.2%, Ab 5.9% — then nothing (E natural
   0.4%, A 0.6%). That set is {C, D, Eb, F, G, Ab, Bb}: the C-minor
   family, **F dorian at home** — not G dorian. Every chord in the track
   is diatonic to F dorian; the full seven appear, including one bar of
   the viø (Dm7b5). The one outside note is a single C7 (V7, E natural)
   resolving to Fm7 at bars 46-47, and the track ends bIII → i7
   (Ab → Fm7), which settles the tonic.
2. **The vamp move was wrong.** Not i7–IV7. Occupancy over 82 bars:
   Gm/Gm7 28.5, Fm9/Fm7 19.5, Abmaj7/Ab 13, Cm7/Cm9 9.5, Bb 6, Eb/Ebmaj7
   4, C7 1.5, Dm7b5 0.5. The spine is **i9 ↔ ii7 planing (Fm9 ↔ Gm7)**
   that sits on the ii even longer than home, with **i ↔ bIIImaj7** as
   the second orbit. `VAMPS` in `src/model.js` has neither [0,1] nor
   [0,2] — the dice cannot roll this song's move. Confirmed right:
   dorian, ~1 chord/bar, extensions standard, straight sixteenths
   (offbeat at 52.8%), tempo (115.86).

## 2. The measured portrait, layer by layer

**Harmony.** F dorian, all seven diatonic chords in rotation around
i9↔ii7; visitors bIIImaj7 > v7 > IV > bVIImaj7; exactly one borrowed V7
as the track's single classical cadence; outro is six bars of bIII
pedal fading into a final i7. Everything voiced in 7ths/9ths.

**Drums.** A drummer, not a pattern: **53 distinct kick-placement
patterns in 56 active bars.** Sparse — ~3.3 kick + ~3.4 snare + ~3 hat
events per bar. Strong snares spread across all four beats (34/23/20/24%
on beats 1-4): backbeats exist but are constantly displaced. Kick
velocity IQR 0.55-1.02 of max; snare splits ~60% strong / 40% ghost.
Beat-folded, kicks are 50% on the beat, 35% in the **drag zone 65-130 ms
late** — between the 32nd and the 16th, a position a 16-slot grid cannot
say — and 0% on the clean "e". Hats are dark and sparse commentary, not
a lattice.

**Time.** The band drifts together ±50-80 ms against any fixed grid
(constant-tempo fit maxes out a ±80 ms correction window; median
bar-to-bar step 24 ms). Straight sixteenths, swing ≈ 0.03-0.08. The
looseness is ensemble drift plus the drag-kick, not shuffle.

**Bass.** Median register E1-area (midi ~34), ~4 distinct notes/bar,
roots-and-fifths with the fifth leaned on hard; occasional octave jumps.
60-150 Hz body — **sub is 2.3% of total energy**: this is a warm bass,
not an 808.

**Guitar.** Speaks in licks: 51 phrases, median 0.33 s, median gap
2.15 s between them (p90 6.4 s). Register midi 65-77. It answers the
band — it gets busiest exactly where the drums drop out.

**Arrangement (82 bars).** 2-bar intro turnaround (bIII-ii-V7 pickup!) →
full band 21 bars → **10-bar drum dropout** (keys/bass/guitar interlude,
bars 24-33) → full band 33 bars containing the V7 cadence → gradual
deconstruction from bar 65 → drums out for good at 67 → bIII-pedal
outro, fade. RMS terraces breathe ±1.5 dB in 2-bar phrases. The form is
the band arriving, leaving, returning, and dissolving.

**Mix.** 98.7% of energy below 1 kHz (sub 2.3 / bass 14.4 / lowmid 33.7
/ mid 48.6 / everything above 1 kHz 1.2%). Bass fully mono (S/M 0.004
below 150 Hz); what little top exists spreads to 0.31. Crest ~10 dB
through the body — dynamic, unsquashed — rising to 12-14 in the fade.
Dark is not a tint here; it is the sound.

## 3. What the dice can already say vs what it cannot

Already speaks (shipped on this branch): dorian hire 3:1, 108-122,
swing cap 0.08, 7ths/9ths by default, ghost snares, dusty/warm kits,
sparse hook-ish melody, minor-side borrow.

Cannot yet say, in order of how much beauty each carries:

1. **The move.** i↔ii and i↔bIII vamps (deck gap, §1.2).
2. **The drummer.** Per-bar variation from a vocabulary; today
   `rollDrumPhrase` tiles one rolled bar ×4 with ±0.04 velocity breath,
   so all four bars share one ghost layout.
3. **The form.** One scene loops; the record is arrival, dropout,
   return, dissolution. Scenes + follow-actions already exist — the
   dice just never deals an arc.
4. **The cadence color.** Minor-side borrow knows bVI and iv but not
   the V7 — the one chord that makes bar 47 land.
5. **The drag kick.** 65-130 ms late is between grid slots. Expressible
   only as a per-lane playback nudge (engine change, ears required).
6. **The darkness.** Vamp hires still deal bright-capable presets and
   an 808 kit; the reference has nothing above 1 kHz and 2% sub.

## 4. The program

House rules apply (receipts committed when behavior is load-bearing;
one knob per listen; every scaffold gets an off; merge = builder's call
after ears).

- **V-A — the deck (landed with this commit).** Optional archetype
  `vamps` (weighted pair deck) consulted by `magicHarmony`'s vamp
  branch; optional `visit` probability that swaps slot 2-or-3 of the
  phrase for a diatonic non-dim visitor; vamp's `borrow` gains the V7
  at 30% of borrow events. All g-guarded, legacy decks untouched.
  Probe asserts: i↔ii reachable, visits diatonic, V7 present at sane
  rate, all archetypes normalize clean.
- **V-B — the drummer (landed with this commit).** Optional archetype
  `improv: true`: `rollDrumPhrase` re-deals `drums()` per bar instead
  of tiling bar 1 (downbeat anchor kept on bar 1; fill/lift logic
  unchanged). Probe asserts: vamp phrase bars differ in placement;
  legacy phrases still tile identically.
- **V-C — the form (landed).** Every vamp roll now deals a four-scene
  arc wired by follow actions: A (8 bars) → interlude (drums silent,
  bass+keys carry, fresh melody) → variation → outro (bIII pedal,
  one-shot, played lanes fade) — one 🎲, one ▶, and the phone plays a
  shape with a beginning and an end. The builder chose always-on over
  a long-press variant by shipping it live to test with ears.
- **V-D — the pocket nudge (engine landed, knob open).** `song.laneNudge`
  (ms per drum lane) rides both clocks and save/load; vamp hires roll
  the kick 15-40 ms behind. Audit ran before and after: meter self-test
  exact, LUFS spread 3.09 dB, chain untouched. Still open: the one
  number surfaced in the kick lane's sheet — until then the off is a
  reroll, a non-vamp hire, or the revert.
- **V-E — the darkness (sounds landed, dust deferred).** Vamp bass
  re-weighted deep 3 / pluck 2 / sub 1, kits dusty/warm only, and the
  hat lattice now breathes (off-spine slots sit out a third of the
  time, differently every bar under improv). The master "dust" color
  (tilt + gentle saturation) stays deferred: A16 budget and the audit
  gate make it a session of its own.
- **V-0 — the acceptance target (done).** `villain-shaped.noodles`
  regenerated in woodshed (research branch, 72c2b99): F dorian 116,
  i9|ii7 spine, the V7 in the return scene, Ab pedal outro, four
  scenes chained like the dice now deals them, kick nudged 28 ms.
  Chords name clean through this repo's own `harmonyChord`.

**Shipped to main 2026-08-12** on the builder's ship-and-test call
("push it, I'll test it running live, we can revert"). Everything
above landed except the dust color and the nudge's UI knob. If the
ears say no: `git revert -m 1 <the 2026-08-12 merge commit>` on main
undoes the whole program in one move; the knobs in `GROOVES.vamp`
remain for anything smaller.

The by-ear gate is unchanged and is the builder's: several 🎲 presses
landing within earshot of the reference without reproducing it. The
knobs stay in `GROOVES.vamp`; one per listen.
