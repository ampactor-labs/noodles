# The staff projection — design notes

The chord editor engraves the clip above its slots: a treble staff wearing
the key's real signature, each chord drawn at its slot's x position. Code
lives in `buildHarmonyEditor` (main.js); the spelling it stands on is
model.js (`spellChordTones`, `signatureAccFor`, the letter arithmetic from
the per-key spelling work). This is the "retroactive notation" bet from the
theory-teacher thread: nobody is taught to read; the staff shows a riff the
player already knows by ear, and the mapping does the teaching.

## The three alignments that made it cheap

The engraving is honest because three earlier pieces already existed. The
voicing drawn is the exact `voiceLead` chain playback walks — the staff
shows what the pad will play, inversions and all, not textbook root
position. The spelling comes from the degree-letter arithmetic, so F♯
major's seventh degree engraves E♯ on E's line and a borrowed ♭VI arrives
as A♭ C E♭, never G♯ B♯ D♯. And because harmony is one chord per bar,
per-chord accidentals are engraving-correct by construction: each slot is
its own measure, so accidental state legitimately resets — the naive
implementation is the correct one.

## Accidentals only where the promise breaks

The signature is a promise about letters; an accidental prints only when a
tone breaks it, including the natural that cancels. Diatonic chords in
their home key therefore engrave bare — which is the lesson working: flip
through keys and the staff stays clean while the signature does the moving.
A borrowed chord shows up wearing accidentals, the same "visitor" signal
the violet roman carries in the minis.

## The drawn clef

U+1D11E needs a music font, and neither headless Chrome nor a stock phone
reliably ships one — the glyph silently rendered as nothing on the first
receipt. The clef is a hand-drawn bezier path instead: stylized, but the
spiral owns the G line, which is the one thing a G clef must do, and a path
renders identically on every device. Same determinism-over-luck call as the
synthesized drums.

## Scope and the bank

v1 is read-only engraving in the chord editor. Deliberately not built:
note entry on the staff (the roll and picker are the editors; the staff is
a mirror), rhythm values (whole-note chords match the one-chord-per-bar
model), and the melody/bass staff — the piano roll's opacity-dial slide
toward notation — which is the natural next reveal and needs the same
voicing-free treatment (notes are already absolute) plus a grand-staff
decision for bass. Banked with it: key-signature courtesy accidentals
across bar lines if harmony ever gets sub-bar chords, and printing/export
of the engraving (round-trip principle says a sketch should leave the app;
a rendered staff PNG in the export sheet would honor it).
