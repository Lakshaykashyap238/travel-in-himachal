import { useCallback, useEffect, useState } from 'react';
import { callFunction, friendlyError, supabase } from './lib/supabase';
import type { StaffMember, StaffRole } from './lib/types';
import { Badge, Button, Card, Field, Spinner, inputClass, useToast } from './ui';

export function StaffPage({ me }: { me: StaffMember }) {
  const toast = useToast();
  const [rows, setRows] = useState<StaffMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const { data } = await supabase.from('staff').select('user_id, full_name, role, is_active, created_at').order('full_name');
    setRows((data ?? []) as StaffMember[]);
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  async function update(s: StaffMember, patch: Partial<StaffMember>, done: string) {
    setError(null);
    const { error } = await supabase.from('staff').update(patch).eq('user_id', s.user_id);
    if (error) { setError(friendlyError(error)); return false; }
    toast(done);
    void reload();
    return true;
  }

  return (
    <div className="space-y-6">
      <div><h2 className="text-2xl font-bold">Staff</h2><p className="text-sm text-slate-600">Who can sign in to this dashboard. Staff handle bookings; owners can also edit the website, prices and staff.</p></div>
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
      {rows === null ? <Spinner className="h-8 w-8 text-brand" /> : (
        <Card className="divide-y divide-slate-100">
          {rows.map((s) => (
            <div key={s.user_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{s.full_name}{s.user_id === me.user_id && <span className="font-normal text-slate-500"> (you)</span>}</p>
                <div className="mt-1 flex gap-2">
                  <Badge className={s.role === 'owner' ? 'bg-brand/10 text-brand ring-brand/30' : 'bg-slate-100 text-slate-700 ring-slate-300'}>{s.role === 'owner' ? 'Owner' : 'Staff'}</Badge>
                  {!s.is_active && <Badge className="bg-red-50 text-red-700 ring-red-200">No access</Badge>}
                </div>
              </div>
              <Button variant="ghost" onClick={() => {
                const name = window.prompt('Name shown in the admin panel', s.full_name)?.trim();
                if (!name || name === s.full_name) return;
                if (name.length < 2 || name.length > 80) { window.alert('Please enter 2 to 80 characters.'); return; }
                void update(s, { full_name: name }, 'Name changed').then((ok) => { if (ok && s.user_id === me.user_id) window.location.reload(); });
              }}>
                Change name
              </Button>
              <Button variant="ghost" onClick={() => void update(s, { role: s.role === 'owner' ? 'staff' : 'owner' }, 'Role changed')}>
                Make {s.role === 'owner' ? 'staff' : 'owner'}
              </Button>
              <Button variant={s.is_active ? 'secondary' : 'success'} onClick={() => void update(s, { is_active: !s.is_active }, s.is_active ? 'Access removed' : 'Access restored')}>
                {s.is_active ? 'Remove access' : 'Restore access'}
              </Button>
            </div>
          ))}
        </Card>
      )}
      <InviteForm onDone={() => void reload()} />
    </div>
  );
}

function InviteForm({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [fullName, setName] = useState('');
  const [role, setRole] = useState<StaffRole>('staff');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: { preventDefault(): void }) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    type Reply = { error?: string; invited?: boolean };
    const { status, data } = await callFunction<Reply>('invite-staff', { email, fullName, role }).catch(() => ({ status: 0, data: {} as Reply }));
    setBusy(false);
    if (status === 201) {
      toast(data.invited ? `Invitation sent to ${email}` : `${fullName} added`);
      setEmail(''); setName(''); setRole('staff');
      return onDone();
    }
    setError(
      data.error === 'already_staff' ? 'This person already has access.'
      : data.error === 'invalid_input' ? 'Check the name and email address.'
      : data.error === 'not_authorized' ? 'Only owners can add staff.'
      : 'Couldn’t send the invitation. Please try again.',
    );
  }

  return (
    <Card className="p-5">
      <h3 className="font-bold">Add a person</h3>
      <p className="text-sm text-slate-600">They’ll get an email to set a password, then set up an authenticator app on first sign-in.</p>
      <form onSubmit={submit} className="mt-4 grid gap-4 sm:grid-cols-[1fr_1fr_10rem_auto] sm:items-end">
        <Field label="Full name">{(id) => <input id={id} value={fullName} onChange={(e) => setName(e.target.value)} className={inputClass} />}</Field>
        <Field label="Email">{(id) => <input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />}</Field>
        <Field label="Role">
          {(id) => (
            <select id={id} value={role} onChange={(e) => setRole(e.target.value as StaffRole)} className={inputClass}>
              <option value="staff">Staff</option>
              <option value="owner">Owner</option>
            </select>
          )}
        </Field>
        <Button type="submit" busy={busy}>Send invite</Button>
      </form>
      {error && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
    </Card>
  );
}
