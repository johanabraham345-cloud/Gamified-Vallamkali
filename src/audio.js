// All sounds are synthesized in the browser (no files to download):
// drum on every beat, air horn at GO, whoosh on SYNC, and a crowd that swells when the race is close.
// Browsers only allow sound after a click, so init() is called from a click.

let ctx = null;
let master, fx, crowdGain, crowdFilter;   // fx = drums/crowd/horn bus (dips while the commentator talks)
let muted = false;

function noiseBuffer(seconds, brown = false) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
  }
  return buf;
}

// Create the audio system early (it stays silent/suspended until a click), so the commentary
// clips can download and decode while people are joining.
export function prepare() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  setup();
}

export function init() {
  if (!ctx) prepare();
  ctx?.resume();
}

function setup() {
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.8;
  master.connect(ctx.destination);
  fx = ctx.createGain();
  fx.connect(master);

  // Crowd: looping brown noise through a band-pass filter = distant crowd murmur.
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(3, true);
  src.loop = true;
  crowdFilter = ctx.createBiquadFilter();
  crowdFilter.type = 'bandpass';
  crowdFilter.frequency.value = 600;
  crowdFilter.Q.value = 0.5;
  crowdGain = ctx.createGain();
  crowdGain.gain.value = 0;
  src.connect(crowdFilter).connect(crowdGain).connect(fx);
  src.start();
}

// Chenda-style drum hit: a pitched thump plus a stick "crack".
export function drum(accent = false) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.setValueAtTime(accent ? 150 : 115, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.25);
  g.gain.setValueAtTime(accent ? 1.0 : 0.65, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
  o.connect(g).connect(fx);
  o.start(t);
  o.stop(t + 0.4);

  const n = ctx.createBufferSource();
  n.buffer = noiseBuffer(0.1);
  const f = ctx.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = 1800;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(accent ? 0.55 : 0.3, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
  n.connect(f).connect(ng).connect(fx);
  n.start(t);
}

// Air horn at GO.
export function horn() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.35, t + 0.05);
  g.gain.setValueAtTime(0.35, t + 0.9);
  g.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2200;
  lp.connect(g).connect(fx);
  for (const freq of [233, 294, 349]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    o.connect(lp);
    o.start(t);
    o.stop(t + 1.35);
  }
  roar(0.6);
}

// Whoosh when a team hits SYNC.
export function whoosh() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const n = ctx.createBufferSource();
  n.buffer = noiseBuffer(0.5);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 2;
  f.frequency.setValueAtTime(400, t);
  f.frequency.exponentialRampToValueAtTime(3000, t + 0.35);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.5, t + 0.08);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
  n.connect(f).connect(g).connect(fx);
  n.start(t);
}

// Crowd level 0..1 (smoothly follows the value).
let crowdLevel = 0;
export function setCrowd(level) {
  if (!ctx || Math.abs(level - crowdLevel) < 0.01) return;
  crowdLevel = level;
  crowdGain.gain.setTargetAtTime(level * 0.55, ctx.currentTime, 0.5);
  crowdFilter.frequency.setTargetAtTime(450 + level * 900, ctx.currentTime, 0.5);
}

// A burst of crowd noise (finish line, GO).
export function roar(amount = 1) {
  if (!ctx) return;
  const t = ctx.currentTime;
  crowdGain.gain.cancelScheduledValues(t);
  crowdGain.gain.setTargetAtTime(0.9 * amount, t, 0.05);
  crowdGain.gain.setTargetAtTime(crowdLevel * 0.55, t + 1.5, 0.8);
}

export function toggleMute() {
  muted = !muted;
  if (master) master.gain.setTargetAtTime(muted ? 0 : 0.8, ctx.currentTime, 0.05);
}
export const isMuted = () => muted;

// For the commentator (commentary.js): the audio context, where voices go, and "ducking".
export const getContext = () => ctx;
export const getVoiceOutput = () => master;
export function duck(on) {
  if (!ctx) return;
  fx.gain.setTargetAtTime(on ? 0.35 : 1, ctx.currentTime, on ? 0.08 : 0.4);
}
