# The staff projection: design notes

The chord editor engraves the clip above its slots as a grand staff,
treble and bass joined by a system line, the way a chart with a real bass
register is actually written. One module-level painter (`paintChordStaff`
in main.js) draws it for the editor and for the export sheet's Staff PNG;
the spelling it stands on is model.js (`spellChordTones`,
`signatureAccFor`, the letter arithmetic from the per-key spelling work).
This is the "retroactive notation" bet from the theory-teacher thread:
nobody is taught to read; the staff shows a riff the player already knows
by ear, and the mapping does the teaching.

## The grand staff and the routing rule

Voice-led towers dip under middle C, and a slash chord adds a real bass
tone under those — ledger soup beneath a lone treble staff is how you
spot software pretending to engrave. Each note routes to whichever staff
needs fewer ledger lines. Ties go to treble, so middle C hangs from its
own ledger below the treble staff, which is the convention. That caps
every note at two or three ledgers by construction: the treble keeps an
8va guard for pinched registers, and the bass staff never needs one. Both
staves wear the signature, the bass positions two steps lower, the same
rule the roll staffs already followed. Bar columns are returned to the
caller, and the chord slots adopt them as their own grid, so every tower
stands exactly over the slot it sounds from.

The slash bass engraves at the octave the instrument sounds it: the sub
plays `48 + bass` on every path — playback, editor preview, the circle's
audition — anchored regardless of the harmony octave, so the notehead
sits in the C3 band inside the bass staff and cancels the octave shift
the rest of the tower takes. It seated at C2 for a while, an octave below
anything that sounded; now every notehead on the plate is a pitch the
harmony instrument plays that bar, and the two layers that go un-notated
(the halo doubling the top voice an octave up, the sub doubling the root
in root position) are pure octave doublings of drawn tones —
registration, the thing charts have never notated.

## Voice leading, drawn on the engraving

The old separate "threads" strip is gone; the same information now draws
where the voices actually live. After the towers are engraved, gold lines
join held tones head-to-head and dim lines slope where a voice steps:
the exact `voiceLead` chain playback walks, wrap stubs exiting right where
the loop hands back to bar one. Segments run only through the white space
between towers (they start past a head's edge and stop short of the next
bar's accidental column), so nothing overlaps a symbol. Each open notehead
also carries its letter, small and dim, inside the head: the staff spells
itself without a legend.

## The three alignments that made it cheap

The engraving is honest because three earlier pieces already existed. The
voicing drawn is the exact `voiceLead` chain playback walks; the staff
shows what the pad will play, inversions and all, not textbook root
position. The spelling comes from the degree-letter arithmetic, so F♯
major's seventh degree engraves E♯ on E's line and a borrowed ♭VI arrives
as A♭ C E♭, never G♯ B♯ D♯. The third alignment used to be "one chord per
bar, so each slot is its own measure and accidental state legitimately
resets" — true when written, false the day `harmonyRate: 2` shipped, and
the painter carried the stale premise for two commits. Measures are real
now (below), so the naive reset is retired instead of quietly wrong.

## Measures, and accidentals only where the promise breaks

The painter groups slots into measures by the scene's rate and draws the
notation that says so: barlines through both staves at every boundary, a
4/4 after the signature (the grid is sixteenths of a 4/4 bar everywhere in
the app), and an end-repeat at the far right, because the progression
loops and repeat dots are the notation for that — the wrap stubs already
pointed there. At two chords per bar the towers wear half-note stems
(direction by where the tower sits against the middle line, per staff),
since two stemless towers in one measure would claim eight beats.

The signature is a promise about letters; an accidental prints only when a
tone breaks what is IN FORCE — the signature, or an accidental earlier in
the same measure on the same staff position. State carries across towers
and resets at barlines, so a borrowed A♭ followed by the diatonic vi in
one measure prints the cancelling ♮ on A exactly where a reader needs it;
before this, that A engraved bare and read as A♭ to anyone applying the
measure rule. Diatonic chords in their home key still engrave bare, which
is the lesson working: flip through keys and the staff stays clean while
the signature does the moving. A borrowed chord shows up wearing
accidentals, the same "visitor" signal the violet roman carries in the
minis.

## The drawn clef, and the drawn accidentals

U+1D11E needs a music font, and neither headless Chrome nor a stock phone
reliably ships one; the glyph silently rendered as nothing on the first
receipt. The clefs are embedded vector outlines instead, filled via
Path2D: the G clef from Wikimedia Commons GClef.svg (public domain), the
F clef from FClef.svg by っ (CC BY 2.5). The G spiral's eye threads the
G line and the F dots flank the F line, anchored by measured constants
from the source viewBoxes, and a path renders identically on every
device. Same determinism-over-luck call as the synthesized drums.

The accidentals joined them (`drawAccidental` in main.js): a text ♯ is a
font glyph that varies per platform and sits next to those engraved clefs
looking like UI; these are parametric filled paths in staff-space units —
beams thick and rising, verticals thin but clamped to a CSS pixel (0.09
spaces at roll scale is 0.66 px, and a sub-pixel upright is how the first
draft's natural read as a box with antennae), the flat's bowl a crescent
of two beziers centered on its line. Key signatures and per-note
accidentals both draw through it, and the doubles (𝄪, 𝄫) get real
geometry so a chord that ever reaches one doesn't wear a lying single.
The 4/4 numerals stay text on purpose: digits ship everywhere — it was
only the music glyphs that don't.

## Scope and the bank

v1 was read-only engraving in the chord editor; the roll staffs landed the
same week. Each piano roll now draws its lane as noteheads on the step grid,
x aligned to the cells below, zoom window included, redrawn with every
edit. The grand-staff question is answered by the editors' own shape:
melody gets the treble clef, bass gets a drawn F clef, and no grand staff
is needed because the tracks are separate surfaces. The visible window is
one bar (multi-bar lanes page per bar), so it is the measure: accidental
state carries left to right across it, an accidental holds its staff
position until cancelled, and the F that follows an F♯ prints its ♮
instead of silently reading sharp — restating after a cancel included.
Stacked notes sort bottom-up and a second displaces its head to the
right, ledger lines following the displaced head. Chops mode hides the
staff: slices aren't pitches.

Staff PNG shipped 2026-07-28: the export sheet renders the first harmony
scene through the same painter onto a 1400×360 plate, key, tempo, and
scene in the caption, so the engraving leaves the app. The round-trip
principle, on paper.

Still deliberately not built: note entry on the staff (the roll and picker
are the editors; the staff is a mirror), rhythm values beyond the rate-2
stems (roll noteheads sit where the grid says; duration is the grid's
job), courtesy accidentals across barlines (state resets clean; the
restatement inside a measure is the one that prevents misreading), and
all-scenes sheet music (the plate takes one scene; a full-song engraving
is named follow-up).
