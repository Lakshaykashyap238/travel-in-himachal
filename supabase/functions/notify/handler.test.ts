import { deepStrictEqual as eq, ok, match } from 'node:assert/strict';
import { createNotifyHandler, customerEmail, safeEqual, type NotifyDeps, type OutboxItem } from './handler.ts';

const SECRET = 's3cret-value-1234567890';

const item = (over: Partial<OutboxItem> = {}, booking: Partial<OutboxItem['booking']> = {}): OutboxItem => ({
  id: 7,
  kind: 'booking_created',
  sent_at: null,
  attempts: 0,
  ...over,
  booking: {
    id: 'b-1',
    reference: 'TIH-10042',
    tracking_token: 'a'.repeat(48),
    type: 'tour',
    customer_name: 'Asha <script>',
    phone: '+919876543210',
    email: 'asha@example.com',
    travel_date: '2026-10-20',
    travellers: 3,
    pickup: 'Chandigarh',
    dropoff: null,
    status: 'pending',
    agreed_fare: null,
    rejection_reason: null,
    package_name: 'Spiti & Kaza Tour',
    vehicle_name: 'Maruti Ertiga',
    ...booking,
  },
});

function setup(it: OutboxItem | null, over: Partial<NotifyDeps> = {}) {
  const log = { push: [] as string[], email: [] as { to: string; subject: string; html: string }[], sent: [] as (string | undefined)[], failed: [] as string[], deleted: [] as string[] };
  const d: NotifyDeps = {
    secret: SECRET,
    siteUrl: 'https://travelinhimachal.in',
    businessName: 'Travel In Himachal',
    emailConfigured: true,
    loadItem: () => Promise.resolve(it),
    pushSubscriptions: () => Promise.resolve([
      { id: 'p1', endpoint: 'https://push/1', p256dh: 'k', auth: 'a' },
      { id: 'p2', endpoint: 'https://push/2', p256dh: 'k', auth: 'a' },
    ]),
    recipients: () => Promise.resolve([
      { full_name: 'Owner', role: 'owner', email: 'owner@x.in' },
      { full_name: 'Desk', role: 'staff', email: 'desk@x.in' },
    ]),
    sendPush: (s, p) => { log.push.push(`${s.id}:${JSON.parse(p).title}`); return Promise.resolve('ok'); },
    deleteSubscription: (id) => { log.deleted.push(id); return Promise.resolve(); },
    sendEmail: (m) => { log.email.push(m); return Promise.resolve(true); },
    markSent: (_id, note) => { log.sent.push(note); return Promise.resolve(); },
    markFailed: (_id, e) => { log.failed.push(e); return Promise.resolve(); },
    log: () => {},
    ...over,
  };
  return { h: createNotifyHandler(d), log };
}

const call = (h: (r: Request) => Promise<Response>, body: unknown = { outbox_id: 7 }, secret = SECRET) =>
  h(new Request('https://x/functions/v1/notify', { method: 'POST', headers: { 'x-notify-secret': secret }, body: JSON.stringify(body) }));

Deno.test('rejects calls without the shared secret', async () => {
  const { h, log } = setup(item());
  eq((await call(h, { outbox_id: 7 }, 'wrong')).status, 401);
  eq(log.push.length, 0);
});

Deno.test('new booking: pushes to every staff device and emails owners only', async () => {
  const { h, log } = setup(item());
  const res = await call(h);
  eq(res.status, 200);
  eq(log.push, ['p1:New booking TIH-10042', 'p2:New booking TIH-10042']);
  eq(log.email.map((e) => e.to), ['owner@x.in']);
  match(log.email[0].subject, /New booking TIH-10042/);
  ok(!log.email[0].html.includes('<script>'), 'customer text is escaped in email HTML');
  eq(log.sent, [undefined]);
});

Deno.test('reminder has a distinct title', async () => {
  const { h, log } = setup(item({ kind: 'pending_reminder' }));
  await call(h);
  match(log.push[0], /Still waiting: TIH-10042/);
});

Deno.test('expired push subscriptions are removed', async () => {
  const { h, log } = setup(item(), { sendPush: (s) => Promise.resolve(s.id === 'p1' ? 'gone' : 'ok') });
  eq((await call(h)).status, 200);
  eq(log.deleted, ['p1']);
});

Deno.test('if nothing can be delivered, it is marked failed for retry', async () => {
  const { h, log } = setup(item(), { sendPush: () => Promise.resolve('error'), sendEmail: () => Promise.resolve(false) });
  eq((await call(h)).status, 502);
  eq(log.failed, ['no alert could be delivered']);
  eq(log.sent, []);
});

Deno.test('accepted booking: customer gets a confirmation with fare and tracking link', async () => {
  const { h, log } = setup(item({ kind: 'booking_decided' }, { status: 'accepted', agreed_fare: 18500 }));
  eq((await call(h)).status, 200);
  eq(log.email.length, 1);
  eq(log.email[0].to, 'asha@example.com');
  match(log.email[0].subject, /confirmed/);
  match(log.email[0].html, /₹18,500/);
  match(log.email[0].html, /\/track#a{48}/);
  eq(log.push.length, 0, 'no staff push for decisions');
});

Deno.test('rejected booking: customer sees the reason', () => {
  const m = customerEmail(item({ kind: 'booking_decided' }, { status: 'rejected', rejection_reason: 'No cars that day' }), 'https://s', 'Biz');
  match(m.text, /Reason: No cars that day/);
});

Deno.test('decision without customer email or without email setup is skipped, not retried', async () => {
  const a = setup(item({ kind: 'booking_decided' }, { status: 'accepted', email: null }));
  eq((await call(a.h)).status, 200);
  eq(a.log.sent, ['no customer email']);
  const b = setup(item({ kind: 'booking_decided' }, { status: 'accepted' }), { emailConfigured: false });
  eq((await call(b.h)).status, 200);
  eq(b.log.sent, ['email not configured']);
});

Deno.test('already-sent items are not sent twice', async () => {
  const { h, log } = setup(item({ sent_at: '2026-01-01T00:00:00Z' }));
  eq((await (await call(h)).json()).status, 'already_sent');
  eq(log.push.length, 0);
});

Deno.test('bad input', async () => {
  const { h } = setup(null);
  eq((await call(h, { outbox_id: 'x' })).status, 400);
  eq((await call(h, { outbox_id: 99 })).status, 404);
});

Deno.test('safeEqual', () => {
  ok(safeEqual('abc', 'abc'));
  ok(!safeEqual('abc', 'abd'));
  ok(!safeEqual('abc', 'abcd'));
});
