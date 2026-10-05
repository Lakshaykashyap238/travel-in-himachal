import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE_URL = (import.meta.env.PUBLIC_SUPABASE_URL as string | undefined) ?? '';
const ANON_KEY = (import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string | undefined) ?? '';
export const VAPID_PUBLIC_KEY = (import.meta.env.PUBLIC_VAPID_PUBLIC_KEY as string | undefined) ?? '';

export const adminConfigured = Boolean(SUPABASE_URL && ANON_KEY);

export const supabase: SupabaseClient = createClient(SUPABASE_URL || 'https://not-configured.invalid', ANON_KEY || 'x', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'tih-admin-auth' },
});

/** Call one of our Edge Functions with the signed-in user's token. */
export async function callFunction<T = unknown>(name: string, body: unknown = {}): Promise<{ status: number; data: T }> {
  const { data: s } = await supabase.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${s.session?.access_token ?? ''}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as T };
}

/** Public URL for a catalogue photo path stored in the database. */
export function photoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith('catalogue/')) return `${SUPABASE_URL}/storage/v1/object/public/${path}`;
  // Photos that came with the original site live in src/assets.
  if (path.startsWith('/images/')) return bundledPhotos[`/src/assets/${path.slice('/images/'.length)}`] ?? null;
  return null;
}

const bundledPhotos = import.meta.glob<string>('/src/assets/**/*.{jpg,jpeg,png,webp}', { eager: true, query: '?url', import: 'default' });

/** Turn a database error into a sentence for the admin. */
export function friendlyError(e: { message?: string; code?: string } | null | undefined): string {
  const m = e?.message ?? '';
  if (/last_owner/.test(m)) return 'There must always be at least one active owner.';
  if (/invalid_transition/.test(m)) return 'This booking has already been decided — refresh to see its latest status.';
  if (/reason_required/.test(m)) return 'Please give a reason — the customer will see it.';
  if (/not_authorized|permission denied|row-level security/.test(m)) return 'You don’t have permission to do that.';
  if (/duplicate key.*slug/.test(m)) return 'That web address (slug) is already used. Choose another.';
  if (/violates foreign key/.test(m)) return 'This is used by existing bookings, so it can’t be deleted. Hide it instead.';
  if (/check constraint/.test(m)) return 'Some values aren’t valid. Check the highlighted fields.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'Couldn’t reach the server. Check your internet connection.';
  return m || 'Something went wrong. Please try again.';
}
