/**
 * Database security & booking-lifecycle tests.
 *
 * Runs the real migrations against a throwaway PostgreSQL database with a
 * small Supabase stand-in (tests/db/supabase-stub.sql), then checks what
 * each kind of user can and cannot do.
 *
 *   TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres npm run test:db
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ADMIN_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/postgres';
const TEST_DB = 'tih_test';
const root = join(import.meta.dirname, '..', '..');

let db: pg.Pool;

type Role = 'anon' | 'authenticated' | 'service_role';

/** Run one statement as a Supabase role, optionally as a specific logged-in user. */
async function as<T extends pg.QueryResultRow = any>(
  role: Role,
  sql: string,
  params: unknown[] = [],
  userId?: string,
): Promise<pg.QueryResult<T>> {
  const client = await db.connect();
  try {
    await client.query('begin');
    await client.query(`set local role ${role}`);
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify(userId ? { sub: userId, role } : { role }),
    ]);
    const res = await client.query<T>(sql, params);
    await client.query('commit');
    return res;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

const in10days = () => {
  const d = new Date(Date.now() + 10 * 86_400_000);
  return d.toISOString().slice(0, 10);
};

let phoneCounter = 0;
const booking = (over: Record<string, unknown> = {}) => ({
  type: 'cab',
  vehicleSlug: 'suzuki-dzire',
  customerName: 'Asha Verma',
  phone: `+9198765${String(10000 + phoneCounter++).slice(-5)}`,
  email: 'asha@example.com',
  travelDate: in10days(),
  travellers: 3,
  pickup: 'Chandigarh ISBT',
  dropoff: 'Manali Mall Road',
  notes: 'Two large bags',
  ...over,
});

let ipCounter = 0;
const createBooking = (b: Record<string, unknown>, ip = `iphash-${String(ipCounter++).padStart(12, '0')}`) =>
  as<{ reference: string; tracking_token: string }>(
    'service_role',
    'select * from public.create_booking($1::jsonb, $2)',
    [JSON.stringify(b), ip],
  );

