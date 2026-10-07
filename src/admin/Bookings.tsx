import { useCallback, useEffect, useMemo, useState } from 'react';
import { friendlyError, supabase } from './lib/supabase';
import { STATUS_LABEL, STATUS_TONE, type Booking, type BookingStatus, type HistoryEntry, type StaffMember } from './lib/types';
import { downloadCsv, fmtDate, fmtDateTime, inr, timeAgo, todayIst, whatsappUrl } from './lib/util';
import { Badge, Button, Card, EmptyState, Field, Modal, Spinner, cx, inputClass, useToast } from './ui';

type View = 'new' | 'upcoming' | 'all';
const SELECT = '*, package:packages(name), vehicle:vehicles(name)';
const SEEN_KEY = 'tih.admin.seen';

function loadSeen(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]')); } catch { return new Set(); }
}
function saveSeen(s: Set<string>) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...s].slice(-500))); } catch { /* ignore */ }
}

export const tripLabel = (b: Booking) =>
  b.type === 'tour' ? (b.package?.name ?? 'Tour') : `Cab · ${b.pickup} → ${b.dropoff ?? ''}`;

export function BookingsPage({ me, openId, onOpen }: { me: StaffMember; openId: string | null; onOpen: (id: string | null) => void }) {
  const toast = useToast();
  const [view, setView] = useState<View>('new');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Booking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seen, setSeen] = useState<Set<string>>(loadSeen);
  const [stats, setStats] = useState({ pending: 0, upcoming: 0, month: 0 });
  const [names, setNames] = useState<Record<string, string>>({});

  const today = todayIst();

  const load = useCallback(async () => {
    let query = supabase.from('bookings').select(SELECT).limit(300);
    if (view === 'new') query = query.eq('status', 'pending').order('created_at', { ascending: true });
    else if (view === 'upcoming') query = query.eq('status', 'accepted').gte('travel_date', today).order('travel_date', { ascending: true });
    else query = query.order('created_at', { ascending: false });
    const term = q.trim().replace(/[%,()]/g, '');
    if (term) query = query.or(`reference.ilike.%${term}%,customer_name.ilike.%${term}%,phone.ilike.%${term}%`);
    const { data, error } = await query;
    if (error) return setError(friendlyError(error));
    setError(null);
    setRows(data as Booking[]);
  }, [view, q, today]);

  const loadStats = useCallback(async () => {
    const monthStart = `${today.slice(0, 7)}-01`;
    const [p, u, m] = await Promise.all([
      supabase.from('bookings').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('bookings').select('id', { count: 'exact', head: true }).eq('status', 'accepted').gte('travel_date', today),
      supabase.from('bookings').select('id', { count: 'exact', head: true }).in('status', ['accepted', 'completed']).gte('created_at', monthStart),
    ]);
    setStats({ pending: p.count ?? 0, upcoming: u.count ?? 0, month: m.count ?? 0 });
  }, [today]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadStats(); }, [loadStats]);
  useEffect(() => {
    void supabase.rpc('staff_directory').then(({ data }) =>
      setNames(Object.fromEntries(((data ?? []) as StaffMember[]).map((s) => [s.user_id, s.full_name]))));
  }, []);

  // Live updates: refresh the list and counters whenever any booking changes.
  useEffect(() => {
    let timer: number | undefined;
    const ch = supabase
      .channel('bookings-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => { void load(); void loadStats(); }, 300);
      })
      .subscribe();
    return () => { window.clearTimeout(timer); void supabase.removeChannel(ch); };
  }, [load, loadStats]);

  const markSeen = (id: string) => setSeen((s) => { const n = new Set(s).add(id); saveSeen(n); return n; });
  const open = (b: Booking) => { markSeen(b.id); onOpen(b.id); };

  const exportCsv = () => {
    if (!rows?.length) return;
    downloadCsv(
      `bookings-${view}-${today}.csv`,
      ['Reference', 'Status', 'Received', 'Type', 'Tour', 'Car', 'Travel date', 'Travellers', 'Name', 'Phone', 'Email', 'Pickup', 'Drop-off', 'Agreed fare', 'Rejection reason', 'Notes', 'Handled by'],
      rows.map((b) => [
        b.reference, STATUS_LABEL[b.status], b.created_at, b.type, b.package?.name ?? '', b.vehicle?.name ?? '', b.travel_date, b.travellers,
        b.customer_name, b.phone, b.email, b.pickup, b.dropoff, b.agreed_fare, b.rejection_reason, b.notes, b.handled_by ? names[b.handled_by] ?? '' : '',
      ]),
    );
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Waiting for you', value: stats.pending, tone: stats.pending ? 'text-amber-700' : 'text-ink', view: 'new' as View },
          { label: 'Upcoming trips', value: stats.upcoming, tone: 'text-ink', view: 'upcoming' as View },
          { label: 'Confirmed this month', value: stats.month, tone: 'text-ink', view: 'all' as View },
        ].map((s) => (
          <button key={s.label} type="button" onClick={() => setView(s.view)} className="rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-black/5 hover:ring-slate-300">
            <span className="block text-xs font-medium text-slate-500 sm:text-sm">{s.label}</span>
            <span className={cx('text-2xl font-bold sm:text-3xl', s.tone)}>{s.value}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-xl bg-slate-200/70 p-1" role="tablist">
          {(['new', 'upcoming', 'all'] as View[]).map((v) => (
            <button key={v} role="tab" aria-selected={view === v} type="button" onClick={() => setView(v)}
              className={cx('rounded-lg px-3 py-1.5 text-sm font-semibold', view === v ? 'bg-white shadow-sm' : 'text-slate-600')}>
              {v === 'new' ? `New${stats.pending ? ` (${stats.pending})` : ''}` : v === 'upcoming' ? 'Upcoming' : 'All'}
            </button>
          ))}
        </div>
        <input type="search" placeholder="Search name, phone or TIH-…" value={q} onChange={(e) => setQ(e.target.value)} className={cx(inputClass, 'order-last w-full py-2 sm:order-none sm:w-auto sm:max-w-xs sm:flex-1')} aria-label="Search bookings" />
        <Button variant="secondary" className="ml-auto" onClick={exportCsv} disabled={!rows?.length}>Export CSV</Button>
      </div>

      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}

      {rows === null ? (
        <div className="grid place-items-center py-16"><Spinner className="h-8 w-8 text-brand" /></div>
      ) : rows.length === 0 ? (
        <EmptyState title={view === 'new' ? 'No bookings waiting. 🎉' : 'No bookings here yet.'}>
          {view === 'new' && 'New requests appear here instantly, with a sound.'}
        </EmptyState>
      ) : (
        <Card className="divide-y divide-slate-100 overflow-hidden">
          {rows.map((b) => {
            const unseen = b.status === 'pending' && !seen.has(b.id);
            return (
              <button key={b.id} type="button" onClick={() => open(b)}
                className={cx('grid w-full grid-cols-[1fr_auto] gap-x-4 gap-y-1 px-4 py-3.5 text-left hover:bg-slate-50 sm:grid-cols-[8rem_1fr_9rem_8rem]', unseen && 'bg-amber-50/60')}>
                <span className="flex items-center gap-2 font-mono text-sm font-semibold">
                  {unseen && <span className="h-2.5 w-2.5 rounded-full bg-amber-500" aria-label="Not opened yet" />}
                  {b.reference}
                </span>
                <span className="order-3 col-span-2 min-w-0 sm:order-none sm:col-span-1">
                  <span className="block truncate font-semibold">{b.customer_name}</span>
                  <span className="block truncate text-sm text-slate-600">{tripLabel(b)} · {b.travellers} pax</span>
                </span>
                <span className="order-4 text-sm text-slate-700 sm:order-none">{fmtDate(b.travel_date)}</span>
                <span className="order-2 flex flex-col items-end gap-1 sm:order-none">
                  <Badge className={STATUS_TONE[b.status]}>{STATUS_LABEL[b.status]}</Badge>
                  <span className="text-xs text-slate-500">{timeAgo(b.created_at)}</span>
                </span>
              </button>
            );
          })}
        </Card>
      )}

      <BookingDetail id={openId} me={me} names={names} onClose={() => onOpen(null)} onChanged={() => { void load(); void loadStats(); window.dispatchEvent(new Event('tih:bookings-changed')); toast('Saved'); }} />
    </div>
  );
}

