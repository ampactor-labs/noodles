# Roadmap / TODO

The live prototype is the Vite + Tone.js + DOM app at the repo root. `AGENTS.md` carries the
full "what works today" list; the short version: Session + Arrangement views with quantized
launch, launch modes and follow-actions, session-record into the arrangement, four clip
editors with velocity lanes, a vertical mixer with reverb/echo sends and loudness-matched
device presets, a randomized-but-balanced cold open with a 🎲 reroll, WAV export (master +
stems) through the same graph as live playback, project save/load, undo/redo, and two
headless gates (`npm run smoke`, `npm run calibrate`).

## Agreed next (in order)

The agreed list is clear: everything on it shipped. Named follow-ups, not
yet agreed: all-scenes sheet music, mixer ∿ badges for send-ride lanes
(more useful now that the dice bakes rides), MIDI export, rolled form
(dice sets follow-actions so A→B→A plays itself — deferred because it
changes session-launch defaults, the builder's call to make).

Session playback learned the phrase 2026-08-09: `clipLengthBars` said 1
for every non-harmony track, so the session transport wrapped every
drum/bass/melody clip at bar one — D19's multi-bar lanes paged four bars
in the editor and played four in the arrangement, but the session grid
looped bar 1 forever (measured, .tmp/pa-phrase-probe.mjs: 9 s of a
64-step lane sounded only step 0), and a 12-step polymeter lane restarted
each bar instead of phasing. Lane position now runs on the free-running
counter the motion lanes already used, clip length counts real bars
(harmony counts bars, not entries, so rate-2 pies stop filling at half
speed and queued launches stop waiting out a phantom eight-bar phrase),
and the probes read all four bars, both walked bass notes, and a true
9-hit 12-cycle (.tmp/pa-poly-probe.mjs). Same pass: when a lane spans the
scene's phrase, the editor's BAR chips wear each bar's roman in the
function tint — the progression map inside the beat editor.

The staff became real engraving 2026-08-09: `harmonyRate: 2` had quietly
broken the painter's "each slot is its own measure" premise (eight
half-bar slots engraved as eight whole-note bars, and a borrowed A♭
beside the diatonic vi in one measure showed an unmarked A that a reader
hears as A♭). The grand staff now groups slots into measures by the
scene's rate — barlines through both staves, a 4/4, half-note stems at
two chords per bar, an end-repeat where the wrap stubs already pointed —
and both painters track accidental state through the measure, so the
cancelling ♮ prints and restates exactly as a reader needs. Accidentals
(signatures included) are drawn Path2D geometry now, same
determinism-over-luck call as the clefs, with real 𝄪/𝄫 shapes guarded.
Roll staffs sort note stacks, displace seconds, and stagger accidental
columns. Receipts: .tmp/pa-staff-receipts.mjs renders four plates and
three editor shots; DESIGN-STAFF.md carries the corrected argument.

The roll learned gesture 2026-07-31 (D24): a comp pattern per vibe
(sustain/tresillo/skank/pulse/arp, groove-weighted, played per-16th by
compHitAt with the bar voiced once at step 0), sound hires for the
melodic tracks (60% pull the morph point into a groove-weighted corner;
rhythmic comps always hire a fast-attack pad), melody characters
(hook/runner/sparse/arc, carried by the vibe so ✨b re-sings the same
voice), baked send rides on 30% of rolls (throw/bloom/drumlift in the
motion lanes), rolled humanize from the groove's drift band, and two new
drummers (breaks, dembow — seven archetypes now). Receipt:
.tmp/dbg-dice-range.mjs, 400 rolls clean.

The master defaults went to full character 2026-07-29 (D22): juice, weight,
and glue at 100% with level at -6 (the builder's numbers, measured before
adoption - glue's uncompensated drive refills the level cut at the bus comp,
so the mix lands 0.7 dB hotter with the soft-clip stage running 6 dB
cleaner), and CEIL moved 0.66 to 0.64 to buy back the true-peak margin the
full weight shelf spent (worst roll -0.16 dBTP to -0.59).

Every roll is a four-bar phrase since 2026-07-29 (D21): harmony always four
entries, drums tiled with a bar-4 fill, the bass walking the changes every
roll, melody chord-tracking per bar, polymeter as the twelve-step
exception. Both of D18's deferrals (chord-following bass, fourth-bar
fills) are closed.

Multi-bar lanes shipped 2026-07-29 (D19): any drums/bass/melody lane can
stretch to 2/3/4 whole bars (steps 32/48/64 beside the polymeter range),
growing unroll-tiles the loop, BAR chips page the editors, and the dice
rolls progression-length walking basslines. That closes D18's
chord-following deferral in data, with no playback transpose.

