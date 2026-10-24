// LAPTOP / BIG SCREEN. This page IS the game server: it owns the room, seats players,
// scores every stroke, moves the boats and tells phones what's happening.
import './style.css';
import QRCode from 'qrcode';
import { supabase, configOk, showConfigError, localNow, LOBBY_CHANNEL, roomChannelName } from './net.js';
import {
  MAX_PER_TEAM, RACE_LENGTH, TEAMS, TEMPO, COUNTDOWN_MS, PERFECT_MS, MAX_ERR_MS,
  SYNC_SPREAD_MS, NET_GRACE_MS, STROKE_POWER, DRAG,
} from './config.js';
import { createRaceScene } from './scene.js';

const $ = (id) => document.getElementById(id);

if (!configOk) {
  showConfigError();
  throw new Error('Supabase config missing');
}

// ---------- Room code ----------
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L confusion
const code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const joinUrl = `${location.origin}/play.html?room=${code}`;
$('code').textContent = code;
$('joinUrl').textContent = joinUrl;
QRCode.toCanvas($('qr'), joinUrl, { width: 160, margin: 1 });

const scene = createRaceScene($('stage'));

// ---------- Game state ----------
const newBoat = () => ({ x: 0, v: 0, rhythm: 0, log: new Map() });
const game = {
  phase: 'lobby',          // lobby | countdown | race | finished
  isPublic: true,
  players: new Map(),      // id -> { id, name, team, seat, q, strokeAt, lastBeat, bot }
  boats: [newBoat(), newBoat()],
  bpm: TEMPO[0].bpm,
  anchor: 0,               // host time of beat number `beatBase`
  beatBase: 0,
  startAt: 0,
  winner: null,
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const teamPlayers = (team) => [...game.players.values()].filter((p) => p.team === team);

// ---------- Seating ----------
function seatPlayer(p) {
  const counts = [teamPlayers(0).length, teamPlayers(1).length];
  let team = counts[0] <= counts[1] ? 0 : 1;
  if (counts[team] >= MAX_PER_TEAM) team = 1 - team;
  if (counts[team] >= MAX_PER_TEAM) { p.team = null; p.seat = null; return; } // room full
  const used = new Set(teamPlayers(team).map((x) => x.seat));
  let seat = 0;
  while (used.has(seat)) seat++;
  p.team = team;
  p.seat = seat;
}

function addPlayer(id, name, bot = false) {
  const p = { id, name: (name || 'Rower').slice(0, 12), team: null, seat: null, q: 0, strokeAt: 0, lastBeat: -1, bot };
  if (bot) p.jitter = 0;
  seatPlayer(p);
  game.players.set(id, p);
}

function rosterChanged() {
  scene.setRoster([...game.players.values()]);
  for (const t of [0, 1]) {
    $(`team${t}`).innerHTML = teamPlayers(t)
      .sort((a, b) => a.seat - b.seat)
      .map((p) => `<li>${escapeHtml(p.name)}${p.bot ? ' 🤖' : ''}</li>`)
      .join('');
  }
  updateLobbyPresence();
}

const escapeHtml = (s) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

// ---------- Beats ----------
const beatInterval = () => 60000 / game.bpm;

function nearestBeat(t) {
  const iv = beatInterval();
  const n = Math.max(0, Math.round((t - game.anchor) / iv));
  return { idx: game.beatBase + n, time: game.anchor + n * iv, iv };
}

// Change tempo on the next beat so the rhythm never "jumps".
function setTempo(bpm) {
  if (bpm === game.bpm) return;
  const iv = beatInterval();
  const n = Math.max(0, Math.ceil((localNow() - game.anchor) / iv));
  game.anchor += n * iv;
  game.beatBase += n;
  game.bpm = bpm;
}

// ---------- Strokes ----------
function handleStroke(id, t) {
  if (game.phase !== 'race') return;
  const p = game.players.get(id);
  if (!p || p.team == null) return;

  const b = nearestBeat(t);
  if (p.lastBeat === b.idx) return; // one stroke per beat
  p.lastBeat = b.idx;

  const err = Math.abs(t - b.time);
  p.q = err <= PERFECT_MS ? 1 : clamp(1 - (err - PERFECT_MS) / (MAX_ERR_MS - PERFECT_MS), 0, 1);
  p.strokeAt = localNow();

  const log = game.boats[p.team].log;
  let entry = log.get(b.idx);
  if (!entry) { entry = { closeAt: b.time + b.iv / 2 + NET_GRACE_MS, strokes: [] }; log.set(b.idx, entry); }
  entry.strokes.push({ t, q: p.q });
}

function stdev(xs) {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
}

// Bots row on the beat with a bit of random sloppiness. Handy for testing alone.
function driveBots(now) {
  for (const p of game.players.values()) {
    if (!p.bot || p.team == null) continue;
    const b = nearestBeat(now);
    if (p.lastBeat === b.idx || now < b.time + p.jitter) continue;
    if (Math.random() < 0.93) handleStroke(p.id, now);
    else p.lastBeat = b.idx; // missed a beat
    p.jitter = (Math.random() - 0.5) * 2 * 120;
  }
}

// ---------- Physics ----------
function step(dt) {
  const now = localNow();
  if (game.phase === 'countdown' && now >= game.startAt) game.phase = 'race';
  if (game.phase !== 'race') return;

  driveBots(now);

  game.boats.forEach((boat, team) => {
    const size = Math.max(1, teamPlayers(team).length);
    for (const [idx, e] of boat.log) {
      if (e.closeAt > now) continue;
      // Power = how many rowers hit the beat, and how well (missing rowers count as 0).
      const power = e.strokes.reduce((s, x) => s + x.q, 0) / size;
      // Sync = how tightly the strokes cluster together in time.
      const sync = e.strokes.length > 1
        ? clamp(1 - stdev(e.strokes.map((s) => s.t)) / SYNC_SPREAD_MS, 0, 1)
        : (size === 1 ? 1 : 0.3);
      const boost = STROKE_POWER * power * (0.4 + 0.6 * sync);
      boat.v += boost;
      boat.rhythm = boat.rhythm * 0.5 + (boost / STROKE_POWER) * 0.5;
      boat.log.delete(idx);
    }
    boat.v *= Math.exp(-DRAG * dt);
    boat.x += boat.v * dt;
    if (boat.x >= RACE_LENGTH && game.winner === null) {
      boat.x = RACE_LENGTH;
      game.winner = team;
      game.phase = 'finished';
      updateLobbyPresence();
    }
  });

  const lead = Math.max(...game.boats.map((b) => b.x)) / RACE_LENGTH;
  let bpm = TEMPO[0].bpm;
  for (const s of TEMPO) if (lead >= s.at) bpm = s.bpm;
  setTempo(bpm);
}

// ---------- Controls ----------
function startRace() {
  if (game.phase === 'countdown' || game.phase === 'race') return;
  game.boats = [newBoat(), newBoat()];
  for (const p of game.players.values()) { p.q = 0; p.strokeAt = 0; p.lastBeat = -1; }
  game.bpm = TEMPO[0].bpm;
  game.startAt = localNow() + COUNTDOWN_MS;
  game.anchor = game.startAt; // first beat lands exactly on "GO"
  game.beatBase = 0;
  game.winner = null;
  game.phase = 'countdown';
  updateLobbyPresence();
}

function backToLobby() {
  game.phase = 'lobby';
  game.boats = [newBoat(), newBoat()];
  game.winner = null;
  updateLobbyPresence();
}

let botCount = 0;
$('startBtn').onclick = startRace;
$('resetBtn').onclick = backToLobby;
$('botBtn').onclick = () => { botCount++; addPlayer(`bot-${botCount}`, `Bot ${botCount}`, true); rosterChanged(); };
$('clearBotsBtn').onclick = () => {
  for (const id of [...game.players.keys()]) if (game.players.get(id).bot) game.players.delete(id);
  rosterChanged();
};
$('publicToggle').onchange = (e) => { game.isPublic = e.target.checked; updateLobbyPresence(); };

// ---------- Networking ----------
// The lobby channel is the "server list": every host advertises its room there.
const lobby = supabase.channel(LOBBY_CHANNEL, { config: { presence: { key: code } } });
let lobbyReady = false;

function updateLobbyPresence() {
  if (!lobbyReady) return;
  const humans = [...game.players.values()].filter((p) => !p.bot && p.team != null).length;
  lobby.track({
    code,
    isPublic: game.isPublic,
    players: [...game.players.values()].filter((p) => p.team != null).length,
    humans,
    max: MAX_PER_TEAM * 2,
    phase: game.phase,
  });
}

lobby.subscribe((status) => {
  if (status === 'SUBSCRIBED') { lobbyReady = true; updateLobbyPresence(); }
});

// The room channel carries this race's messages.
const room = supabase.channel(roomChannelName(code), {
  config: { presence: { key: 'host' }, broadcast: { self: false } },
});

room.on('presence', { event: 'sync' }, () => {
  const state = room.presenceState();
  const online = new Set();
  for (const [key, metas] of Object.entries(state)) {
    if (key === 'host') continue;
    online.add(key);
    if (!game.players.has(key)) addPlayer(key, metas[0]?.name);
  }
  for (const [id, p] of [...game.players]) if (!p.bot && !online.has(id)) game.players.delete(id);
  rosterChanged();
});

// Clock sync: phone sends its time, we reply with ours.
room.on('broadcast', { event: 'ping' }, ({ payload }) => {
  room.send({ type: 'broadcast', event: 'pong', payload: { id: payload.id, t0: payload.t0, th: localNow() } });
});

room.on('broadcast', { event: 'stroke' }, ({ payload }) => handleStroke(payload.id, payload.t));

room.subscribe(async (status) => {
  if (status === 'SUBSCRIBED') {
    await room.track({ host: true });
    $('status').textContent = 'Live. Phones can join now.';
  } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
    $('status').textContent = `Connection problem (${status}). Check Supabase keys / internet.`;
  }
});

