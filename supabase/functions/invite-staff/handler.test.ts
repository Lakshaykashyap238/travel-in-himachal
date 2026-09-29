import { deepStrictEqual as eq } from 'node:assert/strict';
import { createInviteHandler, parseInvite, type InviteDeps } from './handler.ts';

const ORIGIN = 'https://travelinhimachal.in';

function setup(over: Partial<InviteDeps> = {}) {
  const calls = { invited: [] as string[], upserts: [] as string[] };
  const d: InviteDeps = {
    allowedOrigins: [ORIGIN],
    callerIsOwner: () => Promise.resolve(true),
    inviteUser: (email) => { calls.invited.push(email); return Promise.resolve({ userId: 'u-new' }); },
    findUserId: () => Promise.resolve('u-old'),
    upsertStaff: (id, name, role) => { calls.upserts.push(`${id}:${name}:${role}`); return Promise.resolve('created'); },
    log: () => {},
    ...over,
  };
  return { h: createInviteHandler(d), calls };
}

const post = (body: unknown, headers: Record<string, string> = { Origin: ORIGIN, Authorization: 'Bearer jwt' }) =>
  new Request('https://x/functions/v1/invite-staff', { method: 'POST', headers, body: JSON.stringify(body) });

const valid = { email: ' Ravi@Example.com ', fullName: 'Ravi Kumar', role: 'staff' };

Deno.test('owner invites a new staff member', async () => {
  const { h, calls } = setup();
  const res = await h(post(valid));
  eq(res.status, 201);
  eq(calls.invited, ['ravi@example.com']);
  eq(calls.upserts, ['u-new:Ravi Kumar:staff']);
});

Deno.test('non-owner or missing login is refused before anything happens', async () => {
  const a = setup({ callerIsOwner: () => Promise.resolve(false) });
  eq((await a.h(post(valid))).status, 403);
  eq(a.calls.invited, []);
  const b = setup();
  eq((await b.h(post(valid, { Origin: ORIGIN }))).status, 401);
});

Deno.test('existing account is linked instead of re-invited', async () => {
  const { h, calls } = setup({ inviteUser: () => Promise.resolve('exists') });
  eq((await h(post(valid))).status, 201);
  eq(calls.upserts, ['u-old:Ravi Kumar:staff']);
});

Deno.test('already-active staff → 409', async () => {
  const { h } = setup({ upsertStaff: () => Promise.resolve('exists') });
  eq((await h(post(valid))).status, 409);
});

Deno.test('input validation', () => {
  eq(parseInvite({ email: 'bad', fullName: 'Ravi', role: 'staff' }), null);
  eq(parseInvite({ email: 'a@b.co', fullName: 'R', role: 'staff' }), null);
  eq(parseInvite({ email: 'a@b.co', fullName: 'Ravi', role: 'admin' }), null);
  eq(parseInvite({ email: 'a@b.co', fullName: 'Ravi', role: 'owner' }), { email: 'a@b.co', fullName: 'Ravi', role: 'owner' });
});

Deno.test('other websites are refused', async () => {
  const { h } = setup();
  eq((await h(post(valid, { Origin: 'https://evil.example', Authorization: 'Bearer x' }))).status, 403);
});
