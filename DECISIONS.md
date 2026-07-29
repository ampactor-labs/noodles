# Decisions

Running log of the forks the handoff (§8.2) says to surface rather than bury. Each entry is a *provisional* call — the reasoning is here so the builder can overturn it, not just read a verdict. Ratified means "we talked it through and agreed"; provisional means "my recommendation, not yet argued against."

## Ratified 2026-07-08

### D1 — Ableton Link forces native (or a native bridge) eventually

Link is UDP multicast on the LAN. A sandboxed browser cannot join a Link session — no PWA, no exception. So use case 2 (backing track through the room speakers, synced to a real instrument) is structurally unavailable on the web path.

This does not block v0: the harmony cold-open needs no Link. But it settles part of the long-game platform question in advance — the build that serves use case 2 has to be native, or ship a small native Link helper the web app talks to. Recorded now so it is a chosen constraint, not a surprise found at port time.

### D2 — v0 stack is JS + Canvas + Web Audio; Sonido stays out of v0

The riskiest assumption is feel (handoff §7), and the feel risk lives almost entirely in the touch/gesture/animation layer, not the synth. So prototype in the stack that iterates fastest on gesture: Canvas (Pixi or raw) plus Web Audio, the `celezdial-selekta` lineage already in the repo neighborhood (Vite + Tone.js).

Reusing Sonido in v0 would couple the one variable we are trying to isolate (does the gesture feel good) to two unproven-for-this-purpose decisions: the Rust/WASM toolchain for the UI, and a GPU-tactile Rust UI framework (egui is wrong for a tactile instrument — it is immediate-mode and utilitarian; Makepad is plausible but unproven in our hands). Stack those later. Sonido is the port target once the interaction is validated, not the v0 substrate.

Note: Sonido already compiles to WASM and runs in a browser today (the live node-graph demo uses egui + `cpal` with the wasm-bindgen feature), so the reuse path is real — just not the fastest path to prove feel.

### D3 — Tonnetz is a deep zoom layer, never the cold-open interface

