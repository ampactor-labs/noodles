// Drum one-shot generator: renders the bundled sample library to
// public/samples/*.wav. Pure PCM math in Node — no audio context, no network,
// no licensing questions; the samples are ours because we synthesized them.
//
// The whole point over the live synth kit: offline we can afford layering and
// processing that realtime synthesis on a phone cannot — click transients
// phase-aligned over pitch-enveloped subs, modal snare bodies under shaped
// noise, six detuned metallic partials per hat, multi-burst claps — then bake
// the saturation in and normalize. Sixteen one-shots, four kits:
//
//   street  — tight UK-garage register: short punchy kick, crisp snare
//   warm    — funk register: round kick with beater click, fat snare, loose hat
//   dusty   — boom-bap register: saturated and dark, lo-fi noise floor
//   808     — trap register: long gliding sub kick, sharp snare, ticky hat
//
// Usage: node scripts/make-samples.mjs   (writes public/samples/, prints stats)

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const SR = 44100;
const TAU = Math.PI * 2;

// --- tiny DSP toolbox -------------------------------------------------------
const buf = (sec) => new Float32Array(Math.ceil(sec * SR));
const expDecay = (t, tau) => Math.exp(-t / tau);
const tanhDrive = (x, k) => Math.tanh(x * k) / Math.tanh(k);

// Deterministic noise so the library is reproducible build to build.
function makeNoise(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 0xffffffff) * 2 - 1;
  };
}

// One-pole filters, good enough for shaping noise.
function onePoleLP(data, hz) {
  const a = Math.exp((-TAU * hz) / SR);
  let y = 0;
  for (let i = 0; i < data.length; i++) {
    y = a * y + (1 - a) * data[i];
    data[i] = y;
  }
}
function onePoleHP(data, hz) {
  const a = Math.exp((-TAU * hz) / SR);
  let y = 0;
  let x1 = 0;
  for (let i = 0; i < data.length; i++) {
    y = a * (y + data[i] - x1);
    x1 = data[i];
    data[i] = y;
  }
}
function bandpass(data, hz, width) {
  onePoleHP(data, hz - width / 2);
  onePoleLP(data, hz + width / 2);
  onePoleHP(data, hz - width / 2);
  onePoleLP(data, hz + width / 2);
}

function mixInto(dst, src, gain = 1, offsetSec = 0) {
  const off = Math.floor(offsetSec * SR);
  for (let i = 0; i < src.length && i + off < dst.length; i++) dst[i + off] += src[i] * gain;
}

function normalize(data, peakTarget = 0.891) {
  let peak = 0;
  for (const v of data) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) for (let i = 0; i < data.length; i++) data[i] = (data[i] / peak) * peakTarget;
  // Short declick fades at both ends.
  const fade = Math.floor(0.002 * SR);
  for (let i = 0; i < fade; i++) {
    data[i] *= i / fade;
    data[data.length - 1 - i] *= i / fade;
  }
  return data;
}

// --- voices -----------------------------------------------------------------

// Kick: phase-integrated sine sweeping f0 -> f1, click layer, drive.
function kick({ len, f0, f1, pitchTau, ampTau, drive, click, clickHz = 3500, punch = 0 }) {
  const out = buf(len);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const f = f1 + (f0 - f1) * expDecay(t, pitchTau);
    phase += (TAU * f) / SR;
    let v = Math.sin(phase) * expDecay(t, ampTau);
    if (punch) v += Math.sin(phase * 2) * punch * expDecay(t, ampTau * 0.25);
    out[i] = v;
  }
  if (click > 0) {
    const noise = makeNoise(0xbeef);
    const c = buf(0.012);
    for (let i = 0; i < c.length; i++) c[i] = noise() * expDecay(i / SR, 0.0025);
    onePoleHP(c, clickHz);
    mixInto(out, c, click);
  }
  for (let i = 0; i < out.length; i++) out[i] = tanhDrive(out[i], drive);
  return normalize(out);
}

