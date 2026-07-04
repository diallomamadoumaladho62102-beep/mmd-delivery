/**
 * MMD Signature Collection — 16 original premium sounds.
 * Output: apps/mobile/assets/sounds/ + apps/web/public/sounds/
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const MOBILE_OUT = path.join(ROOT, "apps/mobile/assets/sounds");
const WEB_OUT = path.join(ROOT, "apps/web/public/sounds");
const BACKUP = path.join(ROOT, "docs/audio-backup/legacy-sounds");
const SAMPLE_RATE = 44100;

const SR = SAMPLE_RATE;

function writeWav(filePath, samples) {
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(SR, 24);
  buffer.writeUInt32LE(SR * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buffer);
}

function buf(sec) {
  return new Float32Array(Math.ceil(sec * SR));
}

function smoothstep(x) {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

function easeInQuad(x) {
  const t = Math.max(0, Math.min(1, x));
  return t * t;
}

function adsr(t, a, d, s, r, dur) {
  if (t < a) return t / a;
  if (t < a + d) return 1 - ((t - a) / d) * (1 - s);
  if (t < dur - r) return s;
  if (t < dur) return s * (1 - (t - (dur - r)) / r);
  return 0;
}

function tone(b, start, freq, dur, opts = {}) {
  const {
    attack = 0.05,
    decay = 0.35,
    sustain = 0.22,
    release = 0.75,
    gain = 0.28,
    harmonics = [1, 0.3, 0.12, 0.04],
    vibrato = 0,
  } = opts;
  const s0 = Math.floor(start * SR);
  const len = Math.floor(dur * SR);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const env = adsr(t, attack, decay, sustain, release, dur);
    const f = freq * (1 + vibrato * Math.sin(2 * Math.PI * 5 * t));
    let sample = 0;
    harmonics.forEach((h, idx) => {
      sample += h * Math.sin((2 * Math.PI * f * (idx + 1) * t) / 1);
    });
    const idx = s0 + i;
    if (idx >= 0 && idx < b.length) b[idx] += sample * env * gain;
  }
}

function marimba(b, start, freq, dur, gain) {
  const s0 = Math.floor(start * SR);
  const len = Math.floor(dur * SR);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const env = Math.exp(-t * 8) * (1 - Math.exp(-t * 100));
    let s = 0;
    [1, 0.4, 0.16].forEach((h, idx) => {
      s += h * Math.sin(2 * Math.PI * freq * (idx + 1) * t);
    });
    const idx = s0 + i;
    if (idx >= 0 && idx < b.length) b[idx] += s * env * gain;
  }
}

function signatureArc(b, start, intensity, richness) {
  const phi = 0.618;
  const times = [0, 0.14, 0.14 + phi * 0.22, 0.14 + phi * 0.38];
  const notes = [392.0, 493.88, 587.33, 783.99];
  const h = (base) => [1, base * richness, base * 0.4 * richness, base * 0.17 * richness];
  times.forEach((off, i) => {
    tone(b, start + off, notes[i], 1.05, {
      attack: 0.05 + i * 0.01,
      decay: 0.38,
      sustain: 0.22,
      release: 0.85,
      gain: (0.26 - i * 0.02) * intensity,
      harmonics: h(0.35),
    });
  });
  if (richness > 0.55) marimba(b, start + 0.72, 1046.5, 0.65, 0.2 * intensity);
}

function echo(b, delay, fb = 0.18, mix = 0.22) {
  const d = Math.floor(delay * SR);
  const out = new Float32Array(b.length);
  for (let i = 0; i < b.length; i++) {
    const wet = i >= d ? b[i - d] * fb : 0;
    out[i] = b[i] * (1 - mix * 0.4) + (b[i] + wet) * mix;
  }
  return out;
}

function limit(b, peak = 0.9) {
  let max = 0;
  for (const v of b) max = Math.max(max, Math.abs(v));
  if (max <= peak || max === 0) return b;
  return b.map((v) => (v * peak) / max);
}

function buildLong(totalSec, interval, profile) {
  const b = buf(totalSec);
  const starts = [];
  for (let t = 0; t < totalSec - 2.2; t += interval) starts.push(t);
  const n = starts.length;
  starts.forEach((start, idx) => {
    const p = n <= 1 ? 1 : easeInQuad(idx / (n - 1));
    const intensity = profile.minI + (profile.maxI - profile.minI) * smoothstep(p);
    const richness = 0.42 + 0.58 * p;
    signatureArc(b, start, intensity, richness);
  });
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    const g = profile.minG + (profile.maxG - profile.minG) * smoothstep(t / totalSec);
    const fi = smoothstep(t / profile.fadeIn);
    const fo = t > totalSec - profile.fadeOut ? smoothstep((totalSec - t) / profile.fadeOut) : 1;
    b[i] *= g * fi * fo;
  }
  return limit(echo(echo(b, 0.1, 0.18, 0.2), 0.17, 0.12, 0.16));
}

function buildShort(name, durSec, buildFn) {
  const b = buf(durSec);
  buildFn(b);
  return limit(echo(b, 0.08, 0.15, 0.18));
}

const shorts = {
  "mmd_signature_client.wav": () =>
    buildShort("client", 3.2, (b) => {
      signatureArc(b, 0.08, 0.85, 0.95);
      tone(b, 0.55, 1046.5, 1.2, { gain: 0.22, release: 0.9, harmonics: [1, 0.2, 0.08] });
    }),
  "mmd_chat_notification.wav": () =>
    buildShort("chat", 0.55, (b) => {
      marimba(b, 0.02, 880, 0.45, 0.32);
    }),
  "mmd_payment_success.wav": () =>
    buildShort("pay_ok", 1.35, (b) => {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => marimba(b, i * 0.1, f, 0.5, 0.38));
    }),
  "mmd_payment_failed.wav": () =>
    buildShort("pay_fail", 1.1, (b) => {
      tone(b, 0.05, 349.23, 0.7, { gain: 0.35, decay: 0.25, release: 0.5, harmonics: [1, 0.15] });
      tone(b, 0.35, 293.66, 0.65, { gain: 0.28, decay: 0.22, release: 0.45, harmonics: [1, 0.12] });
    }),
  "mmd_success.wav": () =>
    buildShort("success", 0.95, (b) => {
      marimba(b, 0.02, 659.25, 0.55, 0.42);
      marimba(b, 0.18, 880, 0.45, 0.35);
    }),
  "mmd_error.wav": () =>
    buildShort("error", 0.85, (b) => {
      tone(b, 0.04, 220, 0.65, { gain: 0.32, attack: 0.008, decay: 0.2, release: 0.4, harmonics: [1, 0.08] });
    }),
  "mmd_warning.wav": () =>
    buildShort("warning", 1.05, (b) => {
      tone(b, 0.02, 740, 0.22, { gain: 0.38, attack: 0.002, decay: 0.08, release: 0.1, harmonics: [1] });
      tone(b, 0.28, 622, 0.28, { gain: 0.34, attack: 0.002, decay: 0.1, release: 0.12, harmonics: [1] });
    }),
  "mmd_promo.wav": () =>
    buildShort("promo", 1.55, (b) => {
      [587.33, 739.99, 880, 1174.66].forEach((f, i) => marimba(b, i * 0.12, f, 0.48, 0.34));
    }),
  "mmd_reward.wav": () =>
    buildShort("reward", 1.85, (b) => {
      tone(b, 0.05, 261.63, 1.4, { gain: 0.18, attack: 0.12, sustain: 0.4, release: 0.8, harmonics: [1, 0.25, 0.1] });
      [880, 1046.5, 1318.5].forEach((f, i) => marimba(b, 0.25 + i * 0.14, f, 0.55, 0.3));
    }),
  "mmd_system_notification.wav": () =>
    buildShort("system", 0.65, (b) => {
      marimba(b, 0.03, 698.46, 0.42, 0.28);
    }),
  "mmd_ride_accepted.wav": () =>
    buildShort("ride", 1.25, (b) => {
      tone(b, 0, 880, 0.16, { gain: 0.48, attack: 0.001, decay: 0.05, release: 0.08, harmonics: [1, 0.1] });
      tone(b, 0.12, 1174.66, 0.24, { gain: 0.52, attack: 0.001, decay: 0.06, release: 0.12, harmonics: [1, 0.15] });
    }),
  "mmd_order_accepted.wav": () =>
    buildShort("order_ok", 1.45, (b) => {
      signatureArc(b, 0.04, 0.72, 0.85);
    }),
  "mmd_driver_arrived.wav": () =>
    buildShort("arrived", 2.6, (b) => {
      tone(b, 0.06, 196, 1.5, { gain: 0.2, attack: 0.2, sustain: 0.35, release: 0.9, harmonics: [1, 0.2, 0.08] });
      tone(b, 0.28, 783.99, 1.1, { gain: 0.32, attack: 0.06, release: 0.7, harmonics: [1, 0.25, 0.1] });
      marimba(b, 0.55, 987.77, 0.7, 0.28);
    }),
  "mmd_delivery_completed.wav": () =>
    buildShort("delivered", 2.1, (b) => {
      [523.25, 659.25, 783.99].forEach((f, i) => marimba(b, i * 0.15, f, 0.65, 0.36));
      tone(b, 0.55, 1046.5, 1.0, { gain: 0.26, release: 0.85, harmonics: [1, 0.18, 0.06] });
    }),
};

const driverProfile = {
  minI: 0.33,
  maxI: 1.0,
  minG: 0.4,
  maxG: 1.0,
  fadeIn: 2.5,
  fadeOut: 1.1,
};
const restaurantProfile = {
  minI: 0.27,
  maxI: 0.9,
  minG: 0.36,
  maxG: 0.93,
  fadeIn: 4.2,
  fadeOut: 2.0,
};

function backupLegacy() {
  fs.mkdirSync(BACKUP, { recursive: true });
  const legacy = [
    path.join(MOBILE_OUT, "new_order.wav"),
    path.join(WEB_OUT, "notify.mp3"),
    path.join(WEB_OUT, "notify.wav"),
    path.join(ROOT, "apps/web/public/notify.mp3"),
    path.join(ROOT, "android/app/src/main/res/raw/new_order.wav"),
  ];
  for (const src of legacy) {
    if (!fs.existsSync(src)) continue;
    const dest = path.join(BACKUP, path.basename(src));
    if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
    console.log(`  backed up ${path.basename(src)}`);
  }
}

function deploy(fileName, samples) {
  writeWav(path.join(MOBILE_OUT, fileName), samples);
  writeWav(path.join(WEB_OUT, fileName), samples);
}

console.log("Backing up legacy sounds...");
backupLegacy();

console.log("\nGenerating MMD Signature Collection...");
deploy(
  "mmd_signature_driver_60s.wav",
  buildLong(60, 3.25, driverProfile),
);
deploy(
  "mmd_signature_restaurant_120s.wav",
  buildLong(120, 4.05, restaurantProfile),
);

for (const [fileName, build] of Object.entries(shorts)) {
  deploy(fileName, build());
  console.log(`  ✓ ${fileName}`);
}

console.log(`\nDone — ${Object.keys(shorts).length + 2} files in mobile + web sounds.`);