The mix pass of 2026-07-28 late (D17): every dice roll now lands with a
depth floor (shared room on pad/lead, a breath on drums, bass dry), the
verb return took 20 ms of pre-delay, and three static carve filters handle
phone-speaker translation (bass 900 Hz presence, lead 2.6 kHz shelf, pad
320 Hz unbox). Same pass, perf: dice rolls no longer grow the voice pools.
A boundary-time trim (dice, stop) reclaims idle voices the disabled GC used
to leave behind (measured: settled graph 2102 → 1242 nodes after 12 rolls),
and the bass roll staff adopted the written-octave convention (sub-8 clef)
so low bass notes engrave on the canvas instead of clipping under it.

Voicing chips shipped 2026-07-28: the extension ladder moved into the model
(`ladderPcs`/`ladderRungOf`), the wheel's bloom pads delegate to it, and the
chord editor grew a rung row (triad · 7 · 9 · 11 · 13 · sus4 · sus2) that
rebuilds the selected bar's stack with the same arithmetic. Collapsing back
to a plain diatonic triad hands the slot its degree number again, so it
keeps following the key.

The same day the staff became a grand staff (treble + bass, notes routed by
ledger economy, both signatures, real engraved clef outlines, note letters
inside the heads) drawn by one painter for the editor and the Staff PNG,
with the chord slots adopting the engraving's bar columns and the
voice-leading threads drawn between the noteheads themselves. The separate
threads strip is deleted.

Staff PNG shipped 2026-07-28 (the round-trip principle on paper): the harmony
editor's engraver was factored into one module-level painter both surfaces
call, and the export sheet grew a Staff PNG button. The plate is 1400×360:
key signature, per-bar accidentals, the towers playback voices, the
slash-bass cellar left unclipped, caption top-left. v1 engraves the first
scene with a harmony line; all-scenes sheet music is named follow-up, not
scope.