let ownerId: string;
let staffId: string;
let outsiderId: string;

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${TEST_DB} with (force)`);
  await admin.query(`create database ${TEST_DB}`);
  await admin.end();

  const url = new URL(ADMIN_URL);
  url.pathname = `/${TEST_DB}`;
  db = new pg.Pool({ connectionString: url.toString(), max: 4 });

  await db.query(readFileSync(join(root, 'tests/db/supabase-stub.sql'), 'utf8'));
  const migDir = join(root, 'supabase/migrations');
  for (const f of readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()) {
    await db.query(readFileSync(join(migDir, f), 'utf8'));
  }

  const users = await db.query<{ id: string }>(
    `insert into auth.users (email) values ('owner@x.in'), ('staff@x.in'), ('visitor@x.in') returning id`,
  );
  [ownerId, staffId, outsiderId] = users.rows.map((r) => r.id);
  await db.query(
    `insert into public.staff (user_id, full_name, role) values ($1, 'Owner', 'owner'), ($2, 'Desk Staff', 'staff')`,
    [ownerId, staffId],
  );
});

afterAll(async () => {
  await db?.end();
});

describe('public visitor (anon)', () => {
  it('sees the active catalogue: 11 tours and 2 cars', async () => {
    expect((await as('anon', 'select slug from public.packages')).rowCount).toBe(11);
    expect((await as('anon', 'select slug from public.vehicles')).rowCount).toBe(2);
  });

  it('the duplicate Kangra tour is gone', async () => {
    const r = await as('anon', `select count(*)::int as n from public.packages where name ilike '%kangra%'`);
    expect(r.rows[0].n).toBe(1);
  });

  it.each(['bookings', 'booking_events', 'booking_attempts', 'staff', 'push_subscriptions'])(
    'cannot read %s',
    async (table) => {
      await expect(as('anon', `select * from public.${table}`)).rejects.toThrow(/permission denied/);
    },
  );

  it('cannot insert a booking directly', async () => {
    await expect(
      as('anon', `insert into public.bookings (type, vehicle_id, customer_name, phone, travel_date, travellers, pickup, dropoff)
                  select 'cab', id, 'X Y', '+919999999999', current_date + 5, 2, 'A', 'B' from public.vehicles limit 1`),
    ).rejects.toThrow(/permission denied/);
  });

  it('cannot call create_booking (only the Edge Function can)', async () => {
    await expect(
      as('anon', 'select * from public.create_booking($1::jsonb, $2)', [JSON.stringify(booking()), 'x'.repeat(20)]),
    ).rejects.toThrow(/permission denied/);
  });

  it('cannot edit prices', async () => {
    const r = await as('anon', `update public.vehicles set price_per_day = 1`).catch((e) => e);
    expect(String(r)).toMatch(/permission denied/);
  });
});

describe('creating bookings (Edge Function / service role)', () => {
  it('creates a cab booking with a reference and a secret tracking token', async () => {
    const r = await createBooking(booking());
    expect(r.rows[0].reference).toMatch(/^TIH-\d{5}$/);
    expect(r.rows[0].tracking_token).toMatch(/^[0-9a-f]{48}$/);
    const ev = await db.query(
      `select e.kind, e.to_status from public.booking_events e join public.bookings b on b.id = e.booking_id
       where b.reference = $1`,
      [r.rows[0].reference],
    );
    expect(ev.rows).toEqual([{ kind: 'created', to_status: 'pending' }]);
  });

  it('creates a tour booking linked to the tour', async () => {
    const r = await createBooking(booking({ type: 'tour', packageSlug: 'spiti-kaza-7-days', dropoff: '' }));
    const b = await db.query(
      `select p.name, b.dropoff from public.bookings b join public.packages p on p.id = b.package_id where reference = $1`,
      [r.rows[0].reference],
    );
    expect(b.rows[0]).toEqual({ name: 'Spiti & Kaza Tour', dropoff: null });
  });

  it('rejects a tour booking without a tour', async () => {
    await expect(createBooking(booking({ type: 'tour' }))).rejects.toThrow(/unavailable_item: package/);
  });

  it('rejects a cab booking without a drop-off', async () => {
    await expect(createBooking(booking({ dropoff: '' }))).rejects.toThrow(/cab_needs_dropoff/);
  });

  it('rejects past dates and dates beyond 180 days', async () => {
    await expect(createBooking(booking({ travelDate: '2020-01-01' }))).rejects.toThrow(/invalid_date/);
    const far = new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10);
    await expect(createBooking(booking({ travelDate: far }))).rejects.toThrow(/invalid_date/);
  });

  it('rejects unknown or hidden cars', async () => {
    await expect(createBooking(booking({ vehicleSlug: 'lamborghini' }))).rejects.toThrow(/unavailable_item: vehicle/);
  });

  it('rejects an invalid phone number', async () => {
    await expect(createBooking(booking({ phone: '98765' }))).rejects.toThrow(/bookings_phone_check/);
  });

  it('limits one phone number to 3 bookings per 24 hours', async () => {
    const phone = '+919000000001';
    for (let i = 0; i < 3; i++) await createBooking(booking({ phone }));
    await expect(createBooking(booking({ phone }))).rejects.toThrow(/rate_limited/);
  });

  it('limits one IP to 10 bookings per hour', async () => {
    const ip = 'same-ip-hash-0000001';
    for (let i = 0; i < 10; i++) await createBooking(booking(), ip);
    await expect(createBooking(booking(), ip)).rejects.toThrow(/rate_limited/);
  });
});

describe('customer tracking link', () => {
  it('returns the booking for the right token, without phone or email', async () => {
    const { rows } = await createBooking(booking());
    const r = await as('anon', 'select * from public.get_booking_by_token($1)', [rows[0].tracking_token]);
    expect(r.rowCount).toBe(1);
    expect(r.rows[0]).toMatchObject({ reference: rows[0].reference, status: 'pending', vehicle_name: 'Suzuki Dzire' });
    expect(r.rows[0]).not.toHaveProperty('phone');
    expect(r.rows[0]).not.toHaveProperty('email');
  });

  it('returns nothing for a wrong or malformed token', async () => {
    expect((await as('anon', 'select * from public.get_booking_by_token($1)', ['0'.repeat(48)])).rowCount).toBe(0);
    expect((await as('anon', 'select * from public.get_booking_by_token($1)', ["' or 1=1 --"])).rowCount).toBe(0);
  });
});

describe('logged-in user who is not staff', () => {
  it('sees no bookings and cannot change them', async () => {
    const { rows } = await createBooking(booking());
    const id = (await db.query('select id from public.bookings where reference = $1', [rows[0].reference])).rows[0].id;
    expect((await as('authenticated', 'select * from public.bookings', [], outsiderId)).rowCount).toBe(0);
    await expect(
      as('authenticated', `select public.set_booking_status($1, 'accepted', 5000)`, [id], outsiderId),
    ).rejects.toThrow(/not_authorized/);
  });
});

describe('staff workflow', () => {
  const newPendingId = async () => {
    const { rows } = await createBooking(booking());
    return (await db.query('select id from public.bookings where reference = $1', [rows[0].reference])).rows[0].id as string;
  };

  it('staff can see all bookings', async () => {
    const r = await as('authenticated', 'select count(*)::int n from public.bookings', [], staffId);
    expect(r.rows[0].n).toBeGreaterThan(0);
  });

  it('accept → complete, with the agreed fare and a full audit trail', async () => {
    const id = await newPendingId();
    const acc = await as('authenticated', `select * from public.set_booking_status($1, 'accepted', 7200, null, 'Confirmed on call')`, [id], staffId);
    expect(acc.rows[0]).toMatchObject({ status: 'accepted', agreed_fare: 7200, handled_by: staffId });
    await as('authenticated', `select public.set_booking_status($1, 'completed')`, [id], staffId);
    const ev = await as('authenticated',
      `select kind, from_status, to_status, note from public.booking_events where booking_id = $1 order by id`, [id], staffId);
    expect(ev.rows).toEqual([
      { kind: 'created', from_status: null, to_status: 'pending', note: null },
      { kind: 'status_changed', from_status: 'pending', to_status: 'accepted', note: 'Confirmed on call' },
      { kind: 'status_changed', from_status: 'accepted', to_status: 'completed', note: null },
    ]);
  });

  it('rejecting requires a reason, which the customer can then see', async () => {
    const id = await newPendingId();
    await expect(as('authenticated', `select public.set_booking_status($1, 'rejected')`, [id], staffId)).rejects.toThrow(/reason_required/);
    await as('authenticated', `select public.set_booking_status($1, 'rejected', null, 'No cars free that day')`, [id], staffId);
    const token = (await db.query('select tracking_token from public.bookings where id = $1', [id])).rows[0].tracking_token;
    const r = await as('anon', 'select status, rejection_reason from public.get_booking_by_token($1)', [token]);
    expect(r.rows[0]).toEqual({ status: 'rejected', rejection_reason: 'No cars free that day' });
  });

  it.each([
    ['pending', 'completed'],
    ['pending', 'cancelled'],
  ])('blocks the invalid jump %s → %s', async (_from, to) => {
    const id = await newPendingId();
    await expect(as('authenticated', `select public.set_booking_status($1, $2)`, [id, to], staffId)).rejects.toThrow(/invalid_transition/);
  });

  it('a decided booking cannot be decided again', async () => {
    const id = await newPendingId();
    await as('authenticated', `select public.set_booking_status($1, 'rejected', null, 'Full')`, [id], staffId);
    await expect(as('authenticated', `select public.set_booking_status($1, 'accepted', 100)`, [id], staffId)).rejects.toThrow(/invalid_transition/);
  });

  it('staff cannot edit bookings directly, only through the workflow', async () => {
    const id = await newPendingId();
    await expect(as('authenticated', `update public.bookings set status = 'completed' where id = $1`, [id], staffId)).rejects.toThrow(/permission denied/);
    await expect(as('authenticated', `delete from public.bookings where id = $1`, [id], staffId)).rejects.toThrow(/permission denied/);
  });

  it('notes are recorded in the audit trail', async () => {
    const id = await newPendingId();
    await as('authenticated', `select public.add_booking_note($1, 'Customer asked for child seat')`, [id], staffId);
    const r = await as('authenticated', `select note from public.booking_events where booking_id = $1 and kind = 'note'`, [id], staffId);
    expect(r.rows[0].note).toBe('Customer asked for child seat');
  });

  it('the audit trail cannot be edited or deleted, even by a database admin', async () => {
    await expect(db.query(`update public.booking_events set note = 'x'`)).rejects.toThrow(/append-only/);
    await expect(db.query(`delete from public.booking_events`)).rejects.toThrow(/append-only/);
  });
});

describe('catalogue and staff management', () => {
  it('staff cannot change prices; the owner can', async () => {
    const staffTry = await as('authenticated', `update public.vehicles set price_per_day = 1 returning id`, [], staffId);
    expect(staffTry.rowCount).toBe(0);
    const ownerTry = await as('authenticated', `update public.vehicles set price_per_day = 2600 where slug = 'suzuki-dzire' returning price_per_day`, [], ownerId);
    expect(ownerTry.rows[0].price_per_day).toBe(2600);
  });

  it('a hidden tour disappears for visitors but stays visible to staff', async () => {
    await as('authenticated', `update public.packages set is_active = false where slug = 'kasauli-2-days'`, [], ownerId);
    expect((await as('anon', `select 1 from public.packages where slug = 'kasauli-2-days'`)).rowCount).toBe(0);
    expect((await as('authenticated', `select 1 from public.packages where slug = 'kasauli-2-days'`, [], staffId)).rowCount).toBe(1);
    await expect(createBooking(booking({ type: 'tour', packageSlug: 'kasauli-2-days' }))).rejects.toThrow(/unavailable_item/);
  });

  it('only the owner can add staff', async () => {
    const newUser = (await db.query<{ id: string }>(`insert into auth.users (email) values ('new@x.in') returning id`)).rows[0].id;
    await expect(
      as('authenticated', `insert into public.staff (user_id, full_name) values ($1, 'New Person')`, [newUser], staffId),
    ).rejects.toThrow(/row-level security/);
    const r = await as('authenticated', `insert into public.staff (user_id, full_name) values ($1, 'New Person') returning role`, [newUser], ownerId);
    expect(r.rows[0].role).toBe('staff');
  });

  it('staff only see their own push devices', async () => {
    await as('authenticated', `insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://push/a', 'k', 'a')`, [staffId], staffId);
    await expect(
      as('authenticated', `insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://push/b', 'k', 'a')`, [ownerId], staffId),
    ).rejects.toThrow(/row-level security/);
    expect((await as('authenticated', 'select * from public.push_subscriptions', [], ownerId)).rowCount).toBe(0);
  });
});