A Tonnetz orders adjacency by interval geometry, which is exactly what makes it easy to land somewhere dissonant. That violates Principle 4 (can't-make-it-wrong) for the non-musician on the couch — it rewards people who already think in intervals. So the cold-open surface is function-colored diatonic blocks where "next to" means "sounds good next," and the Tonnetz lives inside the harmony playground as something you pinch down into for voice-leading exploration. This is the handoff's own "deep structure to evaluate" placed at the right depth.

### D4 — The spark card is deferred out of v0

It is the one feature that fights the north star: a word-with-definition card is content arriving from outside the instrument, which is a push, and Principle 3 is "learning is pull, never push." The handoff already flags it as highest cheese-risk. It is also nowhere near the cold-open milestone. Cut from v0; revisit only if the instrument itself proves it needs a muse.

## Ratified 2026-07-10

### D5 — Automation is clip envelopes: 16-step motion lanes, gesture-recorded

The builder asked for automation (and Ableton warp) without overwhelming the casual user. The call: automation lives per scene per track as `scene.motion[track]` — a param name mapped to 16 values, the same step resolution as every other lane in the app. Capture is a performance, not an editor: arm ● in the Sound sheet, play, ride the XY pad or the amount/motion knobs, and only the params you touched get lanes. Playback schedules the morph ramps at transport time (sample-accurate against the heard beat); a scene with no lanes restores the base patch exactly once. Living in the scene means undo, project files, cloning, and offline render all carry automation for free. Deferred deliberately: send automation (needs a base-restore story against mixer state), lane *editing* UI (a param picker on the existing velocity-lane surface is the natural next step), and breakpoint curves (step lanes match the app's grid idiom; curves are DAW-density).

### D7 — The master gets a maximizer-style soft-knee ceiling

Kick transients were overshooting the limiter by up to +10 dB and hard-clipping at the DAC — an accident that read as "slam" but was really converter crunch. Per the builder's own mastering practice (iZotope maximizer with ~20% soft clip on professional mixes), the chain gains a ceiling stage between the makeup and the limiter: transparent below a -4.4 dBFS knee, tanh-saturating into a 0.98 ceiling above it, with a 0.25 pre-scale so ±4 of true amplitude lands on the shaper's curve instead of its clamped endpoints. Measured after: every master combo peaks at -0.2 dBFS with RMS within half a dB of before. The transient crack is now saturation, not clipping — decided, written down, and revertable by deleting one node.

### D6 — Warp is reframed as the chop deck; true time-stretch waits

Ableton-style warp is phase-vocoder stretching — heavy for the target phone, and worklets render silent inside Tone.Offline, which would break export-matches-app (the BitCrusher lesson). What made warp-era sample work joyful was mostly chopping against the grid, reordering, and repitching — and that maps to a noodles-native **chop deck**: load a WAV, auto-slice at transients or grid divisions, slices land on pads and sequence on the same 16 steps, per-slice repitch via playbackRate (native, cheap, offline-safe). If loops-that-follow-tempo is ever needed, stretch once at import into a pre-rendered buffer rather than in realtime. Agreed order: automation first, chop deck second.

## Ratified 2026-07-16

### D8 — The send returns ride the kick duck

The reverb and echo returns used to land on the master directly, so with a send up the wet
tail filled the exact pocket the kick-sidechain had just carved from the dry mix — measured
at a 2.8 dB median dip where the duck itself is -12 dB. Routing both returns through the
duck bus restores the pump: 10.5 dB median dip on the same probe (pad solo, verb at -8,
four-on-floor kick). This is the bass-music discipline (highpass the returns AND sidechain
them), and it costs nothing when sends are dry, which is the default. Revertable by
repointing two connects at `g.master`.

### D9 — The dice rolls archetypes, and it owns the sends

The global 🎲 used to roll wide timbre over one pattern archetype — same drummer, same
bass player, dry room, every roll. Now a **vibe** is rolled once per song: a groove
archetype (four-floor / backbeat / halftime / 2-step / minimal, each with its own kick
placement, hat grid, velocity personality, tempo band, and pocket range), weighted bass
behaviors, a melody built as a repeated-and-varied motif instead of uniform scatter,
weighted harmony families with rolled length (1/2/4 bars), and spice at low rates
(harmonyOct ±1 at 15%, a 12-step polymeter lane at 10%, a ✨b variation scene at 60% so a
good roll has somewhere to go). The groove hires the kit 60% of the time (808 → halftime,
garage → 2-step). About a third of rolls arrive **wet** — verb on pad and lead, echo on
lead, never bass/drums — which crosses into mix state: the builder called this fork, and
the contract is that the dice owns the *sends* (a dry roll resets them) while faders, pan,
and mutes stay the player's. Wet rolls are safe because the returns are highpassed and
ride the kick duck (D8). The design lesson applied: selection beats processing — roll
from curated archetypes with noise inside, not uniform noise over everything.

### D10 — Two grades, one chain: live plays lighter, exports render full — uniformly

The A16's perf overlay measured the audio thread starving on dense rolls (aud×0.92-0.99
while the main thread held 65-83 fps): the DSP floor, not the UI. Rather than a device
tier (breaks export-matches-app only on weak phones, needs measurement machinery and
mid-play switching), the builder chose a UNIFORM split: buildGraph gains an exportGrade
flag — the live graph runs half a Freeverb (four of its eight combs, same tunings and
dampening, level-matched makeup) and a 4-stage phaser instead of 10, while offline
renders keep the full chain. Everything feel-bearing — master stack, comps, duck,
morphing, levels — is identical in both grades. Measured: dry renders identical to
0.0 dB (a parked return is in neither graph), wet level-matched to 0.3 dB, phase level-
identical, with the live grade ~14% cheaper wet and ~20% cheaper under the phase color.
The invariant softens from "export sounds like the app" to "export sounds like the app,
plus mastering polish" — the same honest sentence on every device, which is the point.

## Ratified 2026-07-17

### D11 — The master gain structure is made honest; D7's ceiling is rebuilt as a real ceiling

A forensic audit (`npm run audit`, the harness added with this work) measured the master applying +19.9 dB of small-signal gain while the constants wrote down +5.5. The missing +14.4 dB came from three stages that hid it: Web Audio mandates an automatic makeup on every DynamicsCompressorNode (measured +5.60 on the glue, +6.41 per melodic input comp, +8.55 on the drum parallel) that no API reports; `tanh(x*1.2)/tanh(1.2)` self-normalized to +3.16 dB; and Tone's Distortion `wet` is an equal-power crossfade of two *coherent* paths, so wet=0.42 summed to +5.59 dB, not a 42% blend. That phantom gain is what justified a -20 dB threshold and parked the program on the ceiling at -4.8 LUFS with a crest of 6.3 — past the loudness-war line, no dynamic variety left. D7's ceiling wasn't a safety net; with +14 dB shoved through it, it was the main gain stage, taking -4.9 dB of crest in one pass.

The fix is structural, not cosmetic: every stage is unity at the origin by construction, and the only things that move the level are three constants that say a number out loud (bus trim, glue drive, ceiling drive). The spec makeup is measured and subtracted (`makeComp`); the saturation is our own curve with a real dry/wet mix and unity origin slope; the crossfade sums to unity. D7's `Tone.Limiter(-2)` is deleted — it was a Compressor with Tone's default 30 dB knee, a "limiter" whose knee spanned -17..+13 dBFS, contributing 0.02 dB for a 6 ms lookahead. The ceiling is now un-oversampled on purpose: a memoryless curve's own bound IS the sample-peak guarantee only when it isn't oversampled (a 4x clamp's reconstruction filter rings past the clamp — measured +0.27 dBFS out of a 0.78 curve), so the guarantee is arithmetic and CEIL carries true-peak headroom for the Bluetooth codecs of use case 2.

Four more findings in the same audit, all fixed and measured: (1) the app was mono — `Tone.Channel` defaults channelCount to 1 and its Panner forces channelCountMode "explicit", downmixing every track at the fader while the chorus/phaser/tremolo paid full CPU upstream for width that was summed away; set to 2. (2) The drum dry and parallel buses summed 6 ms apart (a compressor lookahead), a comb with its first null at 83 Hz straight through the kick — every bus is now delay-aligned to the 6.02 ms lookahead and the kick duck is scheduled against it. (3) The morph crossfade used equal-power weights on same-pitch, phase-locked layers that sum coherently, so the pad midpoint ran +3 dB hot; linear weights (which renormalize to unity amplitude) fix it, and the sample drum bank keeps equal power because its layers share only an onset, not a waveform. (4) The low-shelf-into-saturation trick for phone bass needed asymmetry to make the octave-up 2nd harmonic (tanh is odd, makes odd harmonics only); an asymmetric curve now does, with the DC it rectifies blocked *after* the saturation so the intended harmonic doesn't cancel against the symmetric stages downstream.

Measured end state (npm run audit): true peak from +5.1 to under 0 dBTP across the dice space, LUFS-I centered -10.3 (Ian Shepherd's measurements of the app's own references: Radiohead -9.9, Drake -10.2), crest recovered from 6.3 to ~9, per-stage gain model closing to 0.01 dB. The calibrate gate is re-baselined: stems now read wider because they pass mostly linear instead of through a 0.1 dB/dB squash — the ceiling was hiding the spreads, not holding them — while the full-mix master spread stays ~1 dB, which is the property the randomizer actually needs. Reverting is deleting the drive constants and restoring the old nodes; the audit harness stays regardless, because the whole lesson is that a chain you can't measure lies to you.

Left as an open fork, deliberately not chosen: the context sample rate. The `createAudio` comment claimed for a long time that it pinned 44100 to play the drum one-shots bit-exact and save ~8% DSP on 48 k phones, and it never did — `Tone.Context` takes no sampleRate option, so the option was accepted and dropped, and the app runs at the hardware's 48 k. Pinning it for real means constructing a native `AudioContext({sampleRate})` and handing it to Tone, which steps outside the standardized-audio-context wrapper Tone leans on for cross-browser param behaviour. That's a live tradeoff for the builder, not an oversight to paper over; the comment now says what the code does.

## Ratified 2026-07-28

### D12 — The circle of fifths is the key selector, and it is playable

The KEY control opens a full-width circle-of-fifths sheet (`src/circle.js`)
replacing the two footer dropdowns. Majors ride the outer ring, relative
minors the inner, and the seven diatonic chords of any key form a contiguous
patch on that layout — IV/I/V outer, ii/vi/iii under them, vii° on the edge —
so the key's palette is a bright sector and a borrowed chord is literally a
longer reach. Verified for all 72 mode/key pairs (.tmp/dbg-circle-theory.mjs);
full reasoning and the v2 bank in DESIGN-CIRCLE.md.

The calls inside it, each revertable on its own: the wheel never rotates
(stations are muscle memory; the sector slides instead, so modulation reads
as travel); the rim is the key-drag handle (wedge taps sound, wedge drags
strum, and the rim IS the signature layer you're changing); taps sound at the
immediate clock while writes bar-quantize (the tapTime lesson outranks the
"quantize like scene launch" brief); writing into the playing clip requires
the sheet's ● arm and lands only on a clean tap; borrowed chords play but
don't store, because scene.harmony speaks scale degrees — extending storage
to chromatic pcs is a named fork, not an accident. Mode rendering falls out
of the geometry: the sector sits at the relative major's station and the
home outline sits on the tonic's wedge, so dorian is C major's house entered
at d. One naming split accepted knowingly: station labels and key names
spell by circle side (B♭, E♭) while pcName stays sharp-only inside clips
(A♯) — per-key spelling is banked, first in line. (Landed the same day: see
the model spelling commit — the split is closed, and the staff work stands
on it.)

### D13 — Harmony slots learn to hold borrowed chords

`scene.harmony` spoke only scale-degree indices, which made the palette
can't-make-it-wrong and made a borrowed chord unstorable — the circle could
visit ♭VI but never keep it. An entry is now `0..6` OR `{ pcs: [root, third,
fifth] }`, written by the circle's armed capture when the tapped wedge sits
outside the sector. One resolver (`harmonyChord` in model.js) turns either
shape into the same CHORDS-shaped record, so playback, previews, session and
arrangement minis, and the editor never branch on which kind they hold.

Three calls inside it: borrowed chords TRANSPOSE with key changes alongside
bass and melody (a ♭VI stays a ♭VI — the app's "whole song travels" promise
outranks pitch-class stillness); they spell by their function, not the home
signature's side (the ♭VI of C reads A♭ even though C is a sharp-side key);
and they wear one off-palette violet instead of a function hue, because
function is exactly what the scale can't assign a visitor. The diatonic
picker stays seven-wide — the circle is the only chromatic writer, so the
soft wall holds: reaching outside the neighborhood is still the deliberate
gesture. Old projects load untouched (numbers normalize as before; unknown
shapes coerce to I). Receipts: the D13 block in .tmp/dbg-circle-theory.mjs
and the borrowed-punch assertion in npm run smoke.

### D14 — The phone remembers its own sounds: IndexedDB, not project embedding

User one-shots (loaded WAVs, mouth-drums) and the chop kit were session-scoped
because JSON project files can't reasonably carry minutes of Float32 audio.
The fork is settled toward IndexedDB: raw channels stored per voice plus one
chop entry (name + slice mode; slices re-derive deterministically on restore),
written on every load/record and restored at boot. Project files stay small,
portable JSON — a project you send someone still references sounds by name,
which is honest: the dare you hand a friend describes the game, not your
kitchen. Every IDB path is try/caught; private browsing degrades to exactly
yesterday's session-scoped behavior. Revertable by deleting the restore call.

The dare itself shipped alongside (the vision's partner channel, v1): a line
of text on the song, written in the File sheet, saved into the project, shown
once as a dismissible banner on load. Never parsed, never enforced — the
constraint is social, the app just remembers the words. And the melody/bass
rolls gained their staffs: per-track clef (treble for melody, a drawn F clef
for bass) IS the grand-staff decision, since the tracks are separate editors
(DESIGN-STAFF.md carries the reasoning).

### D15 — The builder suspends the live-sound law; the live grade goes minimal

"We need to do all possible perf gains exhaustively regardless of prior
rules" — the builder's words, overriding his own never-thin-the-sound
standing rule after audible breakup on the A16. The live grade now cuts
everything cuttable while exports keep the entire chain: the three melodic
input compressors bypass (level-neutral by D11's subtracted makeup — only
the squeeze is gone), the drum parallel compressor and its alignment delay
bypass (+1.2 dB dry approximation), the chorus is never constructed, the
halo never sounds, the live Freeverb runs two combs (+7.5 dB makeup), and
the phaser color runs two stages. A top-1 morph cut rode the first wave and
was pulled back within the hour — the XY blend is a flagship feel, and the
builder's "hmm" outranked its share of the saving.

Measured on the dense-wet probe (.tmp/dbg-dsp-cost.mjs): 14.76 s → 10.66 s
render wall with the morph cut in, ~28% off the live DSP bill; restoring
the blend gives a few points back and the rest stands. The honest cost: live is now
audibly drier and plainer than the export — "export sounds like the app,
plus mastering polish" stretches to "plus the width, the shimmer, and the
squeeze." Every cut is an independent exportGrade branch in buildGraph;
reverting any one is deleting its else-arm. If the A16 breathes again and
the builder misses the width, the halo and chorus are the first two to
bring back.

### P4 — The chop deck lives on the melody track, as a source toggle

*Ratified 2026-07-28 by the builder's "build out the remaining" and shipped
as recommended the same day: source chips in the melody Sound sheet, load +
hits/grid slicing, rows as slices with the upper run at double speed, and
the key-travel guard that leaves slice rows untransposed.*

D6 settled WHAT the chop deck is (load a WAV, slice at transients or grid,
slices on pads, sequence on the 16 steps, repitch via playbackRate) but not
WHERE it lives, and that fork shapes everything downstream. My
recommendation: the melody track gains a source toggle — synth | chops —
exactly the idiom the drums already use for their sample/synth banks. Rows
in the piano roll become slices; the existing lane data (16 slots of
{midi, len, vel}) needs no model change because midi maps to slice index
with the offset doubling as repitch; velocity lanes, transforms, polymeter
steps, arrangement, undo, and offline export all come along for free. The
chop buffer stays session-scoped, the same standing limitation as
user-recorded drum one-shots (that persistence fork is still open and the
answer should cover both).

Argued against the alternatives: a third drum bank caps chops at four
voices, which cripples the idea; a fifth track ripples through the audio
graph, the mixer, session record, stems, and every TRACK_KEYS loop for one
feature. The melody-source shape touches audio.js (a slice-playback branch
beside playNoteStackOn) and the piano roll's row labels, and nothing else.
Provisional because it decides what the melody track IS when a sample is
loaded — ratify or overturn before the build.

### D16 — Send rides close D5's deferral: the base is the mixer

The deferred fork was the base-restore story: when a verb or echo lane
ends, what level does the track come back to? The answer: the mixer's
static channelState is the base, exactly as patch lanes treat the sound
patch. A lane overrides per step; the first laneless scene ramps the base
back once (the same motionOn restore-once contract). Lanes store the
knob's -30..0 dB normalized to 0..1, so a send ride reads like every other
lane in the picker and the painter; playback inverts it and ramps the
per-track send gain directly. Capture is the same performance: arm ● ride,
sweep verb or echo (knobs now on the Sound sheet beside amount and
motion), and only what you touched grows a lane. The live path wakes a
parked return before a lane opens its send (the setSend discipline,
threaded through as mstate.wakeSend). Offline, renderOffline scans the
scenes' ride lanes so a return a ride needs gets built even when every
static send is off; without that scan a recorded ride rendered dry.
Revert is deleting the SEND_PARAMS branch in applyMotionOn; ride lanes in
project files would then just be ignored keys.

### D17 — Every roll gets a room: the depth floor revises D9's dry default

The builder's on-device verdict: "the overall mix is ass." D9 made dry
the default on the theory that the dry mix is the meaty one; in practice
a bone-dry roll reads flat, not meaty, because nothing shares a space
(65% of rolls carried zero send). The revision: the dice still owns the
sends, but what it rolls now has a floor. A shared small room on the
pad and lead (-20..-16 dB), a breath of it on the drums (-27..-23), the
deep-wet third unchanged on top, bass never (low-end discipline holds).
The verb return gains 20 ms of pre-delay, so the ear locks onto the dry
signal before the tail arrives and the room reads as depth behind the
mix rather than wash on it.

Alongside it, the phone-speaker translation layer: three static carve
filters, both grades, priced at three biquads. Bass +2 dB peaking at
900 Hz (a phone driver can't make the fundamental; the note must live
in its harmonics), lead +1.8 dB high shelf at 2.6 kHz (presence under
its lowpass), pad -2 dB peaking at 320 Hz (the boxy band where stacked
chords go dull). A full-mix saturator was considered and skipped: the
D7 ceiling already gives every path the shared nonlinearity, and D11's
measured gain structure outranks a research checkbox. Receipts:
calibrate spreads and the audit program loop, run with the change.

### D18 — The dice learns color, memory, and a wildcard

The roll audit found the generators musically conservative in three
specific ways: harmony rolled bare triads forever (the ladder existed,
the dice never used it), melody placed strong beats with no knowledge of
the chord under them, and pure randomness repeated itself: the same
drummer twice in a row reads as a rut even when the odds say fair.

Now: some rolls voice their line in sevenths and the odd ninth via
ladderPcs (the same stacks the wheel and rung chips write; the staff
and namer take them for free). Major-side rolls occasionally borrow a
bVII or bVI mid-line, so the violet visitor is part of the cold open,
not only something you dig for. The melody's downbeat and final note
snap to the first chord's tones: the lane loops one bar against the
whole progression, so full tracking is impossible, but those two notes
are the ones the ear checks. A hat lift into the loop seam breathes on
some rolls. And the dice keeps session memory, one re-pick when the
groove, kit, or progression matches the previous roll, plus a 6%
wildcard that forces polymeter, tempo-band edges, and stacked voicings.
Receipts: the 400-song probe rolls zero invalid entries, ~35% of scenes
carry stacks, borrowed stays rare (~3%), groove repeats fall 21% → 4.8%,
and 71 of 72 key/scale pairs appear; the audit dice loop holds
-9.3..-11.5 LUFS with true peaks under -1.33 dBTP.

Named for later, not rolled: chord-following bass (the one-bar lane
can't track a progression without a playback-side transpose-follow
feature; the tonic pedal against the harmony's own moving sub voice is
an idiom, not a bug, but a follow flag would be the next depth), and
drum fills every fourth bar (needs bar-position awareness in playback).

### D19 — Lanes can be whole bars long, and the bass walks the changes

D18 named the wall: melodic lanes were one bar looping against 1/2/4
bars of harmony, so nothing could follow the progression in data. The
builder floated "all clips the same length"; the ratified middle path
keeps one bar as the default (the cold open's 16-cell grid is a feature)
and lets any drums/bass/melody lane stretch to whole bars. The steps
system that already went short for polymeter (2..16) now goes long
(32/48/64). Growing unrolls the loop (bar 1 tiles into the new space, so
nothing changes until you edit bar 2); shrinking keeps the data. The
editors page with BAR chips, the same idiom the motion-lane picker
proved, and playback needed zero changes: the step modulo generalized
all along. The dice cashes it in immediately. About a third of
multi-chord rolls now walk the changes, a progression-length bass whose
per-bar root is the bar's chord root, with pickups toward the next
bar's root. That closes D18's chord-following deferral without a
playback transpose flag, so what the roll shows is exactly what sounds.
Polymeter survives as the sub-bar idiom; equal-length-everywhere was
rejected for killing it and for growing the beginner surface fourfold.

### P1 — Use case 1 leads v0; the cold-open harmony playground is the whole first milestone

Reading §7 straight: the couch-songwriting cold open is the milestone, the backing-track/Link scenario is phase two. Confirm this is the priority order before the research pass sets its emphasis.

### P2 — The v0 default voice is one deliberately chosen, instantly-lovable patch

§7 criterion 1 ("makes something they like in 30s") depends as much on timbre as on harmony. Perfect voice leading through an ugly patch fails the test. So v0 needs one gorgeous default voice — a soft, warm, slightly-detuned pad/keys in the Teenage Engineering register — chosen with the same care as the interaction, not filed under "audio: both, TBD." A curated sample or a hand-rolled Tone.js poly-synth can nail it; this is also the one place a small Sonido WASM voice could earn its way into v0.

### P3 — The fractal zoom is deferred behind a flat v0

Pinch-into-a-chord is a novel gesture and the product's signature bet, but §7 correctly scopes v0 to flat blocks plus common-tone lighting. Prove the flat playground is delightful before committing the whole product to the zoom metaphor. If flat blocks already clear the 30-second test, the zoom is upside, not load-bearing.

## Still open (from handoff §9)

- **Naming.** The repo is now named `noodles`. Keep the codebase and docs aligned with that name.
- **Platform priority for the eventual native build:** iOS-first vs Android-first (web-first is settled for v0 per D2).
- **Synth vs sample balance** for the full sound palette beyond the v0 default voice (P2).
- **How much of Sonido** to pull in for the native port (D2 keeps it out of v0; the port depth is undecided).