Send rides shipped 2026-07-28 (D16, closing D5's last deferral): verb/echo
knobs live on the Sound sheet next to amount/motion, the ● ride arm captures
sweeps into normalized lanes, the mixer's static state is the base a laneless
scene restores to, and offline renders build a return any recorded ride
needs. The lane picker and painter took the new lanes without changes.

Shipped 2026-07-28 late: motion-lane EDITING (the lane picker: vel plus any
captured ride, drawn per step, bar chips for long lanes, ✕ clears; both piano
editors and the drum rack); the roll staffs (per-track clef, treble for melody and a
drawn F clef for bass; noteheads on the step grid, signature-honest, rows spelled
per key and tinted by degree function); dares v1 (a line of text riding the
project file, dismissible banner on load, never enforced); and D14 sample
persistence (user one-shots + chop kit in IndexedDB, restored at boot,
private-mode-safe).

The wheel unified the harmony surfaces 2026-07-28 evening: the chord editor's
seven-block picker is replaced by the circle itself (same component, small
mount, always armed: taps write the selected bar, strums paint runs of bars,
blooms/borrowed/mirror all write), and the footer KEY button became a live
mini-wheel compass. One harmonic instrument, three mounts: footer glyph, key
sheet, editor palette.

The chop deck shipped 2026-07-28 (DECISIONS D6 + P4): melody's second source.
Load a sample, sliced at hits or on the grid, rows as slices, the upper run
replaying at double speed, normalized once at load, session-scoped like the
user drum WAVs, identical offline. Alongside it: stored extensions (the bloom's
7/9/sus4/sus2 land in clips when armed, diatonic ones keeping their function
color), and the HUMAN slider, up to ±8 ms of per-hit drift through the same
swing path live and export.

Shipped since the last revision: the playable circle of fifths as the key selector
(DECISIONS D12, design + bank in DESIGN-CIRCLE.md): sector-lit diatonic palette,
tap/hold/strum chords through the harmony instrument, ● punch-in to the playing clip,
rim-drag key travel with the accidentals arriving in order, playback trail weighted
by shared tones; the theory-teacher arc on top of it (2026-07-28): per-key spelling
(seven letters per key, E♯ where the signature demands it), borrowed-chord storage
(D13: the circle writes violet `{pcs}` entries that transpose with the song), the
front-door knob (drag to re-mode; renames everything, moves nothing), the chord
editor's voice-leading threads, and the engraved treble staff over the slots
(DESIGN-STAFF.md); clip launch modes + follow-actions, the vertical mixer,
sends, sidechain duck, per-preset loudness calibration, session record, WAV/stem export,
project files, the dice, the morphable devices (XY pad between the preset corners +
color/motion slot per track, calibration-gated), the bundled drum sample bank with
per-voice pins and user WAVs, motion capture (per-scene 16-step automation lanes
recorded by riding the sound pad, DECISIONS D5), and the archetype dice (DECISIONS D9):
grooves with coupled tempo/pocket/kit, motif melodies, weighted harmony families, bass
behaviors, wet rolls, and a ✨b variation scene.

## Performance (Galaxy A16 5G / Dimensity 6300)

Adversarial investigation verdict (high confidence): **the stack is not the bottleneck;
the implementation is**, and the Vite dev server is a big confound. BandLab/Soundtrap run
smoothly on the same Web Audio API on this device class. So: optimize, don't switch stacks.

Done: convolution reverb → Freeverb; pad 24-voice fatsaw → 4-voice single saw; MetalSynth
hat → filtered noise burst; `latencyHint: "playback"` with `lookAhead 0.25` (scheduling
survives main-thread jank); pinch zoom scales a CSS transform and commits ONE rebuild on
release (no per-frame rebuild at all); meters transform-only and
only while the mixer is open; morph voices capped at the top-2 corners (2x a single synth,
never 4x); colors pay-per-roll; sample drums cost buffer playback instead of synthesis;
grid class sweeps dirty-checked per 16th; **idle park**: the context suspends ~6 s after
stop (past the longest tails) and wakes on any trigger, so a stopped app costs zero audio
CPU; **dry park**: with every send off the reverb and
echo returns disconnect from the graph entirely and wake before a send opens — worth
27% of a master render, not the ~10% this line used to claim (measured 2026-08-08,
680 vs 498 ms per rendered second with every send at -Infinity; D17's depth floor
both made the returns pricier and left them open on most rolls, so the park is worth
nearly three times what it was credited with and fires far less often);
**track park**: a track untriggered for 6 s (an empty lane, a
muted stem) drops its whole source side (layers, filters, chorus, color) out of the graph
with one cut at the color junction and wakes synchronously on any trigger; stems export
measured ~40% faster since a solo pass renders one track's DSP, not four; clock-pump
writes quantized (0.5% pies, ¼-px playhead) and skipped when unchanged, so pies repaint
every frame or two instead of sixty times a second. Sound-neutral only, per the standing
rule: no quality or capability trades.

The 2026-07-28 ultra-audit went after the same complaint on the feature-heavy
0.4.x builds, and the regressions were all main-thread, all new (receipts:
.tmp/dbg-perf-ultra.mjs, long-task counts on a desktop; multiply several-fold
for the A16): a four-wedge editor strum ran one 109 ms task (per-wedge
whole-song undo clone + synchronous staff/threads/clip repaints; now one undo
per gesture, paints coalesced to one rAF per burst, and strum SOUNDS floored at
60 ms apart while writes still land per wedge: 109 ms → 0 long tasks, burst
wall 18 → 2 ms); the circle read getBoundingClientRect per pointermove (one
forced layout per event during strums/rim/door, now cached per gesture);
paint() sync-redrew the roll staff with two layout reads per note-drag move
(now rAF-coalesced); and D14's chop persistence packed/unpacked unbounded
audio on the main thread (a 90 s row measured inside a 388 ms boot task; now
capped at 30 s at decode AND restore, restore deferred 900 ms past boot and
phase-split into sub-50 ms tasks, and a slice-mode flip stores a tiny meta row
instead of repacking megabytes). The residual ~305 ms boot task is bundle
parse/eval: pre-existing, the known cold-open cost, untouched by this pass. The laggy half was arithmetic: Tone's `now()` adds the 0.25 s
lookAhead, so every interactive trigger (chord preview, drum pad, note audition, XY-pad
ride, even the stop button) sounded a quarter second after the finger, on every device,
while the code's own comment claimed previews "fire at now." Interactive paths now schedule
at the immediate clock (`tapTime()` in audio.js), and the play lead dropped +0.18 → +0.1.
The choppy half was churn and a slow scheduler tick: Tone silently derives `updateInterval`
as lookAhead/2, so the worker tick that refills the scheduling window after a jank ran at
125 ms instead of Tone's own 50 ms default (now pinned back); Tone's PolySynth GC disposes
an idle voice every second under its running active-average and rebuilds it on the next
trigger: perpetual Synth construction across all twelve layer synths on any sparse lane
(disabled; the pool is already capped at maxPolyphony 4-5 and idle voices are silent
subtrees); and every sample drum hit built and disposed two full Tone objects (raw context
nodes now). Receipt over an identical 75 s sparse-scene playback (.tmp/perf-churn-long.mjs):
base build 866 Tone buffer-source constructions and 2 mid-jam voice disposals; new build 0
and 0, warmup constructions identical. The five meter analysers also park while the mixer
sheet is closed.

The 2026-08-01 hunt (an un-listenable on-device demo after D24): the layer pools were
never capped — Tone's positional PolySynth form swallows `maxPolyphony` into the voice
options, so every pool ran at the class default of 32 — and the comp gestures were the
first workload dense enough to use the room. Measured (.tmp/dbg-comp-drops.mjs): a pulse
comp on a hire patch rang 36 voices (24 on the pad-release layer) and priced the
full-band offline render at 826 ms per rendered second against 499 for the same song on
sustain. The object-form constructor makes the caps real (pad 8, melody 5, bass 4), the
pool steals at the cap instead of dropping (D25, with two timeline guards bought with
.tmp/dbg-steal-chaos.mjs), and post-fix the same render reads 472 vs a 396 sustain
baseline (+19%, was +65%). A baked send ride still adds its honest wet premium (~130
ms/s desktop) — that's the return sounding, not waste. Same hunt, small: `trimVoices`
no longer fires mid-jam (the dice path called it 1.5 s after every roll); a trimmed pool
under a comp refills within a bar, so the playing-time trim was pure
dispose-and-reconstruct churn.

The 2026-08-08 audit went after the cold open, which nobody had measured end to end
(full report + 20 harness scripts: .tmp/perf-audit-2026-08-08.md, .tmp/pa-*.mjs). Two
Tone.js taxes carried most of it, and neither is DSP. Freeverb's eight comb filters each
build an `IIRFilterNode`, and Blink prices one by simulating its impulse response until
it decays: 112 ms per filter on a 4x-throttled phone proxy, 869 ms for the bank, against
0.14 ms for a biquad. And `Oscillator.getInitialValue` runs a 32-term scan of a
2048-partial inverse FFT — roughly 131k trig calls — on every LFO construction and every
phase write, which Chorus does twice at boot and a color swap does four to six more times
per dice roll. Fixes: the live graph builds Freeverb in the first idle window instead of
before the first paint (offline renders stay eager; deferring it to "when a send opens"
bought nothing, because D17's depth floor means the boot's own setSend runs inside the
same module evaluation), `getInitialValue` is memoized with its full side effect
(`_partialCount` and the 2047-entry `_partials`), and color effects are kept per
(track, type) and islanded when inactive instead of disposed and rebuilt. First paint at
4x: 2108 → 804 ms; at 6x: 3244 → 1360 ms; worst boot task 1956 → 777 ms at 4x. A mid-jam
dice roll's worst task at 6x went 481 ms to 125 ms, moving the tear threshold (a task past
the 0.25 s lookAhead) from 6x to 8x. Sound-neutral with receipts: `npm run audit`
byte-identical, `npm run calibrate` identical on every deterministic row. The trade: a tap
inside the first second after paint can wait on the reverb build (worst measured 1289 ms at
6x, with the harness tapping the instant the UI appears) — a cost that used to be paid ahead
of the paint on every load. Same pass, the calibrate fixture now pins `humanize: 0`; half of
all rolls set it, so half of all calibrate runs were rendering with up to ±8 ms of random
per-hit drift. What's left on that gate is a ±0.1 dB floor on the drums high band, which is
Tone randomizing its noise start offset — by design, and proof that a 0.1 dB move there is
not a signal (.tmp/pa-8-determinism.mjs renders the same stem twice and the buffers differ).

