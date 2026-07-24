# Noodles

A phone-first music sketchpad. It borrows Ableton's interaction model (the clip
grid, launch-and-loop, direct drag, scale-awareness, one-tap transforms) and
almost none of its density. The bet: the instrument is the lesson. The
affordances carry the theory, so the first pleasing sound is seconds away and
the depth only shows up when you go looking for it.

`HANDOFF.md` is the full brief: who it's for, the design principles, the
playgrounds, the milestone. `DECISIONS.md` records the forks and why each went
the way it did. This file is just how to run the thing.

## Run

```bash
npm install
npm run dev -- --host      # --host serves it on your LAN; open the Network URL on a phone
```

Tap once to start; browsers gate the audio context behind a user gesture. For an
honest read on performance, build and preview rather than trusting the dev
server:

```bash
npm run build && npm run preview -- --host
```

The dev server ships unbundled ES modules and unminified Tone.js. On an
entry-level phone (the target is a Galaxy A16 5G) that parse cost dwarfs
everything else and misleads. Judge speed on the production build.

## What works today

Session and Arrangement views over one song model, with quantized scene launch
and per-clip launch modes (loop or one-shot) plus follow-actions. Four clip
editors (a chord picker, a drum rack, and two piano rolls), each with a
velocity lane. A vertical mixer: fader, pan, reverb and echo sends, live
meters with peak hold, and a device per track that goes deeper than a preset
list. The four preset names are corners of an XY morph pad (tap "sound" on
any strip), with a color slot (crush, phase, trem, wob; drums take crush
only — tape saturation lives on the master bus), amount and
motion knobs, and a per-track sound dice. Drums play real one-shots by
default: four sampled kits (street, warm, dusty, 808) synthesized offline by
`npm run samples` and bundled, morphable on the same pad, with a per-voice
picker that also loads your own WAVs; the synth kit remains as a second bank. The whole space is loudness-matched
by measurement (`npm run calibrate`), so the randomized cold open (key, scale,
tempo, sounds, one magic scene, rerollable anytime with the 🎲 button) changes
the flavor of the song without ever moving the balance of the mix.
Everything melodic ducks under the kick. Arm record and your scene launches
get written into the arrangement as you play. WAV export (master and four
stems) renders through the same signal chain you hear live. Projects save to
a file or to local storage. A global key and scale that everything follows;
change it and the bass and melody re-snap so nothing falls out of key. One-tap
transforms on the piano rolls, undo and redo over whole-song snapshots.

`ROADMAP.md` has what's next and the performance notes.

## Layout

Vite + Tone.js + vanilla DOM/CSS, no framework.

- `src/model.js` — pure data and music theory. No DOM, no Tone.
- `src/audio.js` — the Tone.js graph and the transport.
- `src/main.js` — all UI and interaction.
- `index.html` — the shell and CSS.

`npm run smoke` drives the built app in headless Chrome (via `puppeteer-core`)
and asserts the core flow, including that the transport actually advances, not
just that the play button lights up. `npm run calibrate` renders every device
preset through the real signal chain and prints RMS/peak tables; those numbers
are the ground truth behind the preset gain trims in `src/audio.js`.
