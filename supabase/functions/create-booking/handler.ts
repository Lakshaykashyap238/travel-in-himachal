// Request handling for create-booking, separated from I/O so it can be tested.
import {
  bookingInputSchema,
  type BookingCreated,
  type BookingErrorCode,
} from '../_shared/booking-schema.ts';

export interface Deps {
  allowedOrigins: string[];
  /** Returns true if the Cloudflare Turnstile token is valid. */
  verifyBotCheck: (token: unknown, ip: string) => Promise<boolean>;
  /** Salted, one-way hash of the visitor IP (used only for rate limiting). */
  hashIp: (ip: string) => Promise<string>;
  /** Calls public.create_booking() with the service role. */
  createBooking: (
    payload: Record<string, unknown>,
    ipHash: string,
  ) => Promise<{ data: { reference: string; tracking_token: string } | null; error: { message: string } | null }>;
  log?: (...args: unknown[]) => void;
}

const MAX_BODY_BYTES = 10_000;

export function mapDbError(message: string): { status: number; code: BookingErrorCode } {
  if (message.includes('rate_limited')) return { status: 429, code: 'rate_limited' };
  if (message.includes('unavailable_item')) return { status: 409, code: 'unavailable_item' };
  if (message.includes('invalid_date')) return { status: 422, code: 'invalid_date' };
  if (message.includes('invalid_input') || message.includes('violates check constraint'))
    return { status: 422, code: 'invalid_input' };
  return { status: 500, code: 'server_error' };
}

export function createHandler(deps: Deps) {
  const log = deps.log ?? console.error;

  const cors = (origin: string | null): HeadersInit => ({
    'Access-Control-Allow-Origin':
      origin && deps.allowedOrigins.includes(origin) ? origin : deps.allowedOrigins[0] ?? '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  });

  const reply = (origin: string | null, status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors(origin), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });

  const fail = (origin: string | null, status: number, code: BookingErrorCode, details?: unknown) =>
    reply(origin, status, { error: code, ...(details ? { details } : {}) });

  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get('Origin');

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if (req.method !== 'POST') return fail(origin, 405, 'invalid_input');
    // Only our own website may submit bookings.
    if (!origin || !deps.allowedOrigins.includes(origin)) return fail(origin, 403, 'invalid_input');

    const raw = await req.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return fail(origin, 413, 'invalid_input');

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw);
      if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new Error('not an object');
    } catch {
      return fail(origin, 400, 'invalid_input');
    }

    const parsed = bookingInputSchema.safeParse(body);
    if (!parsed.success) {
      const fields = parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
      return fail(origin, 422, 'invalid_input', fields);
    }

    const ip =
      req.headers.get('CF-Connecting-IP') ??
      req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ??
      '';

    if (!(await deps.verifyBotCheck(body.turnstileToken, ip))) return fail(origin, 403, 'bot_check_failed');

    const { consent: _consent, ...payload } = parsed.data;

    let result;
    try {
      result = await deps.createBooking(payload, await deps.hashIp(ip));
    } catch (e) {
      log('create_booking threw', e);
      return fail(origin, 500, 'server_error');
    }

    if (result.error || !result.data) {
      const { status, code } = mapDbError(result.error?.message ?? '');
      if (status >= 500) log('create_booking failed', result.error);
      return fail(origin, status, code);
    }

    const created: BookingCreated = {
      reference: result.data.reference,
      trackingToken: result.data.tracking_token,
    };
    return reply(origin, 201, created);
  };
}
