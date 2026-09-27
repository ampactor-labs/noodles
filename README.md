# Noodles

A music-making app for phones that snaps every note you draw to the song's key
and plays loops from a clip grid, one row per song section. It borrows the
interaction model of Ableton Live, a DAW (digital audio workstation), with far
fewer controls. Each load generates a new four-bar song in a random key and
tempo, so one tap on play makes music. It is plain JavaScript on Tone.js and
Vite, and installs as a web app that works offline.

**Status: working.** The project file format may still change, and audio timing
depends on the phone's browser.

Live: https://ampactor.dev/noodles/

## Quick start

```bash
npm install              # needs Node.js 20 or newer
npm run dev -- --host
```

`--host` also serves the app on your local network. Open the printed Network
URL (it ends in `/noodles/`) on a phone on the same Wi-Fi. You should see four
tracks (Harmony, Drums, Bass, Melody) holding a song generated on load. Tap ▶:
browsers keep audio off until the first tap, so that tap starts the sound
engine and plays the song. 🎲 generates another one, and ↶ takes it back.

Judge speed on the production build. The dev server ships unbundled modules
and unminified Tone.js, and the target phone (a Galaxy A16 5G, an entry-level
Android) parses them slowly enough to make the app look slower than it is:

```bash
npm run build && npm run preview -- --host
```

## How it works

`main.js` draws every screen with plain DOM and turns gestures into edits of one
song object, which `model.js` defines along with the music theory. `audio.js`
builds the Web Audio graph and runs one 16th-note clock that reads the song live
and schedules its notes; the same clock moves the UI's playhead. A song holds
tempo, key, scale, scenes (rows of the clip grid, one clip per track) and an
arrangement (clips on a timeline).

### Decisions that shaped it

**The theory lives in the controls.** The app is scale-aware: it knows the
song's key and scale, and every surface that makes notes snaps to them by
default. Chords are stored as scale degrees (I, ii, V and so on), so a key
change moves every chord with it, and bass and melody are transposed and
re-snapped. Chords borrowed from outside the key are stored as notes, transposed
like the bass, and drawn in violet ([DECISIONS.md](DECISIONS.md) D13). Chords in
the key are colored by their role, and names and explanations wait until you
ask: hold a wedge or open the ? page ([HANDOFF.md](HANDOFF.md) §2).

**One signal chain, built from native nodes.** `buildGraph()` in `audio.js` is
the only place the signal chain exists. Live playback and the WAV export both
call it, so an export sounds like what you heard (D20). Tone.js keeps the
transport, the clock and thin wrappers around native nodes. Voices, filters and
effects are built from native Web Audio nodes, because Tone.js's own voices and
filters cost audio-thread time even when idle. The switch cut the opening song's
render cost from 278 to between 76 and 87 ms per second of playback on a desktop
Xeon core (D31, measured with `npm run probe:render`).

### What works today

- **Session and Arrangement views.** A scene's ▶ launches its row on the next
  bar, and a clip can loop, play once or hand off to another scene (a follow
  action). On the Arrangement timeline clips move, resize, split and
  duplicate, and ● record writes your scene launches and mutes into it.
- **Editors:** a drum rack and piano rolls for bass and melody, with a lane
  for how hard each note hits and one-tap transforms, plus a chord editor built
  on a playable circle of fifths (the twelve keys in a ring where neighbors
  share six of their seven notes). Dragging the rim changes the song's key.
- **Sound:** per track, a square pad blends four preset sounds, one per corner
  and all trimmed to one measured loudness, plus one color effect. Drums switch
  between four sampled kits and a synthesized bank, and any drum can load a WAV
  or record the microphone. Pad and knob moves can be recorded as automation.
- **Mixer:** level, pan, reverb and echo amounts, and meters per track, plus a
  four-knob master bus. Melodic tracks dip on each kick (sidechain ducking).
- **Dice (🎲):** a new key, scale, tempo, groove, sounds and effect levels as
  a four-bar phrase. Undo holds 40 whole-session snapshots, so ↶ undoes a roll.
- **Files:** save a `.noodles` project to a file or the device, import `.mid`
  files, and export WAV (the full mix, one file per track, or the loop) or a
  PNG of the chords engraved on a staff.

## Project layout

```text
src/model.js    song data and music theory: no DOM, no audio
src/audio.js    the audio graph, the transport and offline rendering
src/main.js     every screen and gesture
src/circle.js   the circle of fifths
src/midi.js     .mid import
index.html      the page shell and all CSS
scripts/        headless harnesses, probes, and the sample and icon generators
public/         the 24 bundled drum samples and the app icons
```

