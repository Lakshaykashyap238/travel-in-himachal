// invite-staff — see handler.ts. Secrets: ALLOWED_ORIGINS, SITE_URL.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createInviteHandler } from './handler.ts';

const env = (n: string) => Deno.env.get(n) ?? '';
const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(
  createInviteHandler({
    allowedOrigins: env('ALLOWED_ORIGINS').split(',').map((o) => o.trim()).filter(Boolean),

    callerIsOwner: async (authHeader) => {
      const asCaller = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await asCaller.rpc('is_owner');
      return !error && data === true;
    },

    inviteUser: async (email) => {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${env('SITE_URL').replace(/\/$/, '')}/admin`,
      });
      if (error) {
        if (/already|registered|exists/i.test(error.message)) return 'exists';
        throw new Error(error.message);
      }
      return { userId: data.user.id };
    },

    findUserId: async (email) => {
      // Small staff lists: page through users to find the matching email.
      for (let page = 1; page <= 20; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
        if (error) throw new Error(error.message);
        const hit = data.users.find((u) => u.email?.toLowerCase() === email);
        if (hit) return hit.id;
        if (data.users.length < 100) break;
      }
      return null;
    },

    upsertStaff: async (userId, fullName, role) => {
      const { data: existing } = await admin.from('staff').select('is_active').eq('user_id', userId).maybeSingle();
      if (existing?.is_active) return 'exists';
      const { error } = await admin
        .from('staff')
        .upsert({ user_id: userId, full_name: fullName, role, is_active: true }, { onConflict: 'user_id' });
      if (error) throw new Error(error.message);
      return existing ? 'reactivated' : 'created';
    },
  }),
);
