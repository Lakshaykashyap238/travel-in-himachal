// invite-staff — the owner adds a staff member (or another owner).
// Checks the caller is an owner with two-factor login (via the database),
// then sends a Supabase Auth invite email and creates the staff record.

export interface InviteInput { email: string; fullName: string; role: 'owner' | 'staff' }

export interface InviteDeps {
  allowedOrigins: string[];
  /** true if the caller (by their own login) is an active owner with MFA. */
  callerIsOwner: (authHeader: string) => Promise<boolean>;
  /** Sends the invite; returns the new user's id, or 'exists' if the email already has an account. */
  inviteUser: (email: string) => Promise<{ userId: string } | 'exists'>;
  findUserId: (email: string) => Promise<string | null>;
  /** Insert or re-activate the staff row. Returns 'exists' if already active staff. */
  upsertStaff: (userId: string, fullName: string, role: 'owner' | 'staff') => Promise<'created' | 'reactivated' | 'exists'>;
  log?: (...a: unknown[]) => void;
}

export function parseInvite(body: unknown): InviteInput | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  const fullName = typeof b.fullName === 'string' ? b.fullName.trim() : '';
  const role = b.role === 'owner' ? 'owner' : b.role === 'staff' ? 'staff' : null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 160) return null;
  if (fullName.length < 2 || fullName.length > 80) return null;
  if (!role) return null;
  return { email, fullName, role };
}

export function createInviteHandler(deps: InviteDeps) {
  const log = deps.log ?? console.error;
  const cors = (origin: string | null): HeadersInit => ({
    'Access-Control-Allow-Origin': origin && deps.allowedOrigins.includes(origin) ? origin : deps.allowedOrigins[0] ?? '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    Vary: 'Origin',
  });
  const reply = (origin: string | null, status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors(origin), 'Content-Type': 'application/json' } });

  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get('Origin');
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if (req.method !== 'POST') return reply(origin, 405, { error: 'method_not_allowed' });
    if (!origin || !deps.allowedOrigins.includes(origin)) return reply(origin, 403, { error: 'forbidden' });

    const auth = req.headers.get('Authorization') ?? '';
    if (!/^Bearer\s+\S+$/.test(auth)) return reply(origin, 401, { error: 'not_authorized' });
    if (!(await deps.callerIsOwner(auth).catch(() => false))) return reply(origin, 403, { error: 'not_authorized' });

    const input = parseInvite(await req.json().catch(() => null));
    if (!input) return reply(origin, 422, { error: 'invalid_input' });

    try {
      let userId: string | null;
      const invited = await deps.inviteUser(input.email);
      if (invited === 'exists') {
        userId = await deps.findUserId(input.email);
        if (!userId) return reply(origin, 409, { error: 'account_conflict' });
      } else {
        userId = invited.userId;
      }
      const result = await deps.upsertStaff(userId, input.fullName, input.role);
      if (result === 'exists') return reply(origin, 409, { error: 'already_staff' });
      return reply(origin, 201, { status: result, invited: invited !== 'exists' });
    } catch (e) {
      log('invite failed', e);
      return reply(origin, 500, { error: 'server_error' });
    }
  };
}
