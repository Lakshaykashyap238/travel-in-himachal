// create-booking — the only way a new booking enters the system.
//
//   POST /functions/v1/create-booking
//   body: BookingInput + { turnstileToken }
//
// Flow: origin check → validate input (shared schema) → verify Cloudflare
// Turnstile → salted hash of visitor IP → public.create_booking() with the
// service role, which re-validates and rate-limits inside the database.
//
// Secrets (set with `supabase secrets set`): TURNSTILE_SECRET_KEY,
// IP_HASH_SALT, ALLOWED_ORIGINS. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
// are provided automatically by Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createHandler } from './handler.ts';

const env = (name: string) => Deno.env.get(name) ?? '';

const supabase = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const TURNSTILE_SECRET = env('TURNSTILE_SECRET_KEY');
const IP_HASH_SALT = env('IP_HASH_SALT');

if (!TURNSTILE_SECRET || IP_HASH_SALT.length < 16) {
  // Fail closed: without these secrets every booking is refused, loudly.
  console.error('create-booking misconfigured: set TURNSTILE_SECRET_KEY and IP_HASH_SALT (16+ chars)');
}

async function verifyTurnstile(token: unknown, ip: string): Promise<boolean> {
  if (!TURNSTILE_SECRET) return false;
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) return false;
  const form = new FormData();
  form.append('secret', TURNSTILE_SECRET);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json();
    return data?.success === true;
  } catch (e) {
    console.error('Turnstile verification error', e);
    return false;
  }
}

async function hashIp(ip: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${IP_HASH_SALT}:${ip || 'unknown'}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(
  createHandler({
    allowedOrigins: env('ALLOWED_ORIGINS').split(',').map((o) => o.trim()).filter(Boolean),
    verifyBotCheck: (token, ip) => (IP_HASH_SALT.length < 16 ? Promise.resolve(false) : verifyTurnstile(token, ip)),
    hashIp,
    createBooking: async (payload, ipHash) => {
      const { data, error } = await supabase.rpc('create_booking', { p: payload, p_ip_hash: ipHash });
      const row = Array.isArray(data) ? data[0] : data;
      return { data: row ?? null, error: error ? { message: error.message } : null };
    },
  }),
);
