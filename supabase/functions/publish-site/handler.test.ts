import { deepStrictEqual as assertEquals } from 'node:assert/strict';
import { createPublishHandler, type PublishDeps } from './handler.ts';

const ORIGIN = 'https://travelinhimachal.in';

function deps(over: Partial<PublishDeps> = {}) {
  let builds = 0;
  const d: PublishDeps = {
    allowedOrigins: [ORIGIN],
    requestPublish: () => Promise.resolve({ error: null }),
    triggerBuild: () => {
      builds++;
      return Promise.resolve({ ok: true, status: 204 });
    },
    log: () => {},
    ...over,
  };
  return { d, builds: () => builds };
}

const post = (headers: Record<string, string> = { Origin: ORIGIN, Authorization: 'Bearer user-jwt' }) =>
  new Request('https://x/functions/v1/publish-site', { method: 'POST', headers });

Deno.test('owner publish starts a build', async () => {
  const { d, builds } = deps();
  const res = await createPublishHandler(d)(post());
  assertEquals(res.status, 202);
  assertEquals(builds(), 1);
});

Deno.test('no login → 401, no build', async () => {
  const { d, builds } = deps();
  const res = await createPublishHandler(d)(post({ Origin: ORIGIN }));
  assertEquals(res.status, 401);
  assertEquals(builds(), 0);
});

Deno.test('non-owner → 403, no build', async () => {
  const { d, builds } = deps({ requestPublish: () => Promise.resolve({ error: { message: 'not_authorized' } }) });
  const res = await createPublishHandler(d)(post());
  assertEquals(res.status, 403);
  assertEquals(builds(), 0);
});

Deno.test('double click → 429, no second build', async () => {
  const { d, builds } = deps({ requestPublish: () => Promise.resolve({ error: { message: 'too_soon' } }) });
  const res = await createPublishHandler(d)(post());
  assertEquals(res.status, 429);
  assertEquals(builds(), 0);
});

Deno.test('other websites are refused', async () => {
  const { d } = deps();
  const res = await createPublishHandler(d)(post({ Origin: 'https://evil.example', Authorization: 'Bearer x' }));
  assertEquals(res.status, 403);
});

Deno.test('GitHub failure is reported, not hidden', async () => {
  const { d } = deps({ triggerBuild: () => Promise.resolve({ ok: false, status: 401 }) });
  const res = await createPublishHandler(d)(post());
  assertEquals(res.status, 502);
  assertEquals((await res.json()).error, 'build_not_started');
});