// Tell phones what's going on, 4 times a second. Phones compute the beat themselves.
setInterval(() => {
  room.send({
    type: 'broadcast',
    event: 'state',
    payload: {
      phase: game.phase,
      bpm: game.bpm,
      anchor: game.anchor,
      startAt: game.startAt,
      winner: game.winner,
      prog: game.boats.map((b) => +(b.x / RACE_LENGTH).toFixed(3)),
      roster: [...game.players.values()].filter((p) => !p.bot).map((p) => [p.id, p.team, p.seat, +p.q.toFixed(2)]),
    },
  });
}, 250);

// ---------- Render loop ----------
let last = performance.now();

function frame(t) {
  const dt = Math.min(0.1, (t - last) / 1000);
  last = t;
  step(dt);
  scene.update(game, localNow(), dt);
  scene.render();
  drawHud();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function drawHud() {
  game.boats.forEach((b, i) => {
    $(`dist${i}`).textContent = `${Math.floor(b.x)} m`;
    $(`rhythm${i}`).style.width = `${Math.round(clamp(b.rhythm, 0, 1) * 100)}%`;
  });
  $('bpm').textContent = `${game.bpm} BPM`;

  let big = '';
  if (game.phase === 'countdown') {
    const s = Math.ceil((game.startAt - localNow()) / 1000);
    big = s > 0 ? String(s) : 'GO!';
  } else if (game.phase === 'race' && localNow() - game.startAt < 800) {
    big = 'GO!';
  } else if (game.phase === 'finished' && game.winner != null) {
    big = `${TEAMS[game.winner].name} wins!`;
  } else if (game.phase === 'lobby') {
    big = '';
  }
  const el = $('bigText');
  if (el.textContent !== big) el.textContent = big;
  el.style.fontSize = big.length > 4 ? '72px' : '120px';
}
