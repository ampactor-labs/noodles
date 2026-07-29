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

A slash chord seats its bass around C2, and eight ledger lines under a
treble staff is how you spot software pretending to engrave. Each note
routes to whichever staff needs fewer ledger lines. Ties go to treble, so
middle C hangs from its own ledger below the treble staff, which is the
convention. That caps every note at two or three ledgers by construction:
the treble keeps an 8va guard for pinched registers, and the bass staff
never needs one. Both staves wear the signature, the bass positions two
steps lower, the same rule the roll staffs already followed. Bar columns are
returned to the caller, and the chord slots adopt them as their own grid,
so every tower stands exactly over the slot it sounds from.

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
as A♭ C E♭, never G♯ B♯ D♯. And because harmony is one chord per bar,
per-chord accidentals are engraving-correct by construction: each slot is
its own measure, so accidental state legitimately resets. The naive
implementation is the correct one.

## Accidentals only where the promise breaks

The signature is a promise about letters; an accidental prints only when a
tone breaks it, including the natural that cancels. Diatonic chords in
their home key therefore engrave bare, which is the lesson working: flip
through keys and the staff stays clean while the signature does the moving.
A borrowed chord shows up wearing accidentals, the same "visitor" signal
the violet roman carries in the minis.

## The drawn clef

U+1D11E needs a music font, and neither headless Chrome nor a stock phone
reliably ships one; the glyph silently rendered as nothing on the first
receipt. The clefs are embedded vector outlines instead, filled via
Path2D: the G clef from Wikimedia Commons GClef.svg (public domain), the
F clef from FClef.svg by っ (CC BY 2.5). The G spiral's eye threads the
G line and the F dots flank the F line, anchored by measured constants
from the source viewBoxes, and a path renders identically on every
device. Same determinism-over-luck call as the synthesized drums.

## Scope and the bank

v1 was read-only engraving in the chord editor; the roll staffs landed the
same week. Each piano roll now draws its lane as noteheads on the step grid,
x aligned to the cells below, zoom window included, redrawn with every
edit. The grand-staff question is answered by the editors' own shape:
melody gets the treble clef, bass gets a drawn F clef, and no grand staff
is needed because the tracks are separate surfaces. Accidentals print
per note where they break the signature (a bar-long lane makes that noisy
in principle and fine in practice at sixteen steps). Chops mode hides the
staff: slices aren't pitches.

Staff PNG shipped 2026-07-28: the export sheet renders the first harmony
scene through the same painter onto a 1400×360 plate, key, tempo, and
scene in the caption, so the engraving leaves the app. The round-trip
principle, on paper.

Still deliberately not built: note entry on the staff (the roll and picker
are the editors; the staff is a mirror), rhythm values (noteheads sit where
the grid says; duration is the grid's job), courtesy accidentals, and
all-scenes sheet music (the plate takes one scene; a full-song engraving is
named follow-up).