// Snare: two decaying body modes + highpassed noise burst.
function snare({ len, modes, bodyTau, bodyMix, noiseTau, noiseHP, noiseLP = 12000, drive = 1.2, seed = 0xcafe }) {
  const out = buf(len);
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    let body = 0;
    for (const [hz, g] of modes) body += Math.sin(TAU * hz * t) * g;
    out[i] = body * bodyMix * expDecay(t, bodyTau);
  }
  const noise = makeNoise(seed);
  const n = buf(len);
  for (let i = 0; i < n.length; i++) n[i] = noise() * expDecay(i / SR, noiseTau);
  onePoleHP(n, noiseHP);
  onePoleLP(n, noiseLP);
  mixInto(out, n, 1);
  for (let i = 0; i < out.length; i++) out[i] = tanhDrive(out[i], drive);
  return normalize(out);
}

// Hat: six detuned square partials (the 808 recipe), bandpassed, fast decay.
function hat({ len, tau, base = 40, hp = 7000, bp = 10000, seed = 0xfeed, grit = 0 }) {
  const ratios = [2, 3.01, 4.16, 5.43, 6.79, 8.21];
  const out = buf(len);
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    let v = 0;
    for (const r of ratios) v += Math.sign(Math.sin(TAU * base * r * t + r));
    out[i] = (v / ratios.length) * expDecay(t, tau);
  }
  if (grit > 0) {
    const noise = makeNoise(seed);
    for (let i = 0; i < out.length; i++) out[i] += noise() * grit * expDecay(i / SR, tau * 0.7);
  }
  bandpass(out, bp, 8000);
  onePoleHP(out, hp);
  return normalize(out);
}

// Clap: several tight noise bursts, then a longer bandpassed tail.
function clap({ len, bursts, burstTau, tailTau, bp = 1500, width = 1400, seed = 0xd00d, drive = 1.1 }) {
  const out = buf(len);
  const noise = makeNoise(seed);
  for (const [at, gain] of bursts) {
    const b = buf(burstTau * 6);
    for (let i = 0; i < b.length; i++) b[i] = noise() * expDecay(i / SR, burstTau);
    mixInto(out, b, gain, at);
  }
  const tail = buf(len);
  for (let i = 0; i < tail.length; i++) tail[i] = noise() * expDecay(i / SR, tailTau);
  mixInto(out, tail, 0.7, 0.03);
  bandpass(out, bp, width);
  for (let i = 0; i < out.length; i++) out[i] = tanhDrive(out[i], drive);
  return normalize(out);
}

// Dusty post: darken, soften, add a whisper of floor noise.
function dustify(data, { lp = 6500, driveK = 1.6, floor = 0.004, seed = 0xdada }) {
  onePoleLP(data, lp);
  const noise = makeNoise(seed);
  for (let i = 0; i < data.length; i++) {
    data[i] = tanhDrive(data[i], driveK) + noise() * floor * expDecay(i / SR, 0.2);
  }
  return normalize(data);
}

