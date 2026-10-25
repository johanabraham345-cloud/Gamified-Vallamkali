// PHONE. Joins a room, syncs its clock with the laptop, detects rowing strokes
// from the motion sensor (or a tap button) and shows the beat.
import './style.css';
import { supabase, configOk, showConfigError, localNow, makeId, LOBBY_CHANNEL, roomChannelName } from './net.js';
import { TEAMS, STROKE_COOLDOWN_MS, STROKE_THRESHOLD, REARM_LEVEL, PUBLIC_AUTOSTART } from './config.js';

const $ = (id) => document.getElementById(id);

if (!configOk) {
  showConfigError();
  throw new Error('Supabase config missing');
}

// Stable id for this tab, so a refresh doesn't create a new rower.
const myId = sessionStorage.getItem('vk-id') || makeId();
sessionStorage.setItem('vk-id', myId);

$('nameInput').value = localStorage.getItem('vk-name') || '';
const params = new URLSearchParams(location.search);
if (params.get('room')) $('codeInput').value = params.get('room').toUpperCase();

let lobby = null;
let room = null;
let roomCode = null;
let state = null;       // latest state from the host
let offset = 0;         // hostTime = localNow() + offset
let bestRtt = Infinity;
const hostTime = () => localNow() + offset;

function show(screen) {
  for (const id of ['screenJoin', 'screenSearch', 'screenRoom']) $(id).classList.toggle('hidden', id !== screen);
}

function getName() {
  const name = $('nameInput').value.trim();
  if (!name) { $('joinError').textContent = 'Enter your name first'; return null; }
  localStorage.setItem('vk-name', name);
  $('joinError').textContent = '';
  return name;
}

// ---------- Public: find the room that most needs players ----------
$('publicBtn').onclick = () => {
  const name = getName();
  if (!name) return;
  show('screenSearch');
  $('searchInfo').textContent = 'Searching public rooms…';

  lobby = supabase.channel(LOBBY_CHANNEL, { config: { presence: { key: myId } } });
  const openRooms = () => Object.values(lobby.presenceState())
    .map((metas) => metas[0])
    .filter((r) => r && r.code && r.isPublic && r.phase === 'lobby' && r.players < r.max)
    .sort((a, b) => b.players - a.players);       // fill the fullest room first, so races start sooner
  const goTo = (code, hosting) => {
    clearTimeout(decide);
    supabase.removeChannel(lobby);
    lobby = null;
    if (hosting) startBackgroundServer(code);
    joinRoom(code, name, hosting ? 20000 : 3500);
  };
  lobby.on('presence', { event: 'sync' }, () => {
    const rooms = openRooms();
    if (rooms.length) goTo(rooms[0].code, false);
  });
  // Nobody hosting a public race? Then this phone starts one (after a small random wait,
  // in case another phone is doing the same thing right now).
  const decide = setTimeout(() => {
    if (!lobby) return;
    $('searchInfo').textContent = 'No open race found. Starting a new public race…';
    setTimeout(() => {
      if (!lobby) return;
      const rooms = openRooms();
      if (rooms.length) goTo(rooms[0].code, false);
      else goTo(newCode(), true);
    }, 500 + Math.random() * 1500);
  }, 2500);
  lobby.subscribe();
};

// ---------- Hosting a public race from this phone ----------
let serverFrame = null;
const newCode = () => Array.from({ length: 4 }, () => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 31)]).join('');
function startBackgroundServer(code) {
  serverFrame = document.createElement('iframe');
  serverFrame.src = `/host.html?headless=1&autostart=${PUBLIC_AUTOSTART}&code=${code}`;
  Object.assign(serverFrame.style, { position: 'fixed', width: '1px', height: '1px', left: '0', bottom: '0', opacity: '0', border: '0', pointerEvents: 'none' });
  document.body.appendChild(serverFrame);
  hostingNote.classList.remove('hidden');
  navigator.wakeLock?.request('screen').catch(() => {});   // keep the screen on while hosting
}
const hostingNote = document.createElement('div');
hostingNote.className = 'small hidden';
hostingNote.style.cssText = 'color:#ffd54f;font-weight:700;';
hostingNote.textContent = "You started this public race. Keep this screen open, or the race ends for everyone.";
$('phaseInfo').after(hostingNote);

