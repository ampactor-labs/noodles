# The circle of fifths — design notes

The KEY button in the footer opens a wheel instead of two dropdowns. The wheel
is the key selector, a playable chord surface over the harmony instrument, and
the place where the song watches itself go by. This file records why it is
shaped the way it is, what got cut, and what is banked for later. The code is
`src/circle.js`; the theory it leans on is in `src/model.js` (station
arithmetic, signatures, the mode offsets), verified across all 72 mode/key
pairs by `.tmp/dbg-circle-theory.mjs`.

## The sector

Lay majors on the outer ring and relative minors inside, and the seven
diatonic chords of any key form a contiguous patch: IV, I, V adjacent on the
outer ring, ii, vi, iii directly beneath them, vii° at the edge. The chord
palette for a key is a neighborhood. That single fact carries the whole
design, because the handoff's harmony principle ("diatonic close and
reachable, chromatic a deliberate reach") stops needing an invented layout —
the theory's own geometry is already the ergonomics. Borrowed chords are
literally a longer reach.

The math that makes it work: stations are pitch classes multiplied by 7
(mod 12), and since 7·7 ≡ 1, the same multiplication runs both directions.
A key's signature is just its station. Every seven-note mode is a rotation of
major, so a mode's sector is its relative major's sector; the tonic lands on
a different wedge inside it. C major and A minor and D dorian share one
neighborhood and differ only in which wedge is the front door. The white home
outline moves; the sector stays. Seven scary mode names collapse into "same
house, different door."

## What the wheel never does

It never rotates. C is always at twelve o'clock, D is always two steps
clockwise, always 2♯. Position becomes muscle memory, which is the point:
changing key slides the bright region around a fixed world, so modulation
reads as travel, and the distance you dragged is the drama you'll hear.

## Gestures, and the calls behind them

Tap a wedge and it sounds at the immediate clock. The pasted brief said
"quantized like scene launch," but this repo already paid for that lesson the
other way: Tone's `now()` adds the 0.25 s lookahead, and a quarter-second-late
tap reads as a broken instrument (ROADMAP, the 2026-07-18 pass). Sound is
immediate; the *write* is what quantizes, because harmony is one chord per
bar by construction.

Writes need arming. The ● in the sheet bar is the same idiom as session
record and motion capture: armed, a clean tap replaces the chord being heard
in the playing clip (undo per change, same as the chord editor). Strums and
holds never write — a strum is a run, a hold is an audition; one intent, one
write. Unarmed, the circle is a pure instrument, which is the right cold
state for jamming over a loop.

Hold and the extension bloom opens: 7, 9, sus4, sus2 as pads fanned away
from the thumb. The pads are diatonic, which is why there is no maj7 pad —
one "7" comes out maj7 on I and IV, dominant on V, half-diminished on the
seam, and the hole names which one you got. That surprise is the lesson about
seventh quality being positional, delivered by a pad instead of a paragraph.
(HCI literature on marking menus backs the layout: targets far from the
touch point to defeat occlusion, selection echoed somewhere the finger can't
cover. Our echo point is the hole.)

Drag across wedges to strum. Drag the rim to travel: the sector ghost rides
the finger, each station crossed ticks the haptic, and the accidentals light
up along the rim in the order the walk collects them — F♯, then C♯, then G♯.
The order of sharps is never taught anywhere in the app. It is the rim, read
in travel order, and it appears only during the gesture that asks for it.
Release commits through the same transpose path the old dropdowns used;
a canceled drag commits nothing (the pinch law from the arrangement).

The rim is the travel handle for a reason: tap and drag on wedges were
already taken by sound and strum, and the rim *is* the signature layer — you
grab the key by its signature, and the signature is the thing that changes
under your finger.

## The seam

vii° never had a home on any poster circle, because its root's own station is
five steps away from the key (B sits at station 5 while C's sector spans
11–1). Rather than pretend, the diminished chord lives as a thin sliver on
the sector's clockwise edge, between V and the world outside. Musically it is
V7's upper structure, so the dominant edge is its honest address: the tension
chord lives on the boundary. Thin to see, fat to hit (the hit test pads it).

## What is volunteered vs. what is pull

Volunteered: shapes and colors only. The sector's wedges wear the chord
picker's function hues; outside stays neutral; rim signatures sit at whisper
opacity. Names arrive on demand: hold a wedge and the hole names the chord,
its roman numeral from home, and (outer ring) the station's signature. The
hole reads home when idle, the candidate key while traveling, the held chord
while holding — one surface, three moments, nothing modal.

The trail is the song watching itself: playback chords walk the wheel,
consecutive chords connect with a line whose weight is their shared-tone
count. Near on the circle means shared notes means smooth, and the trail
makes that law visible without saying it. I–IV–V draws a tight triangle at
home; a borrowed chord lunges outside the sector and looks like the trespass
it is.

## The naming split, on purpose

Station labels spell by circle position (flat side flat: E♭, B♭, D♭), and
`keyDisplayName` in the model now names keys the same honest way — the footer
says "E♭ dorian," not "D♯ dorian." But `pcName` is still sharp-only, so chord
names inside clips read "A♯" where the circle says "B♭." That mismatch is
visible and accepted for v1; fixing it properly means per-key preferred
spelling through `rebuildChords` and the piano roll, which touches every
name surface in the app. First item in the bank below.

