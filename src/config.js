// All the tunable game numbers live here, so you can tweak the feel without digging through code.

export const MAX_PER_TEAM = 2;       // TEST MODE: 2 rowers per boat (front row, left + right). Raise later (max 10).
export const RACE_LENGTH = 800;      // metres to the finish line

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

// Stroke timing: within PERFECT_MS of the beat = full quality, fades to 0 at MAX_ERR_MS.
export const PERFECT_MS = 90;
export const MAX_ERR_MS = 260;

// ---- Forward motion: EVERY stroke pushes the boat immediately ----
export const STROKE_IMPULSE = 3.3;   // speed added per beat when the whole team rows perfectly
export const OFFBEAT_MIN = 0.4;      // an off-beat stroke still gives 40% push
export const EXTRA_STROKE = 0.15;    // a 2nd stroke inside the same beat gives only 15% (no spamming)
export const DRAG = 0.5;             // how fast the boat slows down between strokes

// ---- Sync bonus: whole team strokes together on the beat -> short speed surge ----
export const SYNC_WINDOW_MS = 120;   // all strokes must land within this spread of each other
export const SYNC_MIN_QUALITY = 0.5; // ...and be reasonably on the beat
export const SURGE_SPEED = 4;        // extra m/s during the surge
export const SURGE_MS = 350;         // surge length

// ---- Steering / tilt: uneven rowing turns and tilts the boat ----
// Left-side strokes turn the boat right and vice versa, like a real boat.
// If one side rows harder or more on the beat, the boat yaws toward the weaker side.
export const TURN_POWER = 0.25;      // turn speed added per full stroke (rad/s)
export const YAW_SPRING = 1.5;       // keel straightens the boat back
export const YAW_DAMP = 2.0;
export const MAX_YAW = 0.35;         // ~20 degrees
export const ROLL_POWER = 0.35;      // sideways lean per stroke (visual)
export const ROLL_SPRING = 10;
export const ROLL_DAMP = 4;
export const MAX_ROLL = 0.3;
export const LANE_DRIFT = 4.5;       // how far a boat can wander sideways out of its lane line (m)

// Rhythm bar on the HUD: how spread out strokes can be before the bar reads 0.
export const SYNC_SPREAD_MS = 200;

// Extra wait after a beat before judging sync, to allow for network delay.
export const NET_GRACE_MS = 250;

// Stroke detection on the phone.
export const STROKE_COOLDOWN_MS = 350;
export const MIN_THRESHOLD = 4;      // m/s^2
export const MAX_THRESHOLD = 20;
