// Sign-in → (set password, for invite/recovery links) → authenticator app → staff check.
// Every staff action in the database requires the authenticator step (aal2).
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { adminConfigured, friendlyError, supabase } from './lib/supabase';
import type { StaffMember } from './lib/types';
import { Button, Card, Field, Spinner, inputClass } from './ui';

// Invite and password-reset links arrive with #...type=invite|recovery. Read it
// before supabase-js consumes the URL fragment.
const linkType =
  typeof window !== 'undefined' ? new URLSearchParams(window.location.hash.replace(/^#/, '')).get('type') : null;

type Stage =
  | { name: 'loading' }
  | { name: 'signed-out' }
  | { name: 'set-password' }
  | { name: 'mfa-enroll' }
  | { name: 'mfa-verify'; factorId: string }
  | { name: 'no-access' }
  | { name: 'ready'; me: StaffMember; session: Session };

function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-100 px-4 py-10">
      <Card className="w-full max-w-md p-7">
        <p className="text-sm font-bold uppercase tracking-widest text-brand">Admin</p>
        <h1 className="mt-1 text-2xl font-bold">{title}</h1>
        <div className="mt-6">{children}</div>
      </Card>
    </main>
  );
}

export function AuthGate({ children }: { children: (me: StaffMember, signOut: () => void) => ReactNode }) {
  const [stage, setStage] = useState<Stage>({ name: 'loading' });
  const [needsPassword, setNeedsPassword] = useState(linkType === 'invite' || linkType === 'recovery');

  const evaluate = useCallback(async () => {
    const { data: s } = await supabase.auth.getSession();
    const session = s.session;
    if (!session) return setStage({ name: 'signed-out' });
    if (needsPassword) return setStage({ name: 'set-password' });

    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel !== 'aal2') {
      const { data: f } = await supabase.auth.mfa.listFactors();
      const verified = f?.totp?.find((x) => x.status === 'verified');
      return setStage(verified ? { name: 'mfa-verify', factorId: verified.id } : { name: 'mfa-enroll' });
    }

    const { data: me } = await supabase.from('staff').select('user_id, full_name, role, is_active').eq('user_id', session.user.id).maybeSingle();
    if (!me || !me.is_active) return setStage({ name: 'no-access' });
    setStage({ name: 'ready', me: me as StaffMember, session });
  }, [needsPassword]);

  useEffect(() => {
    if (!adminConfigured) return;
    void evaluate();
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setNeedsPassword(true);
      if (event === 'SIGNED_OUT') setStage({ name: 'signed-out' });
    });
    return () => data.subscription.unsubscribe();
  }, [evaluate]);

  const signOut = useCallback(() => void supabase.auth.signOut(), []);

  if (!adminConfigured)
    return <Shell title="Admin not connected yet"><p className="text-slate-600">The admin dashboard will work once the website is connected to its database (see docs/SETUP.md).</p></Shell>;

  switch (stage.name) {
    case 'loading':
      return <main className="grid min-h-screen place-items-center"><Spinner className="h-8 w-8 text-brand" /></main>;
    case 'signed-out':
      return <SignIn onDone={evaluate} />;
    case 'set-password':
      return <SetPassword onDone={() => { setNeedsPassword(false); history.replaceState(null, '', '/admin'); }} />;
    case 'mfa-enroll':
      return <MfaEnroll onDone={evaluate} onSignOut={signOut} />;
    case 'mfa-verify':
      return <MfaVerify factorId={stage.factorId} onDone={evaluate} onSignOut={signOut} />;
    case 'no-access':
      return (
        <Shell title="No access">
          <p className="text-slate-600">This account isn’t an active staff member. Ask the owner to add you.</p>
          <Button className="mt-6 w-full" variant="secondary" onClick={signOut}>Sign out</Button>
        </Shell>
      );
    case 'ready':
      return <>{children(stage.me, signOut)}</>;
  }
}