// --- the kits ---------------------------------------------------------------
const KITS = {
  street: {
    kick: () => kick({ len: 0.28, f0: 165, f1: 52, pitchTau: 0.022, ampTau: 0.075, drive: 1.6, click: 0.5, punch: 0.25 }),
    snare: () => snare({ len: 0.22, modes: [[196, 1], [342, 0.6]], bodyTau: 0.035, bodyMix: 0.9, noiseTau: 0.045, noiseHP: 1600, drive: 1.5 }),
    hat: () => hat({ len: 0.09, tau: 0.016, hp: 8200, bp: 10500 }),
    clap: () => clap({ len: 0.28, bursts: [[0, 1], [0.011, 0.9], [0.023, 0.8]], burstTau: 0.006, tailTau: 0.05, bp: 1600 }),
  },
  warm: {
    kick: () => kick({ len: 0.4, f0: 130, f1: 58, pitchTau: 0.035, ampTau: 0.12, drive: 1.25, click: 0.3, clickHz: 2400 }),
    snare: () => snare({ len: 0.32, modes: [[180, 1], [278, 0.75], [405, 0.35]], bodyTau: 0.06, bodyMix: 1.2, noiseTau: 0.08, noiseHP: 900, drive: 1.15, seed: 0xfade }),
    hat: () => hat({ len: 0.14, tau: 0.03, hp: 6800, bp: 9000, grit: 0.15 }),
    clap: () => clap({ len: 0.36, bursts: [[0, 0.9], [0.012, 1], [0.026, 0.85], [0.038, 0.6]], burstTau: 0.008, tailTau: 0.09, bp: 1300, width: 1800, seed: 0xf01c }),
  },
  dusty: {
    kick: () => dustify(kick({ len: 0.34, f0: 120, f1: 48, pitchTau: 0.03, ampTau: 0.1, drive: 1.4, click: 0.2, clickHz: 1800 }), { lp: 3800, driveK: 2.2 }),
    snare: () => dustify(snare({ len: 0.26, modes: [[172, 1], [301, 0.5]], bodyTau: 0.045, bodyMix: 1, noiseTau: 0.06, noiseHP: 1100, noiseLP: 6500, seed: 0xb00c }), { lp: 5200, driveK: 1.9 }),
    hat: () => dustify(hat({ len: 0.11, tau: 0.022, hp: 5800, bp: 8000, grit: 0.25 }), { lp: 8500, driveK: 1.3, floor: 0.002 }),
    clap: () => dustify(clap({ len: 0.3, bursts: [[0, 1], [0.013, 0.85], [0.028, 0.7]], burstTau: 0.007, tailTau: 0.07, bp: 1150, seed: 0xdead }), { lp: 4800, driveK: 1.8 }),
  },
  "808": {
    kick: () => kick({ len: 1.05, f0: 96, f1: 39, pitchTau: 0.05, ampTau: 0.42, drive: 2.4, click: 0.35, clickHz: 3000, punch: 0.18 }),
    snare: () => snare({ len: 0.24, modes: [[210, 1], [372, 0.7]], bodyTau: 0.028, bodyMix: 0.75, noiseTau: 0.05, noiseHP: 2400, drive: 1.8, seed: 0xace5 }),
    hat: () => hat({ len: 0.07, tau: 0.011, hp: 9000, bp: 11500 }),
    clap: () => clap({ len: 0.32, bursts: [[0, 1], [0.009, 0.95], [0.019, 0.85], [0.03, 0.65]], burstTau: 0.005, tailTau: 0.075, bp: 1750, drive: 1.5, seed: 0x8088 }),
  },
};

// --- WAV writer (mono 16-bit) ----------------------------------------------
function wav(data) {
  const n = data.length;
  const out = Buffer.alloc(44 + n * 2);
  out.write("RIFF", 0);
  out.writeUInt32LE(36 + n * 2, 4);
  out.write("WAVE", 8);
  out.write("fmt ", 12);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(SR, 24);
  out.writeUInt32LE(SR * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36);
  out.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, data[i]));
    out.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), 44 + i * 2);
  }
  return out;
}

const dir = path.join(process.cwd(), "public", "samples");
await mkdir(dir, { recursive: true });
let total = 0;
for (const [kitName, voices] of Object.entries(KITS)) {
  for (const [voice, make] of Object.entries(voices)) {
    const data = make();
    const bytes = wav(data);
    const file = `${kitName}-${voice}.wav`;
    await writeFile(path.join(dir, file), bytes);
    total += bytes.length;
    let rms = 0;
    for (const v of data) rms += v * v;
    rms = Math.round(10 * Math.log10(rms / data.length) * 10) / 10;
    console.log(`${file.padEnd(18)} ${(bytes.length / 1024).toFixed(0).padStart(4)} KB  rms ${rms} dB`);
  }
}
console.log(`total ${(total / 1024).toFixed(0)} KB`);