$('cancelSearch').onclick = () => {
  if (lobby) supabase.removeChannel(lobby);
  lobby = null;
  show('screenJoin');
};

// ---------- Private: join by code ----------
$('privateBtn').onclick = () => {
  const name = getName();
  if (!name) return;
  const code = $('codeInput').value.trim().toUpperCase();
  if (code.length !== 4) { $('joinError').textContent = 'Room codes are 4 characters'; return; }
  joinRoom(code, name);
};

// ---------- Room ----------
function joinRoom(code, name, hostWaitMs = 3500) {
  roomCode = code;
  state = null;
  bestRtt = Infinity;
  show('screenRoom');
  $('seatInfo').textContent = `Joining room ${code}…`;
  $('seatInfo').style.background = '#333';

  room = supabase.channel(roomChannelName(code), {
    config: { presence: { key: myId }, broadcast: { self: false } },
  });

  room.on('broadcast', { event: 'pong' }, ({ payload }) => {
    if (payload.id !== myId) return;
    const t1 = localNow();
    const rtt = t1 - payload.t0;
    if (rtt < bestRtt) {
      bestRtt = rtt;
      offset = payload.th - (payload.t0 + rtt / 2);
    }
  });

  room.on('broadcast', { event: 'state' }, ({ payload }) => { state = payload; renderState(); });

  room.subscribe(async (status) => {
    if (status !== 'SUBSCRIBED') {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') $('seatInfo').textContent = 'Connection problem, try again';
      return;
    }
    await room.track({ name });
    syncClock();
    // If no host shows up, the code is wrong.
    setTimeout(() => {
      if (room && roomCode === code && !room.presenceState().host) {
        leaveRoom();
        $('joinError').textContent = `Room ${code} not found`;
      }
    }, hostWaitMs);
  });
}

function syncClock() {
  let n = 0;
  const timer = setInterval(() => {
    if (!room || n++ >= 6) return clearInterval(timer);
    room.send({ type: 'broadcast', event: 'ping', payload: { id: myId, t0: localNow() } });
  }, 200);
}
// Re-check the clock every 15 s in case it drifts.
setInterval(() => { if (room) syncClock(); }, 15000);

function leaveRoom() {
  if (room) supabase.removeChannel(room);
  if (serverFrame) { serverFrame.remove(); serverFrame = null; hostingNote.classList.add('hidden'); }
  room = null;
  roomCode = null;
  state = null;
  show('screenJoin');
}
$('leaveBtn').onclick = leaveRoom;

// ---------- UI from host state ----------
function renderState() {
  const me = state.roster.find((r) => r[0] === myId);
  if (!me) {
    $('seatInfo').textContent = 'Room is full, waiting…';
    return;
  }
  const [, team, seat, q] = me;
  if (team == null) {
    $('seatInfo').textContent = 'Room is full, waiting for a seat…';
    $('seatInfo').style.background = '#333';
  } else {
    const side = seat % 2 === 0 ? 'Left' : 'Right';
    $('seatInfo').textContent = `${TEAMS[team].name} boat · Row ${Math.floor(seat / 2) + 1} · ${side} side`;
    $('seatInfo').style.background = TEAMS[team].css;
  }

  const phaseText = {
    lobby: state.need
      ? `Waiting for crews · Red ${state.counts[0]}/${state.need} · Blue ${state.counts[1]}/${state.need}`
      : `Room ${roomCode} · waiting for the host to start`,
    countdown: 'Get ready…',
    race: 'ROW ON THE BEAT!',
    finished: state.winner != null ? `${TEAMS[state.winner].name} boat wins!` : 'Finished',
  }[state.phase];
  $('phaseInfo').textContent = phaseText;

  if (state.phase === 'race' && q > 0) {
    $('feedback').textContent = q >= 0.75 ? 'PERFECT' : q >= 0.35 ? 'GOOD' : 'OFF BEAT';
  } else if (state.phase !== 'race') {
    $('feedback').textContent = '';
  }
}

