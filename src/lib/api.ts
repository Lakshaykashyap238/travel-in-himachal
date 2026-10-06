// Browser-side calls to the booking backend. Plain fetch (no SDK) keeps the
// public pages light; the admin dashboard uses supabase-js.
import type { BookingCreated, BookingErrorCode, BookingInput } from '@shared/booking-schema';

const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL as string | undefined;
const ANON_KEY = import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string | undefined;

export const backendConfigured = Boolean(SUPABASE_URL && ANON_KEY);

const headers = () => ({
  apikey: ANON_KEY!,
  Authorization: `Bearer ${ANON_KEY}`,
  'Content-Type': 'application/json',
});

export type CreateBookingResult =
  | { ok: true; booking: BookingCreated }
  | { ok: false; code: BookingErrorCode | 'network'; fields?: { field: string; message: string }[] };

export async function createBooking(input: BookingInput & { turnstileToken: string }): Promise<CreateBookingResult> {
  if (!backendConfigured) return { ok: false, code: 'server_error' };
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/create-booking`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(20_000),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 201) return { ok: true, booking: body as BookingCreated };
    return { ok: false, code: (body.error as BookingErrorCode) ?? 'server_error', fields: body.details };
  } catch {
    return { ok: false, code: 'network' };
  }
}

export type BookingStatus = 'pending' | 'accepted' | 'rejected' | 'completed' | 'cancelled';

export interface TrackedBooking {
  reference: string;
  type: 'tour' | 'cab';
  package_name: string | null;
  vehicle_name: string;
  travel_date: string;
  travellers: number;
  pickup: string;
  dropoff: string | null;
  status: BookingStatus;
  agreed_fare: number | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

export async function getBookingByToken(token: string): Promise<TrackedBooking | null> {
  if (!backendConfigured) throw new Error('not_configured');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_booking_by_token`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ p_token: token }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rows = (await res.json()) as TrackedBooking[];
  return rows[0] ?? null;
}

/** Remember the visitor's recent bookings on this device (convenience only). */
export function rememberBooking(b: BookingCreated) {
  try {
    const list = JSON.parse(localStorage.getItem('tih.bookings') ?? '[]') as BookingCreated[];
    localStorage.setItem('tih.bookings', JSON.stringify([b, ...list.filter((x) => x.reference !== b.reference)].slice(0, 10)));
  } catch {
    /* storage unavailable — fine */
  }
}

export type SubmitReviewResult = 'ok' | 'invalid' | 'not_found' | 'not_eligible' | 'already_reviewed' | 'busy' | 'network';

export async function submitReview(input: {
  reference: string; phone: string; name: string; place: string; rating: number; body: string;
}): Promise<SubmitReviewResult> {
  if (!backendConfigured) return 'network';
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/submit_review`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        p_reference: input.reference, p_phone: input.phone, p_name: input.name,
        p_place: input.place, p_rating: input.rating, p_body: input.body,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return 'network';
    return (await res.json()) as SubmitReviewResult;
  } catch {
    return 'network';
  }
}
