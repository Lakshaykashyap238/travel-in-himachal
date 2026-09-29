// publish-site — the owner's "Publish changes" button.
// Checks the caller is the owner (via request_publish(), which also
// throttles), then asks GitHub Actions to rebuild and upload the website.

export interface PublishDeps {
  allowedOrigins: string[];
  /** Calls public.request_publish() as the logged-in user. */
  requestPublish: (authHeader: string) => Promise<{ error: { message: string } | null }>;
  /** Triggers the publish-content workflow on GitHub. */
  triggerBuild: () => Promise<{ ok: boolean; status: number }>;
  log?: (...args: unknown[]) => void;
}

export function createPublishHandler(deps: PublishDeps) {
  const log = deps.log ?? console.error;

  const cors = (origin: string | null): HeadersInit => ({
    'Access-Control-Allow-Origin':
      origin && deps.allowedOrigins.includes(origin) ? origin : deps.allowedOrigins[0] ?? '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    Vary: 'Origin',
  });

  const reply = (origin: string | null, status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors(origin), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });

  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get('Origin');
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if (req.method !== 'POST') return reply(origin, 405, { error: 'method_not_allowed' });
    if (!origin || !deps.allowedOrigins.includes(origin)) return reply(origin, 403, { error: 'forbidden' });

    const auth = req.headers.get('Authorization') ?? '';
    if (!/^Bearer\s+\S+$/.test(auth)) return reply(origin, 401, { error: 'not_authorized' });

    const { error } = await deps.requestPublish(auth);
    if (error) {
      if (error.message.includes('too_soon')) return reply(origin, 429, { error: 'too_soon' });
      if (error.message.includes('not_authorized') || error.message.includes('permission denied'))
        return reply(origin, 403, { error: 'not_authorized' });
      log('request_publish failed', error);
      return reply(origin, 500, { error: 'server_error' });
    }

    const build = await deps.triggerBuild().catch((e) => {
      log('GitHub dispatch threw', e);
      return { ok: false, status: 0 };
    });
    if (!build.ok) {
      log('GitHub dispatch failed', build.status);
      return reply(origin, 502, { error: 'build_not_started' });
    }
    return reply(origin, 202, { status: 'publishing', etaMinutes: 3 });
  };
}
