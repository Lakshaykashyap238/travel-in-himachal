import { useEffect, useState } from 'react';
import { friendlyError, supabase } from './lib/supabase';
import type { SettingsRow } from './lib/types';
import { Button, Card, Field, Spinner, inputClass, useToast } from './ui';

const TEXT_FIELDS: { key: keyof SettingsRow; label: string; hint?: string; rows?: number; type?: string }[] = [
  { key: 'business_name', label: 'Business name' },
  { key: 'tagline', label: 'Tagline', hint: 'Shown in the footer and search results.' },
  { key: 'phone', label: 'Phone', hint: 'With country code, e.g. +919876543210' },
  { key: 'whatsapp', label: 'WhatsApp number', hint: 'Leave empty to use the phone number.' },
  { key: 'email', label: 'Email for customers', type: 'email' },
  { key: 'address', label: 'Address' },
  { key: 'hours', label: 'Opening hours', hint: 'e.g. Every day, 7 am – 10 pm' },
  { key: 'founder_name', label: 'Founder name (About page)' },
  { key: 'instagram_url', label: 'Instagram link', type: 'url' },
  { key: 'facebook_url', label: 'Facebook link', type: 'url' },
  { key: 'x_url', label: 'X (Twitter) link', type: 'url' },
  { key: 'youtube_url', label: 'YouTube link', type: 'url' },
  { key: 'google_review_url', label: 'Google reviews link', type: 'url', hint: 'From your Google Business Profile → “Ask for reviews”.' },
];

export function SettingsPage() {
  const toast = useToast();
  const [s, setS] = useState<SettingsRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void supabase.from('site_settings').select('*').single().then(({ data }) => setS(data as SettingsRow)); }, []);

  const set = (k: keyof SettingsRow, v: string) => setS((x) => (x ? { ...x, [k]: v } : x));

  async function save(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!s) return;
    setError(null);
    const clean = (v: unknown) => (typeof v === 'string' ? v.trim() || null : v);
    const phoneOk = (v: string | null) => v === null || /^\+[1-9]\d{7,14}$/.test(v.replace(/\s/g, ''));
    const row: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s)) row[k] = clean(v);
    for (const k of ['phone', 'whatsapp'] as const) {
      if (typeof row[k] === 'string') row[k] = (row[k] as string).replace(/\s/g, '');
      if (!phoneOk(row[k] as string | null)) return setError('Phone numbers need the country code, e.g. +919876543210.');
    }
    for (const k of ['stat_travellers', 'stat_years'] as const) {
      const v = row[k];
      row[k] = v === null || v === '' ? null : Number(v);
      if (row[k] !== null && (!Number.isInteger(row[k]) || (row[k] as number) < 0)) return setError('Headline numbers must be whole numbers.');
    }
    if (!row.business_name) return setError('The business name can’t be empty.');
    setBusy(true);
    const { error } = await supabase.from('site_settings').update(row).eq('id', true);
    setBusy(false);
    if (error) return setError(friendlyError(error));
    toast('Business details saved');
  }

  if (!s) return <div className="grid place-items-center py-16"><Spinner className="h-8 w-8 text-brand" /></div>;

  return (
    <div className="space-y-10">
    <form onSubmit={save} className="space-y-6">
      <div><h2 className="text-2xl font-bold">Business details</h2><p className="text-sm text-slate-600">Shown across the website, in Google results and in customer emails.</p></div>
      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        {TEXT_FIELDS.map((t) => (
          <Field key={t.key} label={t.label} hint={t.hint}>
            {(id) => <input id={id} type={t.type ?? 'text'} value={(s[t.key] as string | null) ?? ''} onChange={(e) => set(t.key, e.target.value)} className={inputClass} />}
          </Field>
        ))}
      </Card>
      <Card className="space-y-4 p-5">
        <Field label="About us text">{(id) => <textarea id={id} rows={6} value={s.about ?? ''} onChange={(e) => set('about', e.target.value)} className={inputClass} />}</Field>
        <Field label="Cancellation policy" hint="Shown on the Cancellation policy page. Leave empty to use the default text.">
          {(id) => <textarea id={id} rows={6} value={s.cancellation_policy ?? ''} onChange={(e) => set('cancellation_policy', e.target.value)} className={inputClass} />}
        </Field>
      </Card>
      <Card className="p-5">
        <h3 className="font-bold">Headline numbers</h3>
        <p className="text-sm text-slate-600">Hidden on the website until you fill them in. Only use numbers you can stand behind.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Happy travellers">{(id) => <input id={id} inputMode="numeric" value={s.stat_travellers ?? ''} onChange={(e) => set('stat_travellers', e.target.value)} className={inputClass} />}</Field>
          <Field label="Years of experience">{(id) => <input id={id} inputMode="numeric" value={s.stat_years ?? ''} onChange={(e) => set('stat_years', e.target.value)} className={inputClass} />}</Field>
        </div>
      </Card>
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
      <Button type="submit" variant="success" busy={busy}>Save details</Button>
      <p className="text-xs text-slate-500">Changes appear on the website after you press <strong>Publish changes</strong>.</p>
    </form>
    <Subscribers />
    </div>
  );
}

/** Emails from the footer's "Get Travel Updates" box. */
function Subscribers() {
  const toast = useToast();
  const [rows, setRows] = useState<{ id: number; email: string; created_at: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    void supabase.from('newsletter_subscribers').select('id,email,created_at').order('created_at', { ascending: false })
      .then(({ data, error }) => (error ? setError(friendlyError(error)) : setRows(data ?? [])));
  useEffect(load, []);

  async function copyAll() {
    if (!rows?.length) return;
    try {
      await navigator.clipboard.writeText(rows.map((r) => r.email).join(', '));
      toast(`${rows.length} emails copied`);
    } catch {
      toast('Couldn’t copy. Select the emails and copy them instead.');
    }
  }
  async function remove(id: number, email: string) {
    if (!confirm(`Remove ${email} from the list?`)) return;
    const { error } = await supabase.from('newsletter_subscribers').delete().eq('id', id);
    if (error) return toast(friendlyError(error));
    setRows((r) => r?.filter((x) => x.id !== id) ?? null);
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-bold">Newsletter subscribers{rows ? ` (${rows.length})` : ''}</h3>
          <p className="text-sm text-slate-600">People who signed up for travel updates in the website footer. Paste them into Gmail’s Bcc to send an offer.</p>
        </div>
        <Button type="button" variant="secondary" onClick={copyAll} disabled={!rows?.length}>Copy all emails</Button>
      </div>
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      {!rows && !error && <div className="py-6"><Spinner className="h-6 w-6 text-brand" /></div>}
      {rows && rows.length === 0 && <p className="mt-4 text-sm text-slate-500">No sign-ups yet.</p>}
      {rows && rows.length > 0 && (
        <ul className="mt-4 divide-y divide-slate-100 text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-2">
              <span className="break-all">{r.email}</span>
              <span className="flex shrink-0 items-center gap-3 text-slate-500">
                {new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                <button type="button" className="text-red-700 hover:underline" onClick={() => void remove(r.id, r.email)}>Remove</button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
