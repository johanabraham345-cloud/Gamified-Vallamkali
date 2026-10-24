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

export const COUNTDOWN_MS = 7000;    // cinematic intro fly-past, then 3..2..1..GO

// ---- River & lanes (shared by physics and graphics) ----
export const RIVER_HALF = 18;        // river is 36 m wide
export const LANE_Z = [-7, 7];       // Red lane centre, Blue lane centre (middle buoy line is z = 0)
export const BOAT_HALF_LEN = 17;     // boat is 34 m long
export const BOAT_HALF_WIDTH = 1.75;
export const MID_GAP = 0.8;          // closest a hull may get to the middle buoy line (m)
export const BANK_GAP = 1.0;         // closest a hull may get to the riverbank (m)
export const LANE_CENTERING = 0.15;  // gentle pull back toward your own lane centre (per second)

// Stroke timing: within PERFECT_MS of the beat = full quality, fades to 0 at MAX_ERR_MS.
export const PERFECT_MS = 90;
export const MAX_ERR_MS = 260;

// ---- Forward motion: EVERY stroke pushes the boat immediately ----
export const STROKE_IMPULSE = 3.3;   // speed added per beat when the whole team rows perfectly
export const OFFBEAT_MIN = 0.4;      // an off-beat stroke still gives 40% push
export const EXTRA_STROKE = 0.15;    // a 2nd stroke inside the same beat gives only 15% (no spamming)
export const DRAG = 0.5;             // how fast the boat slows down between strokes

// ---- Sync bonus: whole team strokes together -> instant speed surge ----
// Fires the moment the last teammate's stroke arrives (no waiting for the beat to end).
// Being together is what counts; being on the drum beat as well makes the surge stronger.
export const SYNC_WINDOW_MS = 180;   // all teammates' strokes within this many ms of each other
export const SURGE_SPEED = 6;        // extra m/s during the surge (x0.6 if off-beat, x1.0 if on-beat)
export const SURGE_MS = 500;         // surge length
export const SURGE_GAP = 0.6;        // at most one surge per 0.6 of a beat (stops tap-spamming)

// ---- Steering / tilt: uneven rowing turns and tilts the boat ----
// Left-side strokes turn the boat right and vice versa, like a real boat.
// If one side rows harder or more on the beat, the boat yaws toward the weaker side.
export const TURN_POWER = 0.9;       // turn speed added per full stroke (rad/s)
export const YAW_SPRING = 0.6;       // keel straightens the boat back (lower = stays turned longer)
export const YAW_DAMP = 1.2;
// A 34 m boat turned 43° sticks out 25 m sideways, wider than its half of the river, so it would
// cross the middle line. ~21° is the most a boat can turn and still fit in its own lane.
export const MAX_YAW = 0.36;
export const ROLL_POWER = 0.8;       // sideways lean per stroke (visual)
export const ROLL_SPRING = 9;
export const ROLL_DAMP = 3.5;
export const MAX_ROLL = 0.5;         // ~29 degrees max lean

// ---- Cinematics ----
export const CINEMATIC_CUTS = true;  // TV-style camera cuts during the race (alongside, head-on, overhead)
export const SLOWMO_MS = 2500;       // slow motion right after the winner crosses the line
export const SLOWMO_SCALE = 0.3;

// Rhythm bar on the HUD: how spread out strokes can be before the bar reads 0.
export const SYNC_SPREAD_MS = 200;

// Extra wait after a beat before judging sync, to allow for network delay.
export const NET_GRACE_MS = 250;

// Stroke detection on the phone.
export const STROKE_COOLDOWN_MS = 350;      // minimum gap between two strokes (taps and motion)
export const STROKE_THRESHOLD = 5;          // motion above this = one stroke
export const REARM_LEVEL = 4;               // motion must drop below this before the next stroke can count