function SignIn({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'sign-in' | 'forgot' | 'sent'>('sign-in');

  async function submit(e: { preventDefault(): void }) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    if (mode === 'forgot') {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${location.origin}/admin` });
      setBusy(false);
      if (error) return setError(friendlyError(error));
      return setMode('sent');
    }
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) return setError(/invalid/i.test(error.message) ? 'Wrong email or password.' : friendlyError(error));
    onDone();
  }

  if (mode === 'sent')
    return (
      <Shell title="Check your email">
        <p className="text-slate-600">If <strong>{email}</strong> has an account, we’ve sent a link to set a new password.</p>
        <Button className="mt-6 w-full" variant="secondary" onClick={() => setMode('sign-in')}>Back to sign in</Button>
      </Shell>
    );

  return (
    <Shell title={mode === 'forgot' ? 'Reset your password' : 'Sign in'}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email">{(id) => <input id={id} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />}</Field>
        {mode === 'sign-in' && (
          <Field label="Password">{(id) => <input id={id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />}</Field>
        )}
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
        <Button type="submit" className="w-full" busy={busy}>{mode === 'forgot' ? 'Send reset link' : 'Sign in'}</Button>
        <button type="button" className="w-full text-sm font-semibold text-slate-600 hover:underline" onClick={() => { setError(null); setMode(mode === 'forgot' ? 'sign-in' : 'forgot'); }}>
          {mode === 'forgot' ? 'Back to sign in' : 'Forgot password?'}
        </button>
      </form>
    </Shell>
  );
}

function SetPassword({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: { preventDefault(): void }) {
    e.preventDefault();
    if (pw.length < 12) return setError('Use at least 12 characters.');
    if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw)) return setError('Include upper- and lower-case letters and a number.');
    if (pw !== pw2) return setError('The two passwords don’t match.');
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setError(friendlyError(error));
    onDone();
  }

  return (
    <Shell title="Choose your password">
      <form onSubmit={submit} className="space-y-4">
        <Field label="New password" hint="At least 12 characters, with upper- and lower-case letters and a number.">
          {(id) => <input id={id} type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} className={inputClass} />}
        </Field>
        <Field label="Type it again">{(id) => <input id={id} type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} className={inputClass} />}</Field>
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
        <Button type="submit" className="w-full" busy={busy}>Save password</Button>
      </form>
    </Shell>
  );
}

function CodeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="6-digit code from your authenticator app">
      {(id) => (
        <input id={id} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
          className={`${inputClass} text-center font-mono text-2xl tracking-[0.5em]`} />
      )}
    </Field>
  );
}

function MfaEnroll({ onDone, onSignOut }: { onDone: () => void; onSignOut: () => void }) {
  const [factor, setFactor] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      // Remove any half-finished setup from a previous attempt.
      const { data: f } = await supabase.auth.mfa.listFactors();
      for (const x of f?.all ?? []) if (x.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: x.id });
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}` });
      if (error) return setError(friendlyError(error));
      setFactor({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    })();
  }, []);

  async function submit(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!factor) return;
    setBusy(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    setBusy(false);
    if (error) return setError('That code didn’t work. Check the time on your phone and try the newest code.');
    onDone();
  }

  return (
    <Shell title="Protect your account">
      <p className="text-slate-600">Scan this with Google Authenticator or Microsoft Authenticator. You’ll enter a code from the app each time you sign in.</p>
      {factor ? (
        <form onSubmit={submit} className="mt-5 space-y-4">
          <img src={factor.qr} alt="QR code for your authenticator app" className="mx-auto h-48 w-48 rounded-xl bg-white p-2 ring-1 ring-slate-200" />
          <p className="text-center text-xs text-slate-500">Can’t scan? Enter this key: <span className="select-all break-all font-mono">{factor.secret}</span></p>
          <CodeInput value={code} onChange={setCode} />
          {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
          <Button type="submit" className="w-full" busy={busy} disabled={code.length !== 6}>Turn on and continue</Button>
        </form>
      ) : error ? (
        <p className="mt-5 rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>
      ) : (
        <div className="mt-6 grid place-items-center"><Spinner className="h-8 w-8 text-brand" /></div>
      )}
      <Button className="mt-3 w-full" variant="ghost" onClick={onSignOut}>Sign out</Button>
    </Shell>
  );
}

function MfaVerify({ factorId, onDone, onSignOut }: { factorId: string; onDone: () => void; onSignOut: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: { preventDefault(): void }) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    setBusy(false);
    if (error) return setError('That code didn’t work. Try the newest code in your app.');
    onDone();
  }

  return (
    <Shell title="Enter your code">
      <form onSubmit={submit} className="space-y-4">
        <CodeInput value={code} onChange={setCode} />
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
        <Button type="submit" className="w-full" busy={busy} disabled={code.length !== 6}>Continue</Button>
        <Button type="button" className="w-full" variant="ghost" onClick={onSignOut}>Sign out</Button>
      </form>
      <p className="mt-4 text-xs text-slate-500">Lost your phone? The owner can reset your two-factor login from the Supabase dashboard (docs/RUNBOOK.md).</p>
    </Shell>
  );
}