type Action = { kind: 'accept' | 'reject' | 'complete' | 'cancel' | 'note' } | null;

function BookingDetail({ id, me, names, onClose, onChanged }: {
  id: string | null; me: StaffMember; names: Record<string, string>; onClose: () => void; onChanged: () => void;
}) {
  const [b, setB] = useState<Booking | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [action, setAction] = useState<Action>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const [{ data, error }, h] = await Promise.all([
      supabase.from('bookings').select(SELECT).eq('id', id).maybeSingle(),
      supabase.rpc('booking_history', { p_booking_id: id }),
    ]);
    if (error) return setError(friendlyError(error));
    setB((data as Booking) ?? null);
    setHistory((h.data ?? []) as HistoryEntry[]);
  }, [id]);

  useEffect(() => { setB(null); setHistory([]); setAction(null); setError(null); void load(); }, [load]);

  // Keep the open booking live too (e.g. a colleague accepts it).
  useEffect(() => {
    if (!id) return;
    const ch = supabase.channel(`booking-${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bookings', filter: `id=eq.${id}` }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [id, load]);

  const trackLink = b ? `${window.location.origin}/track#${b.tracking_token}` : '';
  const waText = !b ? ''
    : b.status === 'accepted'
      ? `Hello ${b.customer_name}, your booking ${b.reference} with Travel In Himachal is CONFIRMED ✅\n\n${tripLabel(b)}, ${fmtDate(b.travel_date)}${b.agreed_fare != null ? `\nFare: ${inr(b.agreed_fare)}` : ''}\n\nTrack your booking: ${trackLink}\n\nWe'll share the driver's details before your trip.`
      : b.status === 'rejected'
        ? `Hello ${b.customer_name}, sorry, we can't take your booking ${b.reference} (${tripLabel(b)}, ${fmtDate(b.travel_date)}).${b.rejection_reason ? `\nReason: ${b.rejection_reason}` : ''}\nReply here if you'd like another date or car.`
        : `Hello ${b.customer_name}, this is about your booking ${b.reference} (${tripLabel(b)}, ${fmtDate(b.travel_date)}).`;

  return (
    <Modal open={Boolean(id)} onClose={onClose} title={b ? `Booking ${b.reference}` : 'Booking'} wide>
      {!b ? (
        error ? <p className="text-red-700">{error}</p> : <div className="grid place-items-center py-10"><Spinner className="h-8 w-8 text-brand" /></div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <Badge className={cx(STATUS_TONE[b.status], 'text-sm')}>{STATUS_LABEL[b.status]}</Badge>
            <span className="text-sm text-slate-500">Received {fmtDateTime(b.created_at)}{b.handled_by && ` · handled by ${names[b.handled_by] ?? 'staff'}`}</span>
          </div>

          <section className="grid gap-4 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Customer</p>
              <p className="text-lg font-semibold">{b.customer_name}</p>
              <p className="font-mono">{b.phone}</p>
              {b.email && <p className="break-all text-sm text-slate-600">{b.email}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                <a href={`tel:${b.phone}`} className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white">📞 Call</a>
                <a href={whatsappUrl(b.phone, waText)} target="_blank" rel="noopener" className="rounded-xl bg-[#25D366] px-4 py-2 text-sm font-semibold text-white">{b.status === 'accepted' ? 'Send confirmation on WhatsApp' : 'WhatsApp'}</a>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-slate-500">{b.type === 'tour' ? 'Tour' : 'Trip'}</dt><dd className="font-medium">{b.type === 'tour' ? b.package?.name : 'Cab only'}</dd>
              <dt className="text-slate-500">Car</dt><dd className="font-medium">{b.vehicle?.name}</dd>
              <dt className="text-slate-500">Travel date</dt><dd className="font-medium">{fmtDate(b.travel_date)}</dd>
              <dt className="text-slate-500">Travellers</dt><dd className="font-medium">{b.travellers}</dd>
              <dt className="text-slate-500">Pickup</dt><dd className="font-medium">{b.pickup}</dd>
              {b.dropoff && (<><dt className="text-slate-500">Drop-off</dt><dd className="font-medium">{b.dropoff}</dd></>)}
              {b.agreed_fare != null && (<><dt className="text-slate-500">Agreed fare</dt><dd className="font-semibold text-brand">{inr(b.agreed_fare)}</dd></>)}
            </dl>
            {b.notes && <p className="rounded-xl bg-white p-3 text-sm sm:col-span-2"><span className="font-semibold">Customer’s note: </span>{b.notes}</p>}
            {b.rejection_reason && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-900 sm:col-span-2"><span className="font-semibold">Rejection reason: </span>{b.rejection_reason}</p>}
          </section>

          <div className="flex flex-wrap gap-2">
            {b.status === 'pending' && (<>
              <Button variant="success" onClick={() => setAction({ kind: 'accept' })}>Accept</Button>
              <Button variant="danger" onClick={() => setAction({ kind: 'reject' })}>Reject</Button>
            </>)}
            {b.status === 'accepted' && (<>
              <Button variant="primary" onClick={() => setAction({ kind: 'complete' })}>Mark trip completed</Button>
              <Button variant="secondary" onClick={() => setAction({ kind: 'cancel' })}>Cancel booking</Button>
            </>)}
            <Button variant="ghost" onClick={() => setAction({ kind: 'note' })}>Add note</Button>
          </div>

          {action && <ActionForm booking={b} action={action} onCancel={() => setAction(null)} onDone={() => { setAction(null); void load(); onChanged(); }} />}

          <section>
            <h3 className="font-bold">History</h3>
            <ol className="mt-3 space-y-3 border-l-2 border-slate-200 pl-4">
              {history.map((h) => (
                <li key={h.id} className="text-sm">
                  <p className="font-medium">
                    {h.kind === 'created' ? 'Booking received' : h.kind === 'note' ? 'Note' : `${STATUS_LABEL[h.from_status!]} → ${STATUS_LABEL[h.to_status!]}`}
                    <span className="font-normal text-slate-500"> · {h.actor_name} · {fmtDateTime(h.created_at)}</span>
                  </p>
                  {h.note && <p className="mt-0.5 whitespace-pre-line text-slate-700">{h.note}</p>}
                </li>
              ))}
            </ol>
          </section>
          <p className="text-xs text-slate-400">Signed in as {me.full_name}. Every change is recorded and can’t be edited.</p>
        </div>
      )}
    </Modal>
  );
}

function ActionForm({ booking: b, action, onCancel, onDone }: { booking: Booking; action: NonNullable<Action>; onCancel: () => void; onDone: () => void }) {
  const [fare, setFare] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cfg = useMemo(() => ({
    accept: { title: 'Accept this booking', button: 'Accept booking', variant: 'success' as const, status: 'accepted' as BookingStatus, textLabel: 'Note for the team (optional)' },
    reject: { title: 'Reject this booking', button: 'Reject booking', variant: 'danger' as const, status: 'rejected' as BookingStatus, textLabel: 'Reason (the customer will see this)' },
    complete: { title: 'Mark as completed', button: 'Mark completed', variant: 'primary' as const, status: 'completed' as BookingStatus, textLabel: 'Note (optional)' },
    cancel: { title: 'Cancel this booking', button: 'Cancel booking', variant: 'danger' as const, status: 'cancelled' as BookingStatus, textLabel: 'Why is it cancelled? (internal)' },
    note: { title: 'Add a note', button: 'Save note', variant: 'primary' as const, status: null, textLabel: 'Note (only staff see this)' },
  })[action.kind], [action.kind]);

  async function submit(e: { preventDefault(): void }) {
    e.preventDefault();
    setError(null);
    if (action.kind === 'reject' && !text.trim()) return setError('Please give a reason — the customer will see it.');
    if (action.kind === 'note' && !text.trim()) return setError('Write a note first.');
    const fareNum = fare.trim() === '' ? null : Number(fare.replace(/[,\s₹]/g, ''));
    if (fareNum !== null && (!Number.isFinite(fareNum) || fareNum < 0 || !Number.isInteger(fareNum))) return setError('Enter the fare as a whole number of rupees.');
    setBusy(true);
    const { error } = action.kind === 'note'
      ? await supabase.rpc('add_booking_note', { p_booking_id: b.id, p_note: text.trim() })
      : await supabase.rpc('set_booking_status', {
          p_booking_id: b.id,
          p_status: cfg.status,
          p_agreed_fare: action.kind === 'accept' ? fareNum : null,
          p_reason: action.kind === 'reject' ? text.trim() : null,
          p_note: action.kind === 'reject' ? null : text.trim() || null,
        });
    setBusy(false);
    if (error) return setError(friendlyError(error));
    onDone();
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-200 p-4">
      <h3 className="font-bold">{cfg.title}</h3>
      {action.kind === 'accept' && (
        <Field label="Agreed fare (₹)" hint="The total you agreed with the customer. Shown on their booking page and email.">
          {(id) => <input id={id} inputMode="numeric" placeholder="e.g. 18500" value={fare} onChange={(e) => setFare(e.target.value)} className={inputClass} />}
        </Field>
      )}
      <Field label={cfg.textLabel}>
        {(id) => <textarea id={id} rows={3} maxLength={action.kind === 'reject' ? 500 : 1000} value={text} onChange={(e) => setText(e.target.value)} className={inputClass} />}
      </Field>
      {action.kind === 'accept' && b.email && <p className="text-sm text-slate-600">The customer will get a confirmation email at {b.email}.</p>}
      {action.kind === 'reject' && b.email && <p className="text-sm text-slate-600">The customer will get an email with this reason.</p>}
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" variant={cfg.variant} busy={busy}>{cfg.button}</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Back</Button>
      </div>
    </form>
  );
}