[HANDOFF.md](HANDOFF.md) is the original brief and design principles; the build
later took the literal mobile-Ableton route in place of its first milestone.
[DECISIONS.md](DECISIONS.md) records each fork and why, [AGENTS.md](AGENTS.md)
describes the code as it is now and keeps the full feature list, and
[ROADMAP.md](ROADMAP.md) tracks what is next. The DESIGN-*.md files and
[RESEARCH_FINDINGS.md](RESEARCH_FINDINGS.md) hold feature notes and research.

## Deploy

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) runs on every
push to `main`: `npm ci` on Node 20, then `npm run build`, then `dist/` goes to
GitHub Pages, which serves it at https://ampactor.dev/noodles/. Vite builds for
the `/noodles/` path and stamps the version and commit onto the ? page.

The build is a PWA (progressive web app, a site the browser can install). Its
service worker precaches the whole app with the drum samples (`npm run build`
reports 36 precache entries, 1241 KiB), so an installed copy starts offline. A
new deploy downloads in the background and takes over only if you have not
played or edited anything yet; otherwise the ? page offers a restart.

## Testing

There is no unit test suite. The checks are Node scripts that drive the
production build in headless Chrome through `puppeteer-core` 25, which needs
Node.js 22.12 or newer. Each serves the existing `dist/` folder, so build first:

```bash
npm run build
npm run smoke
npm run calibrate
npm run audit
```

They launch `/usr/bin/google-chrome`; `CHROME_BIN` names another Chrome or
Chromium, and `SMOKE_PORT` moves the local server off its default port.

- `npm run smoke` (about a minute) taps through every editor, the circle of
  fifths, the mixer and sound sheets, session record, the exports, the dice
  and undo on a phone-sized touch screen. It checks that the transport actually
  advances and that a roll undoes whole. Any page error, or an audio voice that
  outlives a stop, fails it.
- `npm run calibrate` (about three minutes) renders every preset, pad position
  and color effect through the real graph and prints level tables. It fails only
  on page errors. Read each track's spread against the master row (six fixed
  sound combinations), which should stay near 1 dB; it reads 1 dB on the current
  code.
- `npm run audit` (under a minute) measures the master chain against its own
  constants, from hidden compressor gain and bus timing to loudness in LUFS (the
  broadcast loudness unit) and true peak (the level between samples). It prints
  how many checks failed but exits 0 unless the page errors; `-- --program`
  keeps only the meter self-test and the loudness rows.
- `npm run probe:render` traces the audio thread's render time on seeded songs,
  and `npm run probe:music` generates 4000 seeded songs and measures their
  notes. Both print evidence and assert nothing.

CI runs none of these: the deploy workflow only installs and builds, so a
regression surfaces only when someone runs the scripts. The smoke test waits
fixed times for animations, so a slow or busy machine can fail it at the
circle-of-fifths step. Nothing tests timing or sound on a phone, because
headless Chrome cannot listen and a phone's audio core is roughly three to four
times slower than a desktop's (D31).

## Limitations

Timing depends on the browser. Tone.js schedules notes a quarter second ahead
from the page's main thread, which is not a real-time thread, so a stall on
that thread longer than a quarter second is an audible gap. On an entry-level
phone the audio thread can also miss its deadline of 2.67 ms per block of
samples and crackle.

- Playback stops when the page is hidden. Locking the screen or switching apps
  stops the song, so a backing track needs the screen on.
- There is no tempo sync (keeping several devices on one shared tempo) with
  other gear. Ableton Link, the usual way to do it, needs UDP multicast on the
  local network, which browsers do not allow (DECISIONS.md D1).
- Desktop works but was designed for a thumb. The space bar toggles play, and
  there are no other global keyboard shortcuts.
- Your own samples (loaded WAVs, microphone takes) stay in that browser's
  storage. A project file names them but does not carry the audio.
- There is no MIDI export and no time-stretching. Samples loaded on the melody
  track are sliced and repitched instead (D6).
- Rolls on the four sampled kits are loud and dense: a 24-roll audit found 15
  pressed against the output limit, under 6 dB between peak and short-term
  loudness (D26). Nothing clips, and whether to turn them down is still open.
- There is no lesson mode or scoring, by design. The ? page is the only guide,
  and it opens only when you ask.

## Roadmap

- MIDI export, so a sketch can move into a full DAW. HANDOFF.md asks for it,
  and ROADMAP.md lists it as a follow-up that is not scheduled yet.
- Rolled form: the dice would set follow actions so sections play in order.
  It is deferred because it changes how scenes launch by default.
- Tempo sync over Ableton Link. It needs a native build or a small native
  helper, since a browser cannot join a Link session.

## License

No license chosen yet.
