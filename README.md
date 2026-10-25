allam Kali — Row Together, Win Together

A multiplayer snake-boat race played with your phones. Everyone in the room scans a QR code, their phone becomes a paddle, and two crews race a 3D chundan vallam down a palm-lined Kerala backwater, live on the big screen. The fastest rowers don't win. The crew that rows in sync does.

Built for the Make Room for Play track: a game played across everyone's phones in the room, controlled through real movement.
<img width="1152" height="612" alt="image" src="https://github.com/user-attachments/assets/c0c24ff8-a623-44dd-b020-d912f2477498" />



Vallam Kali

▶ Play: open vallamkali.vercel.app/host.html on a laptop, then scan the QR code with your phones.

What makes it special

Vallam Kali is one of Kerala's most iconic traditions: 100+ oarsmen in one snake boat, paddling to a single rhythm. We turned the core truth of that sport into a game mechanic: power comes from timing and unity, not from rowing harder. A crew of six rowing perfectly together beats a crew of six thrashing on their own, every time.

No app to install, no controllers, no accounts. Just phones, a laptop, and a room full of people shouting the rhythm.

How to play
Host: open host.html on a laptop or projector. A room code and QR code appear.
Join: players scan the QR (or open play.html) on their phones, type a name, and join a private room with the code, or a public race.
Get seated: each player is automatically placed in a boat (Red or Blue), on the left or right side.
Row: hold your phone like a paddle handle and make a rowing motion on the drum beat. Or tap the big button.
Win: first boat to the 800 m finish line takes it.
<img width="846" height="542" alt="image" src="https://github.com/user-attachments/assets/ef60a108-97e2-44f7-a41b-d3682ed37173" />

Phone controller

Features
Gameplay
Your phone is the paddle. Real rowing motion is detected with the phone's motion sensor, with a tap button as a backup.
Every stroke moves the boat instantly; strokes on the drum beat give full power, off-beat strokes still push a little.
SYNC bonus. When the whole crew strokes within 180 ms of each other, the boat surges forward, the camera shakes, and a big green SYNC! pops up.
Real boat physics. Uneven rowing makes the boat turn and lean: if the left side out-rows the right, the boat veers, drifts out of line and loses speed, just like a real snake boat.
Lane buoys. Boats can never cross the middle line. Hulls glance off the buoys, and a gentle force pulls each boat back to its lane.
Drum tempo speeds up as the race goes on: 56 → 66 → 80 BPM in the final stretch.
6 rowers per boat, 12 players per race. Spectators are always welcome.
Anti-spam: frantic extra strokes inside one beat barely count. Rhythm wins, not panic.

Multiplayer
Private rooms with a 4-letter code + QR code.
Public matchmaking: "Join public race" finds the open room that needs players and puts you in.
Automatic team balancing and seating (left / right sides, front to back).
Clock sync between every phone and the laptop, so network delay never counts as being off-beat.
Live timing feedback on each rower's name tag: 🟢 in time, 🟡 close, 🔴 off-beat. Everyone can see who's pacing fast and adjust.
Test bots for practising or demoing solo.

Cinematic presentation
<img width="981" height="533" alt="image" src="https://github.com/user-attachments/assets/548414a7-6542-4100-b3f8-a3dd797d3758" />


Cinematic intro

Movie-style intro: a low dolly shot arcing around the boatmen as they warm up, a sweep across the front of both boats, then a crane up into the race as 3…2…1 pops on screen. Air horn at GO.
Dynamic chase camera: an angled 3/4 broadcast view that sways, zooms to keep both boats in frame, and punches in on every SYNC.
TV-style camera cuts during the race: tracking alongside the leading crew, head-on from ahead, and overhead.
Picture-in-picture: when one boat pulls far ahead, the main camera follows the leader and a corner window follows the boat behind.
Final sprint mode: the camera gets lower and tighter, and a pulsing FINAL SPRINT banner appears in the last 15%.
Slow-motion finish from a camera on the bank at the finish line, then a victory orbit around the winning boat.
Broadcast HUD: distances, rhythm bars, a live race-progress track, and "RED LEADS BY 4.3 m."
🎙️ Malayalam live commentary
Real Malayalam commentary that reacts to the race: the start, every lead change, who reaches 300 m and 600 m first, who's closing in on the finish, and the winner crossing the line.
Hype calls keep the energy up through the middle of the race.
Smart director: one voice at a time, big moments cut in over filler, outdated calls are dropped, and the drums and crowd dip so the commentator is always heard.

A living Kerala backwater
<img width="846" height="542" alt="image" src="https://github.com/user-attachments/assets/ec0a7ee5-31d6-4363-95a6-7a11031b4108" />


Crew paddling

Traditional chundan vallam with its tall curved stern, scaled to a real 34 m.
Boatmen in mundu, wearing team-coloured caps, who actually grip their paddles. The hands are solved onto the paddle every frame and follow a real stroke: reach and dig in, pull back through the water, lift out, swing forward.
Splashes every time a blade bites the water, foam wakes along the hulls, and bow spray at speed.
Rippling water with two layers of moving waves, sky reflections and sun glints.
Coconut palms line both banks, with a deep palm forest stretching behind them.
Thousands of spectators in tiers along the banks, with umbrellas, bouncing with excitement as the boats pass.
Sky, soft shadows, distance haze, team flags fluttering, a striped finish gate.
Sound: chenda-style drum on every beat, a whoosh on SYNC, and a crowd that roars louder the closer the race gets. All synthesized in the browser.
🛠️ How it's built
Part	Tech
3D graphics	Three.js (WebGL)
Realtime multiplayer	Supabase Realtime (broadcast + presence)
Hosting	Vercel (static site)
Build tool	Vite
Phone input	DeviceMotion API (accelerometer)
Sound	Web Audio API
3D models	Meshy AI (boat, boatman, palm) + Mixamo rig, optimised with glTF-Transform

Architecture in one line: the laptop's browser is the game server. It owns the room, scores every stroke and runs the physics, while Supabase just carries messages between the phones and the laptop. No backend server to run.

 Phone  ──stroke (+ synced timestamp)──▶  ☁️ Supabase Realtime  ──▶  💻 Laptop (game brain + 3D)
 Phone  ◀──────── race state (4×/sec) ───  ☁️ Supabase Realtime  ◀──  💻 Laptop
Some of the interesting engineering
Network-fair timing: each phone measures its clock offset to the laptop, so strokes are judged by when they happened, not when they arrived.
Beat-locked scoring: strokes are matched to the nearest drum beat; quality fades from 100% (within 90 ms) to 0% (260 ms off).
Hull-aware lane limits: the physics checks the turned hull's real sideways extent (bow and stern swing out), not just its centre point.
Procedural arm IK: a two-bone inverse-kinematics solve places each boatman's hands on his paddle every frame.
Water-stopper mask: an invisible shape traced from the hull's waterline stops river water rendering inside the boat.
Impostor forest: the 3D palm is photographed into textures at load time and reused on flat cards, giving 1,400 background trees almost for free.
Models squeezed 20×: the original 26.8 MB of models became 1.3 MB with mesh simplification, Meshopt compression and WebP textures, so it loads fast even on phones.
