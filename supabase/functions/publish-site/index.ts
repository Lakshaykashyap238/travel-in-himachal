// publish-site — see handler.ts.
// Secrets: GITHUB_DISPATCH_TOKEN (fine-grained token, this repo only,
// "Actions: read and write"), GITHUB_REPO ("owner/name"), ALLOWED_ORIGINS.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createPublishHandler } from './handler.ts';

const env = (n: string) => Deno.env.get(n) ?? '';

Deno.serve(
  createPublishHandler({
    allowedOrigins: env('ALLOWED_ORIGINS').split(',').map((o) => o.trim()).filter(Boolean),
    requestPublish: async (authHeader) => {
      // Uses the caller's own login, so the database checks they are the owner.
      const client = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error } = await client.rpc('request_publish');
      return { error: error ? { message: error.message } : null };
    },
    triggerBuild: async () => {
      const res = await fetch(
        `https://api.github.com/repos/${env('GITHUB_REPO')}/actions/workflows/publish-content.yml/dispatches`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env('GITHUB_DISPATCH_TOKEN')}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'travel-in-himachal-publish',
          },
          body: JSON.stringify({ ref: 'main' }),
          signal: AbortSignal.timeout(10_000),
        },
      );
      return { ok: res.status === 204, status: res.status };
    },
  }),
);