describe('admin-editable content and publishing', () => {
  it('visitors read business details and 12 destinations, but cannot edit them', async () => {
    const s = await as('anon', 'select business_name, phone from public.site_settings');
    expect(s.rows[0].business_name).toBe('Travel In Himachal');
    expect((await as('anon', 'select slug from public.destinations')).rowCount).toBe(12);
    await expect(as('anon', `update public.site_settings set phone = '+911111111111'`)).rejects.toThrow(/permission denied/);
    await expect(as('anon', 'select * from public.publish_state')).rejects.toThrow(/permission denied/);
  });

  it('tours carry the places they cover', async () => {
    const r = await as('anon', `select places from public.packages where slug = 'shimla-kufri-3-days'`);
    expect(r.rows[0].places).toContain('Jakhoo Temple');
  });

  it('staff cannot edit business details; the owner can, and it flags unpublished changes', async () => {
    const before = (await db.query('select content_changed_at from public.publish_state')).rows[0].content_changed_at;
    const staffTry = await as('authenticated', `update public.site_settings set tagline = 'x' returning 1`, [], staffId);
    expect(staffTry.rowCount).toBe(0);
    await as('authenticated', `update public.site_settings set phone = '+919812345678', stat_years = 12`, [], ownerId);
    const after = (await db.query('select content_changed_at from public.publish_state')).rows[0].content_changed_at;
    expect(after).not.toBeNull();
    expect(after).not.toEqual(before);
    const s = await as('anon', 'select phone, stat_years from public.site_settings');
    expect(s.rows[0]).toEqual({ phone: '+919812345678', stat_years: 12 });
  });

  it('rejects bad values in business details', async () => {
    await expect(as('authenticated', `update public.site_settings set phone = '12345'`, [], ownerId)).rejects.toThrow(/check/);
    await expect(as('authenticated', `update public.site_settings set instagram_url = 'javascript:alert(1)'`, [], ownerId)).rejects.toThrow(/check/);
  });

  it('the owner can set a tour price, photo and itinerary', async () => {
    const r = await as('authenticated',
      `update public.packages set starting_price = 11500, image_path = 'catalogue/spiti-2026.webp',
         itinerary = '[{"day":1,"title":"Shimla to Narkanda","details":"Drive via Kufri"}]'::jsonb
       where slug = 'spiti-kaza-7-days' returning starting_price, itinerary`, [], ownerId);
    expect(r.rows[0].starting_price).toBe(11500);
    expect(r.rows[0].itinerary[0].title).toBe('Shimla to Narkanda');
    await expect(as('authenticated', `update public.packages set itinerary = '{"not":"array"}' where slug = 'spiti-kaza-7-days'`, [], ownerId))
      .rejects.toThrow(/check/);
  });

  it('only the owner can publish, at most once every 2 minutes', async () => {
    await expect(as('authenticated', 'select public.request_publish()', [], staffId)).rejects.toThrow(/not_authorized/);
    await expect(as('anon', 'select public.request_publish()')).rejects.toThrow(/permission denied/);
    await db.query('update public.publish_state set last_publish_at = null');
    const first = await as('authenticated', 'select public.request_publish() as at', [], ownerId);
    expect(first.rows[0].at).toBeTruthy();
    await expect(as('authenticated', 'select public.request_publish()', [], ownerId)).rejects.toThrow(/too_soon/);
    const st = await as('authenticated', 'select last_publish_by from public.publish_state', [], staffId);
    expect(st.rows[0].last_publish_by).toBe(ownerId);
  });
});
