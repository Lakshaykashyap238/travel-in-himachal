// Run: deno test supabase/functions/create-booking/
import { deepStrictEqual as assertEquals, match as assertMatch } from 'node:assert/strict';
import { createHandler, type Deps } from './handler.ts';

const ORIGIN = 'https://travelinhimachal.in';
const inTenDays = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);

const validBody = {
  type: 'cab',
  vehicleSlug: 'suzuki-dzire',
  customerName: 'Asha Verma',
  phone: '+919876543210',
  email: 'Asha@Example.com',
  travelDate: inTenDays,
  travellers: 3,
  pickup: 'Chandigarh',
  dropoff: 'Manali',
  consent: true,
  turnstileToken: 'ok-token',
};

function deps(over: Partial<Deps> = {}) {
  const calls: { payload?: Record<string, unknown>; ipHash?: string } = {};
  const d: Deps = {
    allowedOrigins: [ORIGIN],
    verifyBotCheck: (token) => Promise.resolve(token === 'ok-token'),
    hashIp: (ip) => Promise.resolve(`hash(${ip})`),
    createBooking: (payload, ipHash) => {
      calls.payload = payload;
      calls.ipHash = ipHash;
      return Promise.resolve({ data: { reference: 'TIH-10001', tracking_token: 'a'.repeat(48) }, error: null });
    },
    log: () => {},
    ...over,
  };
  return { d, calls };
}

const post = (body: unknown, origin: string | null = ORIGIN, extra: HeadersInit = {}) =>
  new Request('https://x.supabase.co/functions/v1/create-booking', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}), ...extra },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

Deno.test('accepts a valid booking and returns reference + token', async () => {
  const { d, calls } = deps();
  const res = await createHandler(d)(post(validBody, ORIGIN, { 'CF-Connecting-IP': '1.2.3.4' }));
  assertEquals(res.status, 201);
  assertEquals(await res.json(), { reference: 'TIH-10001', trackingToken: 'a'.repeat(48) });
  assertEquals(calls.ipHash, 'hash(1.2.3.4)');
  assertEquals(calls.payload?.email, 'asha@example.com'); // normalised
  assertEquals('consent' in (calls.payload ?? {}), false); // not sent to DB
  assertEquals('turnstileToken' in (calls.payload ?? {}), false);
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});

Deno.test('rejects requests from other websites', async () => {
  const res = await createHandler(deps().d)(post(validBody, 'https://evil.example'));
  assertEquals(res.status, 403);
});

Deno.test('rejects requests with no Origin header', async () => {
  const res = await createHandler(deps().d)(post(validBody, null));
  assertEquals(res.status, 403);
});

Deno.test('answers CORS preflight', async () => {
  const res = await createHandler(deps().d)(new Request('https://x', { method: 'OPTIONS', headers: { Origin: ORIGIN } }));
  assertEquals(res.status, 204);
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});

Deno.test('rejects malformed JSON and oversized bodies', async () => {
  const h = createHandler(deps().d);
  assertEquals((await h(post('{not json'))).status, 400);
  assertEquals((await h(post('[1,2]'))).status, 400);
  assertEquals((await h(post({ ...validBody, notes: 'x'.repeat(20_000) }))).status, 413);
});

Deno.test('returns field errors for invalid input', async () => {
  const res = await createHandler(deps().d)(post({ ...validBody, phone: '98765', dropoff: '' }));
  assertEquals(res.status, 422);
  const body = await res.json();
  assertEquals(body.error, 'invalid_input');
  const fields = body.details.map((d: { field: string }) => d.field).sort();
  assertEquals(fields, ['dropoff', 'phone']);
});

Deno.test('requires privacy consent', async () => {
  const res = await createHandler(deps().d)(post({ ...validBody, consent: false }));
  assertEquals(res.status, 422);
});

Deno.test('a tour booking needs a tour', async () => {
  const res = await createHandler(deps().d)(post({ ...validBody, type: 'tour', dropoff: undefined }));
  assertEquals(res.status, 422);
  assertMatch(JSON.stringify(await res.json()), /packageSlug/);
});

Deno.test('fails the bot check without calling the database', async () => {
  const { d, calls } = deps();
  const res = await createHandler(d)(post({ ...validBody, turnstileToken: 'bad' }));
  assertEquals(res.status, 403);
  assertEquals((await res.json()).error, 'bot_check_failed');
  assertEquals(calls.payload, undefined);
});

for (const [dbMessage, status, code] of [
  ['rate_limited', 429, 'rate_limited'],
  ['unavailable_item: vehicle', 409, 'unavailable_item'],
  ['invalid_date', 422, 'invalid_date'],
  ['new row violates check constraint "bookings_phone_check"', 422, 'invalid_input'],
  ['connection reset', 500, 'server_error'],
] as const) {
  Deno.test(`maps database error "${dbMessage}" to ${status}`, async () => {
    const { d } = deps({ createBooking: () => Promise.resolve({ data: null, error: { message: dbMessage } }) });
    const res = await createHandler(d)(post(validBody));
    assertEquals(res.status, status);
    assertEquals((await res.json()).error, code);
  });
}

Deno.test('never leaks internal error details', async () => {
  const { d } = deps({ createBooking: () => Promise.reject(new Error('password=supersecret')) });
  const res = await createHandler(d)(post(validBody));
  assertEquals(res.status, 500);
  assertEquals(JSON.stringify(await res.json()).includes('supersecret'), false);
});
