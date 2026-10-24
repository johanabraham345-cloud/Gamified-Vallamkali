// All the tunable game numbers live here, so you can tweak the feel without digging through code.

export const MAX_PER_TEAM = 10;      // rowers per boat
export const RACE_LENGTH = 400;      // metres to the finish line

export const TEAMS = [
  { name: 'Red',  color: 0xd63a2f, css: '#d63a2f' },
  { name: 'Blue', color: 0x2f6fd6, css: '#2f6fd6' },
];

// Drum tempo speeds up as the leading boat gets further down the course.
export const TEMPO = [
  { at: 0.0,  bpm: 56 },
  { at: 0.4,  bpm: 66 },
  { at: 0.75, bpm: 80 },
];

export const COUNTDOWN_MS = 4000;    // 3..2..1..GO

// Stroke timing: within PERFECT_MS of the beat = full power, fades to 0 at MAX_ERR_MS.
export const PERFECT_MS = 90;
export const MAX_ERR_MS = 260;

// How spread out a team's strokes can be (std deviation, ms) before sync hits 0.
export const SYNC_SPREAD_MS = 200;

// Extra wait after a beat before scoring it, to allow for network delay.
export const NET_GRACE_MS = 250;

// Boat physics. Perfect rowing at 56 bpm settles around 8 m/s.
export const STROKE_POWER = 3.2;     // speed added per perfectly synced beat
export const DRAG = 0.5;             // how fast the boat slows down

// Stroke detection on the phone.
export const STROKE_COOLDOWN_MS = 350;
export const MIN_THRESHOLD = 4;      // m/s^2
export const MAX_THRESHOLD = 20;
