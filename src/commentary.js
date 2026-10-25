// Malayalam commentary. Clips live in /public/commentary and play on race events:
//   start            -> when the race intro begins
//   <team>_lead      -> a team takes the lead
//   <team>_300/_600  -> the team that reaches 300 m / 600 m first
//   <team>_near_finish -> the team that first gets within 100 m of the finish
//   <team>_finish    -> the winner crosses the line
//   hype_1..8        -> random hype between 300 m and the last 100 m
//
// Only one clip plays at a time. More important clips interrupt less important ones
// (finish > milestone > start/lead > hype). Drums and crowd dip while the commentator talks.
import * as audio from './audio.js';
import { RACE_LENGTH } from './config.js';

const TEAM_KEY = ['red', 'blue'];
const HYPE_COUNT = 8;
const FILES = [
  'start',
  ...TEAM_KEY.flatMap((t) => ['lead', '300', '600', 'near_finish', 'finish'].map((e) => `${t}_${e}`)),
  ...Array.from({ length: HYPE_COUNT }, (_, i) => `hype_${i + 1}`),
];

// Tunables
const PRIORITY = { finish: 4, milestone: 3, start: 2, lead: 2, hype: 1 };
const LEAD_HOLD_MS = 1500;      // a lead must be held this long before it's called
const LEAD_MIN_GAP_M = 1.5;     // ...and be at least this big
const LEAD_COOLDOWN_MS = 9000;  // minimum time between two lead calls
const PENDING_MS = 3500;        // a call that had to wait is dropped if it can't play within this
const HYPE_FROM = 300, HYPE_TO = RACE_LENGTH - 100;
const NEAR_FINISH_AT = RACE_LENGTH - 100;

const buffers = new Map();
let loading = null;

function load() {
  const ctx = audio.getContext();
  if (!ctx || loading) return loading;
  const one = async (name) => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}commentary/${name}.mp3`);
      buffers.set(name, await ctx.decodeAudioData(await res.arrayBuffer()));
    } catch (e) { console.warn(`commentary: couldn't load ${name}.mp3`, e); }
  };
  // The start clip first (it's needed first), then the rest.
  loading = one('start').then(() => Promise.all(FILES.filter((f) => f !== 'start').map(one)));
  return loading;
}

// ---------- Playback ----------
let current = null;       // { src, gain, priority, name }
let pending = null;       // { name, priority, expires, valid() }
let lastEndedAt = 0;

function stopCurrent(fadeSec = 0.25) {
  if (!current) return;
  const ctx = audio.getContext();
  const { src, gain } = current;
  gain.gain.setTargetAtTime(0, ctx.currentTime, fadeSec / 3);
  try { src.stop(ctx.currentTime + fadeSec); } catch { /* already stopped */ }
  src.onended = null;
  current = null;
}

function play(name, priority) {
  const ctx = audio.getContext();
  const buf = buffers.get(name);
  if (!ctx || !buf) return false;
  stopCurrent();
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  gain.gain.value = 1.15;
  src.connect(gain).connect(audio.getVoiceOutput());
  src.start();
  const me = { src, gain, priority, name };
  (window.vkCommentaryLog ||= []).push({ name, at: Math.round(performance.now()) }); // debug: type vkCommentaryLog in console
  current = me;
  audio.duck(true);
  src.onended = () => {
    if (current === me) { current = null; lastEndedAt = performance.now(); audio.duck(false); }
  };
  return true;
}

// Ask for a clip. Plays now if it's more important than what's playing, otherwise waits briefly.
function request(name, kind, valid = () => true, onDrop = () => {}) {
  const priority = PRIORITY[kind];
  const ready = buffers.has(name);
  if (ready && (!current || priority > current.priority)) { play(name, priority); return; }
  if (!ready) {                               // still downloading: wait for it (a bit longer than usual)
    pending?.onDrop();
    pending = { name, priority, expires: performance.now() + 8000, valid, onDrop };
    return;
  }
  if (!pending || priority >= pending.priority) {
    pending?.onDrop();
    pending = { name, priority, expires: performance.now() + PENDING_MS, valid, onDrop };
  } else onDrop();
}

export const preload = () => load();

// ---------- Race logic ----------
let state = null;
function resetRace() {
  state = {
    leader: null, leaderSince: 0, calledLeader: null, lastLeadCallAt: -1e9,
    milestones: new Set(), finishCalled: false, hypeBag: [], nextHypeAt: 0, started: false,
  };
}
resetRace();

function nextHype() {
  if (!state.hypeBag.length) {
    state.hypeBag = Array.from({ length: HYPE_COUNT }, (_, i) => `hype_${i + 1}`).sort(() => Math.random() - 0.5);
  }
  return state.hypeBag.pop();
}

export function onRaceStart() {
  load();
  stopCurrent(0.1);
  pending = null;
  resetRace();
  state.started = true;
  request('start', 'start');
}

export function onLobby() {
  stopCurrent(0.4);
  pending = null;
  resetRace();
  audio.duck(false);
}

// Call every frame from the host.
export function update(game) {
  if (!audio.getContext()) return;
  load();
  const now = performance.now();

  // Waiting call: play it when the line is free, if it's still true and not too old.
  if (pending && now < pending.expires && !pending.valid()) { pending.onDrop(); pending = null; }
  if (pending && !current && buffers.has(pending.name) && now < pending.expires) {
    play(pending.name, pending.priority);
    pending = null;
  } else if (pending && now >= pending.expires) {
    pending.onDrop();
    pending = null;
  }

  if (game.phase === 'finished' && game.winner != null && !state.finishCalled) {
    state.finishCalled = true;
    pending?.onDrop();
    pending = null;
    request(`${TEAM_KEY[game.winner]}_finish`, 'finish');
    return;
  }
  if (game.phase !== 'race') return;

  const [r, b] = game.boats;
  const leadX = Math.max(r.x, b.x);
  const leader = Math.abs(r.x - b.x) < LEAD_MIN_GAP_M ? null : (r.x > b.x ? 0 : 1);

  // Milestones: whoever gets there first.
  for (const [mark, key] of [[300, '300'], [600, '600'], [NEAR_FINISH_AT, 'near_finish']]) {
    if (leadX >= mark && !state.milestones.has(key)) {
      state.milestones.add(key);
      const first = r.x >= b.x ? 0 : 1;
      request(`${TEAM_KEY[first]}_${key}`, 'milestone');
      state.calledLeader = first;                  // milestone clips already say who's leading
      state.lastLeadCallAt = now;
    }
  }

  // Lead changes.
  if (leader !== state.leader) { state.leader = leader; state.leaderSince = now; }
  if (leader != null && leader !== state.calledLeader
      && now - state.leaderSince > LEAD_HOLD_MS && now - state.lastLeadCallAt > LEAD_COOLDOWN_MS) {
    state.calledLeader = leader;
    state.lastLeadCallAt = now;
    const team = leader;
    // If this call couldn't be made in time, allow it to be called again later.
    request(`${TEAM_KEY[team]}_lead`, 'lead', () => state.leader === team, () => {
      if (state.calledLeader === team) { state.calledLeader = null; state.lastLeadCallAt = now - LEAD_COOLDOWN_MS + 2000; }
    });
  }

  // Hype in the middle of the race, with short pauses between clips.
  if (leadX >= HYPE_FROM && leadX < HYPE_TO && !current && !pending && now - lastEndedAt > 1200 && now > state.nextHypeAt) {
    request(nextHype(), 'hype');
    state.nextHypeAt = now + 1500 + Math.random() * 1500;
  }
}