## Cut from v1, and why

- A floating name card over the bloom: collided with its own pads on
  top-of-wheel holds; the hole was already the better card.
- Beat shimmer on the sector: the per-bar chord pulses are the heartbeat;
  more blinking is noise.
- "V of V" aliases on the card: one more clause on a two-line card; the
  roman-from-home already carries the relationship.
- Tap-the-hole as a labels dial: the learning-opacity dial deserves a real
  design pass, not a hidden toggle.
- Writing borrowed chords into clips: not a cut so much as a boundary —
  `scene.harmony` stores scale degrees, so the bright region is exactly what
  the clip can hold. Honest, and it makes the soft wall physical: you can
  visit ♭VII, and if you want to live there, you move the key.

## The bank, one day later

Four of the original reveals landed 2026-07-28, the same arc that opened
this file (receipts in the theory oracle and the smoke gate):

- **Drag the front door** — built. The white knob on the home wedge carries
  the door to any in-sector wedge; the mode renames and not one stored note
  moves (degrees re-index by `(d − shift) mod 7`; proven sound-neutral for
  all six doors across all 72 mode/key pairs). One lesson paid for on the
  way: the knob's first hit zone was fat enough to eat armed taps on the
  home wedge — a handle that outranks the surface under it has to be tight,
  and a stationary grab now falls through to full tap semantics.
- **Per-key spelling** — built. Degree-letter arithmetic through
  `rebuildChords` and `noteName`; seven letters per key, F♯ major gets its
  E♯, the A♯/B♭ split is closed.
- **Chromatic harmony storage** — built (DECISIONS D13). Slots hold degrees
  or `{pcs}`; the circle is the chromatic writer; borrowed chords transpose
  with the song and wear the visitor's violet.
- **The staff projection** — built, v1 (DESIGN-STAFF.md): the chord editor
  engraves the heard voicing over the slots, signature-honest, accidentals
  only where the promise breaks. The voice-leading threads landed beside it,
  which closes the handoff's own "common tones light up" line.

And the two gasps landed the same evening:

- **The spiral** — built. Pinch out and the wheel un-closes into the walk of
  pure fifths: each station drifts by its 1.955-cent excess and B♯ arrives
  23.46 cents past home, radially and angularly off C, with a dashed line
  across the gap. The one line of why fades in only at full stretch —
  "a fifth is 3:2 — walk twelve and you miss home by 23 cents; equal
  temperament splits the difference" — and pinching back dismisses it. Two
  fingers only become a pinch once their distance moves, so two-thumb chords
  stay two taps.
- **The mirror** — built. Rest a finger on the hole and the key's axis draws
  itself (tonic to dominant, dashed); every tap the other hand makes
  reflects across it (pc → 2·tonic + 7 − pc). Major and minor swap by
  arithmetic, IV comes back as v, and most reflections land in the parallel
  minor — borrowed, violet, and storable through D13 when armed. The hole
  names each reflection as it sounds. A plaything; the term appears nowhere.

Still banked, each one a reveal:

- **Extension storage** (7/9/sus on stored chords) — the D13 fork's smaller
  sibling; the bloom already plays them.
- **The melody staff.** The piano roll's own slide toward notation; needs a
  grand-staff decision for bass (DESIGN-STAFF.md).
- **Partner dares.** Constraint clips a teacher can hand you ("stay in E♭,
  no voice moves more than a step") — the soft-wall mechanism already
  exists; this points it at two people on a couch.

## Performance shape

One canvas, DPR capped at 2. The wheel, labels, sector, and rim render once
into a static layer, redrawn only on key/scale change or resize; animated
frames composite that image with the trail, pulses, and drag ghosts. rAF
runs only while the sheet is open and something is moving — an idle open
circle schedules zero frames, a closed one costs nothing at all. Playback
with the sheet open costs one `drawImage` plus a handful of strokes per
frame on a ~350 px square. Receipts: `.tmp/dbg-circle.mjs` (screenshots,
travel, trail), and the circle section in `npm run smoke` (armed punch,
travel commit, undo restore).

## The wheel as the app's geometry (2026-07-28, "unify, simplify, empower")

The circle stopped being a destination and became the harmonic surface
everywhere chords appear. One component, three mounts: the footer's KEY
button draws a 26 px live compass (sector arc, front-door dot); the key
sheet mounts the full wheel with the ● arm; the chord editor mounts a small
one in place of the old seven-block picker — always armed, because editing
is the intent, with `strumWrites` on so a drag across wedges paints bars in
a row while the selection walks forward. Everything the big wheel does —
blooms, borrowed reaches, the mirror, rim travel, the door, the spiral —
works in the editor, and a key change from the editor's own wheel rebuilds
the open editor so slots, staff, threads, and wheel re-speak together. The
editor column now reads top to bottom as four projections of one clip:
engraved staff, named slots, voice threads, and the wheel. The picker idiom
and its CSS are deleted; the wheel is the palette.

## Prior art, one line

Existing circle apps — the Play Store's, the CodePen SVG wheels — are
reference cards: tap a key, read a list, maybe hear an arpeggio. The gap this
design fills is the circle as *instrument*: the sector as playable palette,
key change as a drag you can hear, theory surfacing only under a held finger.
