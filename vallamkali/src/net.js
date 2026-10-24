import { createClient } from '@supabase/supabase-js';

// Supabase Realtime is our "messenger": phones and the laptop talk through it.
// Vercel can't keep live connections open, so the laptop's browser runs the game
// and Supabase just passes messages around.
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const configOk = Boolean(url && key);

export const supabase = configOk
  ? createClient(url, key, { realtime: { params: { eventsPerSecond: 30 } } })
  : null;

export const LOBBY_CHANNEL = 'vk-lobby';
export const roomChannelName = (code) => `vk-room-${code}`;

// High-resolution wall-clock time in ms.
export const localNow = () => performance.timeOrigin + performance.now();

export const makeId = () => Math.random().toString(36).slice(2, 10);

export function showConfigError() {
  document.body.innerHTML = `
    <div class="config-error">
      <h1>Setup needed</h1>
      <p>Supabase keys are missing. Add <code>VITE_SUPABASE_URL</code> and
      <code>VITE_SUPABASE_ANON_KEY</code> to <code>.env.local</code> (local) or to
      Vercel → Settings → Environment Variables, then rebuild / redeploy.</p>
    </div>`;
}