Remaining, in honesty: the always-on chain while PLAYING (verb combs, chorus, five
compressors, master stack) is the floor and it IS the sound; shrinking it means a measured
device tier that makes weak phones sound different from the export, a fork the builder must
call (D10 chose the uniform grade split instead). Tier-2 render items still open: diff-based
`paint()`/`refreshClip`, `color-mix()` precompute, snapshot-undo only on committed change;
they matter to playback now mainly as main-thread stall sources during a mid-jam dice roll
or sheet open, since a stall past the 0.25 s lookAhead is an audible gap. A 44.1 kHz context
(~8% on 48 k phones) was tried and reverted; Tone throws wrapping custom-rate contexts (see
AGENTS.md).

**On-device: run the production build, not the dev server.** `npm run build && npm run
preview -- --host`. The dev server ships unbundled ESM + unminified Tone.js; on the A55
cores that parse/waterfall cost dwarfs everything else.

Also shipped: **installable + fully offline** (PWA: manifest, standalone display, Workbox
precache of all 28 files including the drum bank; the app makes zero external requests, so
airplane mode is a non-event). Install lives behind the browser menu and a pull-only row in
the ? page. Receipt: `.tmp/dbg-pwa.mjs` cuts the network and proves it boots, rolls, and
plays.

## Later / ideas

- Piano roll: note-name labels on blocks, velocity as stems (partly done).
- Export: MIDI out, audio bounce, Ableton Link (Link needs a native build, DECISIONS D1).
- The living-light/Pixi aesthetic was dropped for Ableton's real UI (see the design thread).
