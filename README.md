# Vallam Kali

A snake-boat race played with phones. Each phone is an oar; boats go fast only when the team rows **in sync** with the drum beat.

- **Laptop / big screen** opens `/host.html` — this page runs the whole game (rooms, scoring, physics) and shows the 3D top view.
- **Phones** open `/play.html` — join public or private, row with the phone (or tap).
- **Supabase Realtime** (free) carries messages between phones and the laptop. Vercel only hosts the pages, because Vercel can't keep live connections open.

---

## 1. Create the Supabase project (5 min, free)

1. Go to https://supabase.com → sign up → **New project** (any name, pick the region closest to you, e.g. Mumbai/Singapore).
2. When it's ready: **Project Settings → API** (or **API Keys**).
3. Copy two things:
   - **Project URL** → looks like `https://abcd1234.supabase.co`
   - **anon public key** (or the **publishable** key) → long string
4. That's it. No tables needed; the game uses Realtime broadcast + presence only.

> If phones can't connect later: in Supabase go to **Realtime → Settings** and make sure public channels are allowed (don't enable "private channels only").

## 2. Put the code in your GitHub repo

Copy everything in this folder into your repo root (so `package.json` sits at the top level):

```
vallamkali/
├── index.html        landing page
├── host.html         laptop screen
├── play.html         phone controller
├── package.json
├── vite.config.js
├── .env.example
├── .gitignore
└── src/
    ├── config.js     all the tunable numbers (tempo, physics, race length)
    ├── net.js        Supabase connection
    ├── host.js       game brain: rooms, seats, scoring, boat physics
    ├── scene.js      Three.js 3D top view (placeholder shapes for now)
    ├── play.js       phone: join, clock sync, motion stroke detection
    └── style.css
```

Then:

```bash
git add .
git commit -m "Vallam Kali skeleton"
git push
```

Do NOT commit `node_modules` or `.env.local` (already in `.gitignore`).

## 3. Deploy on Vercel

1. https://vercel.com → **Add New → Project** → import your repo.
2. **Project name: `vallamkali`** → this gives `vallamkali.vercel.app` if the name is free (if it's taken, Vercel adds a suffix; you can pick another name).
3. Framework preset: **Vite** (auto-detected). Build command `npm run build`, output `dist` (defaults are fine).
4. Open **Environment Variables** and add:

   | Name | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | your Project URL |
   | `VITE_SUPABASE_ANON_KEY` | your anon / publishable key |

5. **Deploy.** If you add or change env vars later, you must **Redeploy** (Deployments → ⋯ → Redeploy), because the keys are baked in at build time.

Every `git push` redeploys automatically after this.

## 4. Run it locally (for development)

Needs Node.js 18+.

```bash
npm install
cp .env.example .env.local      # then paste your two Supabase values in
npm run dev
```

- Laptop: http://localhost:5173/host.html
- Phone-like test: open http://localhost:5173/play.html in another browser tab and use the **TAP TO ROW** button.
- Motion sensors only work on **HTTPS**, so test real rowing on the Vercel link.

## 5. How to play

1. Laptop opens `vallamkali.vercel.app/host.html`. It shows a room code + QR.
2. Phones scan the QR (or open `/play.html`), type a name, then:
   - **Join private room** with the 4-letter code, or
   - **Join public race** → automatically placed in the fullest public room that still has space and hasn't started.
3. On the phone tap **Enable rowing motion** (iPhone will ask permission).
4. Laptop clicks **Start race**. 3…2…1…GO.
5. Row on the beat (the pulsing circle / vibration). Names on the big screen turn **green** when in time, **yellow** when close, **red** when off.

**Testing alone:** click **+ Test bot** a few times on the laptop, then **Start race**. Bots row with random sloppiness.

## How scoring works (src/host.js)

- Every stroke is matched to the nearest drum beat. Within 90 ms = perfect; fades to 0 at 260 ms.
- Each beat, a team's **power** = total stroke quality ÷ team size (missing rowers count as 0).
- **Sync** = how tightly the team's strokes cluster in time.
- Boat speed boost per beat = `STROKE_POWER × power × (0.4 + 0.6 × sync)`; drag slows the boat between strokes.
- Tempo goes 56 → 66 → 80 BPM as the leader passes 40% and 75% of the course.
- Phones sync their clock with the laptop when joining, so network delay doesn't count as being late.

Tweak any of these in `src/config.js`.

## Next steps (in order)

1. Test with 4–6 real phones on the Vercel link; tune `MIN_THRESHOLD` / stroke detection if strokes are missed or doubled.
2. Swap placeholder shapes in `src/scene.js` for real `.glb` models (boat, boatman, palms) using Three.js `GLTFLoader`.
3. Kerala scenery: HDRI sky, Three.js `Water`, instanced palms and crowd.
4. Lobby room + phone POV view.
5. Commentator.

## Known limits of this version

- The laptop page is the game: if that tab is closed or refreshed, the room ends.
- Supabase free tier has message-rate limits; the design keeps messages low (phones send only strokes, laptop sends state 4×/sec).
- Free Supabase projects pause after a week of inactivity — open the dashboard the day before the event.