// ---------- Beat display (computed locally from the host's beat anchor) ----------
let lastBeatNum = -1;
function beatLoop() {
  requestAnimationFrame(beatLoop);
  const dot = $('beatDot');
  if (!state || (state.phase !== 'race' && state.phase !== 'countdown')) {
    dot.style.transform = 'scale(0.6)';
    return;
  }
  const now = hostTime();
  if (state.phase === 'countdown' && now < state.startAt) {
    const s = Math.ceil((state.startAt - now) / 1000);
    $('feedback').textContent = String(s);
  }
  const iv = 60000 / state.bpm;
  const beats = (now - state.anchor) / iv;
  const frac = beats - Math.floor(beats);
  const pulse = frac < 0.18 ? 1 - frac / 0.18 : 0;
  dot.style.transform = `scale(${0.6 + 0.4 * pulse})`;
  const num = Math.floor(beats);
  if (beats >= 0 && num !== lastBeatNum) {
    lastBeatNum = num;
    if (state.phase === 'race') navigator.vibrate?.(25);
  }
}
requestAnimationFrame(beatLoop);

// ---------- Strokes ----------
let lastStroke = 0;
function stroke() {
  const now = localNow();
  if (now - lastStroke < STROKE_COOLDOWN_MS) return;
  lastStroke = now;
  if (room) room.send({ type: 'broadcast', event: 'stroke', payload: { id: myId, t: hostTime() } });
  document.body.classList.add('flash');
  setTimeout(() => document.body.classList.remove('flash'), 120);
}

$('tapBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); stroke(); });

// Motion-based stroke detection, kept simple:
// motion goes ABOVE 5 -> one stroke. It must drop back below 4 before another stroke can count,
// so holding one big swing doesn't fire over and over.
let ema = 0, armed = true, motionStrokes = 0;
let gravity = { x: 0, y: 0, z: 0 };

function onMotion(e) {
  let ax, ay, az;
  if (e.acceleration && e.acceleration.x != null) {
    ({ x: ax, y: ay, z: az } = e.acceleration);
  } else if (e.accelerationIncludingGravity) {
    // No gravity-free reading: estimate gravity with a slow filter and subtract it.
    const g = e.accelerationIncludingGravity;
    gravity = { x: gravity.x * 0.9 + g.x * 0.1, y: gravity.y * 0.9 + g.y * 0.1, z: gravity.z * 0.9 + g.z * 0.1 };
    ax = g.x - gravity.x; ay = g.y - gravity.y; az = g.z - gravity.z;
  } else return;

  const mag = Math.hypot(ax, ay, az);
  ema = ema * 0.5 + mag * 0.5;

  if (armed && ema > STROKE_THRESHOLD) {
    armed = false;
    if (localNow() - lastStroke >= STROKE_COOLDOWN_MS) { motionStrokes++; stroke(); }
  } else if (!armed && ema < REARM_LEVEL) {
    armed = true;
  }
  $('debug').textContent = `motion ${ema.toFixed(1)} · stroke above ${STROKE_THRESHOLD} · strokes ${motionStrokes}`;
}

$('motionBtn').onclick = async () => {
  if (!window.isSecureContext) {
    $('debug').textContent = 'Motion needs HTTPS. Use the TAP button, or open the Vercel link.';
    return;
  }
  try {
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      const res = await DeviceMotionEvent.requestPermission(); // iPhone
      if (res !== 'granted') { $('debug').textContent = 'Motion permission denied'; return; }
    }
    window.addEventListener('devicemotion', onMotion);
    $('motionBtn').textContent = 'Motion on: row with your phone';
    $('motionBtn').disabled = true;
    try { await navigator.wakeLock?.request('screen'); } catch { /* not critical */ }
  } catch (err) {
    $('debug').textContent = `Motion unavailable: ${err.message}`;
  }
};
