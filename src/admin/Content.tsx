// Tours, cars and destinations editors (owner only).
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { friendlyError, photoUrl, supabase } from './lib/supabase';
import type { DestinationRow, ReviewRow, TourRow, VehicleRow } from './lib/types';
import { inr, lines, slugify } from './lib/util';
import { PhotoPicker } from './PhotoPicker';
import { Badge, Button, Card, EmptyState, Field, Modal, Spinner, Toggle, inputClass, useToast } from './ui';

const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s.replace(/[,\s₹]/g, '')));
const validInt = (n: number | null, min = 0) => n === null || (Number.isInteger(n) && n >= min);

function ListShell<T extends { id: string; name: string; is_active: boolean; image_path: string | null }>({
  title, intro, rows, render, onNew, onEdit,
}: { title: string; intro: string; rows: T[] | null; render: (r: T) => ReactNode; onNew: () => void; onEdit: (r: T) => void }) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="text-2xl font-bold">{title}</h2><p className="text-sm text-slate-600">{intro}</p></div>
        <Button onClick={onNew}>+ Add</Button>
      </div>
      {rows === null ? <div className="grid place-items-center py-16"><Spinner className="h-8 w-8 text-brand" /></div>
        : rows.length === 0 ? <EmptyState title="Nothing here yet." />
        : (
          <Card className="divide-y divide-slate-100 overflow-hidden">
            {rows.map((r) => (
              <button key={r.id} type="button" onClick={() => onEdit(r)} className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-slate-50">
                <span className="h-12 w-16 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                  {photoUrl(r.image_path) && <img src={photoUrl(r.image_path)!} alt="" className="h-full w-full object-cover" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{r.name}</span>
                  <span className="block truncate text-sm text-slate-600">{render(r)}</span>
                </span>
                {!r.is_active && <Badge className="bg-slate-100 text-slate-600 ring-slate-300">Hidden</Badge>}
              </button>
            ))}
          </Card>
        )}
    </div>
  );
}

function useRows<T>(table: string, order = 'sort_order', then = 'name') {
  const [rows, setRows] = useState<T[] | null>(null);
  const reload = useCallback(async () => {
    const { data } = await supabase.from(table).select('*').order(order).order(then, then === 'created_at' ? { ascending: false } : undefined);
    setRows((data ?? []) as T[]);
  }, [table, order, then]);
  useEffect(() => { void reload(); }, [reload]);
  return { rows, reload };
}

function FormActions({ busy, error, onDelete, onCancel, isNew }: { busy: boolean; error: string | null; onDelete?: () => void; onCancel: () => void; isNew: boolean }) {
  return (
    <div className="space-y-3 border-t border-slate-100 pt-4">
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="success" busy={busy}>{isNew ? 'Add' : 'Save changes'}</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        {!isNew && onDelete && <Button type="button" variant="ghost" className="ml-auto text-red-700" onClick={onDelete}>Delete</Button>}
      </div>
      <p className="text-xs text-slate-500">Saved changes appear on the website after you press <strong>Publish changes</strong>.</p>
    </div>
  );
}

// ── Tours ─────────────────────────────────────────────────────────────
export function ToursPage() {
  const { rows, reload } = useRows<TourRow>('packages');
  const [editing, setEditing] = useState<Partial<TourRow> | null>(null);
  return (
    <>
      <ListShell title="Tours" intro="Prices, photos, places and day-by-day plans for each tour." rows={rows}
        render={(t) => `${t.duration_days}D/${t.duration_nights}N · ${t.starting_price != null ? `from ${inr(t.starting_price)}` : 'price on request'}`}
        onNew={() => setEditing({})} onEdit={setEditing} />
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing?.id ? `Edit: ${editing.name}` : 'Add a tour'} wide>
        {editing && <TourForm initial={editing} onDone={() => { setEditing(null); void reload(); }} />}
      </Modal>
    </>
  );
}

function TourForm({ initial, onDone }: { initial: Partial<TourRow>; onDone: () => void }) {
  const toast = useToast();
  const isNew = !initial.id;
  const [f, setF] = useState({
    name: initial.name ?? '', slug: initial.slug ?? '',
    duration_days: String(initial.duration_days ?? 3), duration_nights: String(initial.duration_nights ?? 2),
    starting_price: initial.starting_price != null ? String(initial.starting_price) : '',
    best_time: initial.best_time ?? '', group_size: initial.group_size ?? '',
    summary: initial.summary ?? '', description: initial.description ?? '',
    places: (initial.places ?? []).join('\n'), inclusions: (initial.inclusions ?? []).join('\n'), exclusions: (initial.exclusions ?? []).join('\n'),
    destination_id: initial.destination_id ?? '', image_path: initial.image_path ?? null as string | null,
    is_active: initial.is_active ?? true, sort_order: String(initial.sort_order ?? 100),
  });
  const [days, setDays] = useState<{ day: number; title: string; details?: string }[]>(initial.itinerary ?? []);
  const [dests, setDests] = useState<DestinationRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (v: string | boolean | null) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => { void supabase.from('destinations').select('id,name').order('name').then(({ data }) => setDests((data ?? []) as DestinationRow[])); }, []);

  async function save(e: { preventDefault(): void }) {
    e.preventDefault();
    setError(null);
    const slug = (f.slug || slugify(f.name)).trim();
    const nums = { d: numOrNull(f.duration_days), n: numOrNull(f.duration_nights), p: numOrNull(f.starting_price), s: numOrNull(f.sort_order) ?? 100 };
    if (f.name.trim().length < 2) return setError('Give the tour a name.');
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return setError('The web address may only use lower-case letters, numbers and dashes.');
    if (!validInt(nums.d, 1) || nums.d === null || !validInt(nums.n) || nums.n === null) return setError('Enter the number of days and nights.');
    if (!validInt(nums.p)) return setError('Enter the price as a whole number of rupees, or leave it empty for “price on request”.');
    const row = {
      name: f.name.trim(), slug, duration_days: nums.d, duration_nights: nums.n, starting_price: nums.p,
      best_time: f.best_time.trim() || null, group_size: f.group_size.trim() || null,
      summary: f.summary.trim() || null, description: f.description.trim() || null,
      places: lines(f.places), inclusions: lines(f.inclusions), exclusions: lines(f.exclusions),
      itinerary: days.filter((d) => d.title.trim()).map((d, i) => ({ day: i + 1, title: d.title.trim(), ...(d.details?.trim() ? { details: d.details.trim() } : {}) })),
      destination_id: f.destination_id || null, image_path: f.image_path, is_active: f.is_active, sort_order: nums.s,
    };
    setBusy(true);
    const { error } = isNew ? await supabase.from('packages').insert(row) : await supabase.from('packages').update(row).eq('id', initial.id!);
    setBusy(false);
    if (error) return setError(friendlyError(error));
    toast(isNew ? 'Tour added' : 'Tour saved');
    onDone();
  }

  async function remove() {
    if (!window.confirm(`Delete “${initial.name}”? If it has bookings, hide it instead.`)) return;
    const { error } = await supabase.from('packages').delete().eq('id', initial.id!);
    if (error) return setError(friendlyError(error));
    toast('Tour deleted');
    onDone();
  }

  return (
    <form onSubmit={save} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tour name" className="sm:col-span-2">{(id) => <input id={id} value={f.name} onChange={(e) => set('name')(e.target.value)} className={inputClass} />}</Field>
        <Field label="Web address" hint={`travelinhimachal.in/tours/${f.slug || slugify(f.name) || '…'}`}>
          {(id) => <input id={id} value={f.slug} placeholder={slugify(f.name)} onChange={(e) => set('slug')(e.target.value)} className={inputClass} />}
        </Field>
        <Field label="Starting price per traveller (₹)" hint="Leave empty to show “Price on request”.">
          {(id) => <input id={id} inputMode="numeric" value={f.starting_price} onChange={(e) => set('starting_price')(e.target.value)} className={inputClass} />}
        </Field>
        <Field label="Days">{(id) => <input id={id} inputMode="numeric" value={f.duration_days} onChange={(e) => set('duration_days')(e.target.value)} className={inputClass} />}</Field>
        <Field label="Nights">{(id) => <input id={id} inputMode="numeric" value={f.duration_nights} onChange={(e) => set('duration_nights')(e.target.value)} className={inputClass} />}</Field>
        <Field label="Best time to visit">{(id) => <input id={id} placeholder="Mar – Jun" value={f.best_time} onChange={(e) => set('best_time')(e.target.value)} className={inputClass} />}</Field>
        <Field label="Group size">{(id) => <input id={id} placeholder="2 – 6 people" value={f.group_size} onChange={(e) => set('group_size')(e.target.value)} className={inputClass} />}</Field>
        <Field label="Destination">
          {(id) => (
            <select id={id} value={f.destination_id} onChange={(e) => set('destination_id')(e.target.value)} className={inputClass}>
              <option value="">—</option>
              {dests.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}
        </Field>
        <Field label="Order on the website" hint="Lower numbers show first.">{(id) => <input id={id} inputMode="numeric" value={f.sort_order} onChange={(e) => set('sort_order')(e.target.value)} className={inputClass} />}</Field>
      </div>

      <Field label="Photo">{() => <PhotoPicker value={f.image_path} folder="tours" onChange={(p) => set('image_path')(p)} />}</Field>
      <Field label="Short summary" hint="One or two sentences. Also used as the Google description.">{(id) => <textarea id={id} rows={2} maxLength={300} value={f.summary} onChange={(e) => set('summary')(e.target.value)} className={inputClass} />}</Field>
      <Field label="Full description">{(id) => <textarea id={id} rows={5} value={f.description} onChange={(e) => set('description')(e.target.value)} className={inputClass} />}</Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Places covered" hint="One per line.">{(id) => <textarea id={id} rows={6} value={f.places} onChange={(e) => set('places')(e.target.value)} className={inputClass} />}</Field>
        <Field label="Included" hint="One per line.">{(id) => <textarea id={id} rows={6} value={f.inclusions} onChange={(e) => set('inclusions')(e.target.value)} className={inputClass} />}</Field>
        <Field label="Not included" hint="One per line.">{(id) => <textarea id={id} rows={6} value={f.exclusions} onChange={(e) => set('exclusions')(e.target.value)} className={inputClass} />}</Field>
      </div>

      <fieldset>
        <legend className="text-sm font-semibold text-slate-700">Day-by-day plan</legend>
        <div className="mt-2 space-y-3">
          {days.map((d, i) => (
            <div key={i} className="grid gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-[4rem_1fr_auto]">
              <span className="pt-2.5 text-sm font-semibold text-brand">Day {i + 1}</span>
              <div className="space-y-2">
                <input aria-label={`Day ${i + 1} title`} placeholder="e.g. Shimla to Narkanda" value={d.title} onChange={(e) => setDays((x) => x.map((y, j) => (j === i ? { ...y, title: e.target.value } : y)))} className={inputClass} />
                <textarea aria-label={`Day ${i + 1} details`} rows={2} placeholder="Details (optional)" value={d.details ?? ''} onChange={(e) => setDays((x) => x.map((y, j) => (j === i ? { ...y, details: e.target.value } : y)))} className={inputClass} />
              </div>
              <Button type="button" variant="ghost" onClick={() => setDays((x) => x.filter((_, j) => j !== i))} aria-label={`Remove day ${i + 1}`}>Remove</Button>
            </div>
          ))}
          <Button type="button" variant="secondary" onClick={() => setDays((x) => [...x, { day: x.length + 1, title: '' }])}>+ Add a day</Button>
        </div>
      </fieldset>

      <Toggle checked={f.is_active} onChange={(v) => set('is_active')(v)} label={f.is_active ? 'Shown on the website' : 'Hidden from the website'} />
      <FormActions busy={busy} error={error} isNew={isNew} onDelete={remove} onCancel={onDone} />
    </form>
  );
}

// ── Cars ──────────────────────────────────────────────────────────────
export function CarsPage() {
  const { rows, reload } = useRows<VehicleRow>('vehicles');
  const [editing, setEditing] = useState<Partial<VehicleRow> | null>(null);
  return (
    <>
      <ListShell title="Cars" intro="Your fleet: seats, luggage, price per day and photos." rows={rows}
        render={(v) => `${v.seats} seats · ${v.luggage} bags · ${v.price_per_day != null ? `${inr(v.price_per_day)}/day` : 'price on request'}`}
        onNew={() => setEditing({})} onEdit={setEditing} />
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing?.id ? `Edit: ${editing.name}` : 'Add a car'} wide>
        {editing && <CarForm initial={editing} onDone={() => { setEditing(null); void reload(); }} />}
      </Modal>
    </>
  );
}

function CarForm({ initial, onDone }: { initial: Partial<VehicleRow>; onDone: () => void }) {
  const toast = useToast();
  const isNew = !initial.id;
  const [f, setF] = useState({
    name: initial.name ?? '', slug: initial.slug ?? '', seats: String(initial.seats ?? 4), luggage: String(initial.luggage ?? 2),
    price_per_day: initial.price_per_day != null ? String(initial.price_per_day) : '', features: (initial.features ?? []).join('\n'),
    description: initial.description ?? '', image_path: initial.image_path ?? null as string | null, is_active: initial.is_active ?? true, sort_order: String(initial.sort_order ?? 100),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (v: string | boolean | null) => setF((x) => ({ ...x, [k]: v }));

  async function save(e: { preventDefault(): void }) {
    e.preventDefault();
    setError(null);
    const slug = (f.slug || slugify(f.name)).trim();
    const seats = numOrNull(f.seats), luggage = numOrNull(f.luggage), price = numOrNull(f.price_per_day);
    if (f.name.trim().length < 2) return setError('Give the car a name.');
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return setError('The web address may only use lower-case letters, numbers and dashes.');
    if (seats === null || !validInt(seats, 1) || luggage === null || !validInt(luggage)) return setError('Enter seats and bags as whole numbers.');
    if (!validInt(price)) return setError('Enter the price as a whole number of rupees, or leave it empty.');
    const row = { name: f.name.trim(), slug, seats, luggage, price_per_day: price, features: lines(f.features), description: f.description.trim() || null, image_path: f.image_path, is_active: f.is_active, sort_order: numOrNull(f.sort_order) ?? 100 };
    setBusy(true);
    const { error } = isNew ? await supabase.from('vehicles').insert(row) : await supabase.from('vehicles').update(row).eq('id', initial.id!);
    setBusy(false);
    if (error) return setError(friendlyError(error));
    toast(isNew ? 'Car added' : 'Car saved');
    onDone();
  }

  async function remove() {
    if (!window.confirm(`Delete “${initial.name}”? If it has bookings, hide it instead.`)) return;
    const { error } = await supabase.from('vehicles').delete().eq('id', initial.id!);
    if (error) return setError(friendlyError(error));
    toast('Car deleted');
    onDone();
  }

  return (
    <form onSubmit={save} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Car name">{(id) => <input id={id} value={f.name} onChange={(e) => set('name')(e.target.value)} className={inputClass} />}</Field>
        <Field label="Web address (slug)">{(id) => <input id={id} value={f.slug} placeholder={slugify(f.name)} onChange={(e) => set('slug')(e.target.value)} className={inputClass} />}</Field>
        <Field label="Passenger seats">{(id) => <input id={id} inputMode="numeric" value={f.seats} onChange={(e) => set('seats')(e.target.value)} className={inputClass} />}</Field>
        <Field label="Bags">{(id) => <input id={id} inputMode="numeric" value={f.luggage} onChange={(e) => set('luggage')(e.target.value)} className={inputClass} />}</Field>
        <Field label="Starting price per day (₹)" hint="Leave empty for “Price on request”.">{(id) => <input id={id} inputMode="numeric" value={f.price_per_day} onChange={(e) => set('price_per_day')(e.target.value)} className={inputClass} />}</Field>
        <Field label="Order on the website">{(id) => <input id={id} inputMode="numeric" value={f.sort_order} onChange={(e) => set('sort_order')(e.target.value)} className={inputClass} />}</Field>
      </div>
      <Field label="Photo" hint="A car on a plain or transparent background looks best.">{() => <PhotoPicker value={f.image_path} folder="fleet" onChange={(p) => set('image_path')(p)} />}</Field>
      <Field label="Short description">{(id) => <textarea id={id} rows={2} maxLength={2000} value={f.description} onChange={(e) => set('description')(e.target.value)} className={inputClass} />}</Field>
      <Field label="Features" hint="One per line, e.g. Air conditioning.">{(id) => <textarea id={id} rows={5} value={f.features} onChange={(e) => set('features')(e.target.value)} className={inputClass} />}</Field>
      <Toggle checked={f.is_active} onChange={(v) => set('is_active')(v)} label={f.is_active ? 'Available for booking' : 'Hidden (not bookable)'} />
      <FormActions busy={busy} error={error} isNew={isNew} onDelete={remove} onCancel={onDone} />
    </form>
  );
}

// ── Destinations ──────────────────────────────────────────────────────
export function DestinationsPage() {
  const { rows, reload } = useRows<DestinationRow>('destinations');
  const [editing, setEditing] = useState<Partial<DestinationRow> | null>(null);
  return (
    <>
      <ListShell title="Destinations" intro="Each destination has its own page on the website." rows={rows}
        render={(d) => d.places.slice(0, 4).join(' · ') || 'No places listed'}
        onNew={() => setEditing({})} onEdit={setEditing} />
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing?.id ? `Edit: ${editing.name}` : 'Add a destination'} wide>
        {editing && <DestinationForm initial={editing} onDone={() => { setEditing(null); void reload(); }} />}
      </Modal>
    </>
  );
}

function DestinationForm({ initial, onDone }: { initial: Partial<DestinationRow>; onDone: () => void }) {
  const toast = useToast();
  const isNew = !initial.id;
  const [f, setF] = useState({
    name: initial.name ?? '', slug: initial.slug ?? '', summary: initial.summary ?? '', description: initial.description ?? '',
    places: (initial.places ?? []).join('\n'), image_path: initial.image_path ?? null as string | null, is_active: initial.is_active ?? true, sort_order: String(initial.sort_order ?? 100),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (v: string | boolean | null) => setF((x) => ({ ...x, [k]: v }));

  async function save(e: { preventDefault(): void }) {
    e.preventDefault();
    setError(null);
    const slug = (f.slug || slugify(f.name)).trim();
    if (f.name.trim().length < 2) return setError('Give the destination a name.');
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return setError('The web address may only use lower-case letters, numbers and dashes.');
    const row = { name: f.name.trim(), slug, summary: f.summary.trim() || null, description: f.description.trim() || null, places: lines(f.places), image_path: f.image_path, is_active: f.is_active, sort_order: numOrNull(f.sort_order) ?? 100 };
    setBusy(true);
    const { error } = isNew ? await supabase.from('destinations').insert(row) : await supabase.from('destinations').update(row).eq('id', initial.id!);
    setBusy(false);
    if (error) return setError(friendlyError(error));
    toast(isNew ? 'Destination added' : 'Destination saved');
    onDone();
  }

  async function remove() {
    if (!window.confirm(`Delete “${initial.name}”? Tours linked to it will lose the link.`)) return;
    const { error } = await supabase.from('destinations').delete().eq('id', initial.id!);
    if (error) return setError(friendlyError(error));
    toast('Destination deleted');
    onDone();
  }

  return (
    <form onSubmit={save} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">{(id) => <input id={id} value={f.name} onChange={(e) => set('name')(e.target.value)} className={inputClass} />}</Field>
        <Field label="Web address" hint={`/destinations/${f.slug || slugify(f.name) || '…'}`}>{(id) => <input id={id} value={f.slug} placeholder={slugify(f.name)} onChange={(e) => set('slug')(e.target.value)} className={inputClass} />}</Field>
      </div>
      <Field label="Photo">{() => <PhotoPicker value={f.image_path} folder="destinations" onChange={(p) => set('image_path')(p)} />}</Field>
      <Field label="Short summary" hint="Used as the Google description.">{(id) => <textarea id={id} rows={2} maxLength={300} value={f.summary} onChange={(e) => set('summary')(e.target.value)} className={inputClass} />}</Field>
      <Field label="Description">{(id) => <textarea id={id} rows={5} value={f.description} onChange={(e) => set('description')(e.target.value)} className={inputClass} />}</Field>
      <Field label="Places to see" hint="One per line.">{(id) => <textarea id={id} rows={6} value={f.places} onChange={(e) => set('places')(e.target.value)} className={inputClass} />}</Field>
      <Toggle checked={f.is_active} onChange={(v) => set('is_active')(v)} label={f.is_active ? 'Shown on the website' : 'Hidden from the website'} />
      <FormActions busy={busy} error={error} isNew={isNew} onDelete={remove} onCancel={onDone} />
    </form>
  );
}


// ── Reviews ───────────────────────────────────────────────────────────
const SOURCES = ['Website', 'Google', 'WhatsApp', 'Instagram', 'Facebook', 'In person', 'Other'];
const stars = (n: number) => '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);

export function ReviewsPage() {
  const { rows, reload } = useRows<ReviewRow>('reviews', 'sort_order', 'created_at');
  const [editing, setEditing] = useState<Partial<ReviewRow> | null>(null);
  return (
    <>
      <ListShell title="Reviews" intro="Real reviews from your customers, shown on the home page. Copy them from Google or WhatsApp with the customer's name." rows={rows}
        render={(r) => `${r.from_customer && !r.is_active ? 'Waiting for your approval · ' : ''}${stars(r.rating)} ${r.body}`}
        onNew={() => setEditing({})} onEdit={setEditing} />
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing?.id ? `Edit review: ${editing.name}` : 'Add a review'} wide>
        {editing && <ReviewForm initial={editing} onDone={() => { setEditing(null); void reload(); }} />}
      </Modal>
    </>
  );
}

function ReviewForm({ initial, onDone }: { initial: Partial<ReviewRow>; onDone: () => void }) {
  const toast = useToast();
  const isNew = !initial.id;
  const [f, setF] = useState({
    name: initial.name ?? '', place: initial.place ?? '', trip: initial.trip ?? '', rating: String(initial.rating ?? 5),
    body: initial.body ?? '', source: initial.source ?? 'Google', is_active: initial.is_active ?? true, sort_order: String(initial.sort_order ?? 100),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (v: string | boolean) => setF((x) => ({ ...x, [k]: v }));

  async function save(e: { preventDefault(): void }) {
    e.preventDefault();
    setError(null);
    if (f.name.trim().length < 2) return setError("Add the customer's name.");
    if (f.body.trim().length < 10) return setError('Paste the review text (at least a sentence).');
    const row = {
      name: f.name.trim(), place: f.place.trim() || null, trip: f.trip.trim() || null, rating: Number(f.rating),
      body: f.body.trim(), source: f.source, is_active: f.is_active, sort_order: numOrNull(f.sort_order) ?? 100,
    };
    setBusy(true);
    const { error } = isNew ? await supabase.from('reviews').insert(row) : await supabase.from('reviews').update(row).eq('id', initial.id!);
    setBusy(false);
    if (error) return setError(friendlyError(error));
    toast(isNew ? 'Review added' : 'Review saved');
    onDone();
  }

  async function remove() {
    if (!window.confirm(`Delete the review from ${initial.name}?`)) return;
    const { error } = await supabase.from('reviews').delete().eq('id', initial.id!);
    if (error) return setError(friendlyError(error));
    toast('Review deleted');
    onDone();
  }

  return (
    <form onSubmit={save} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Customer's name">{(id) => <input id={id} value={f.name} maxLength={60} onChange={(e) => set('name')(e.target.value)} className={inputClass} />}</Field>
        <Field label="From (optional)" hint="e.g. Delhi">{(id) => <input id={id} value={f.place} maxLength={60} onChange={(e) => set('place')(e.target.value)} className={inputClass} />}</Field>
        <Field label="Trip (optional)" hint="e.g. Spiti tour, May 2026">{(id) => <input id={id} value={f.trip} maxLength={80} onChange={(e) => set('trip')(e.target.value)} className={inputClass} />}</Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Stars">{(id) => (
            <select id={id} value={f.rating} onChange={(e) => set('rating')(e.target.value)} className={inputClass}>
              {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{stars(n)}</option>)}
            </select>
          )}</Field>
          <Field label="Where it was posted">{(id) => (
            <select id={id} value={f.source} onChange={(e) => set('source')(e.target.value)} className={inputClass}>
              {SOURCES.map((s) => <option key={s}>{s}</option>)}
            </select>
          )}</Field>
        </div>
      </div>
      <Field label="Review" hint="The customer's own words. Only add real reviews.">{(id) => <textarea id={id} rows={5} maxLength={700} value={f.body} onChange={(e) => set('body')(e.target.value)} className={inputClass} />}</Field>
      <Field label="Order" hint="Lower numbers show first.">{(id) => <input id={id} inputMode="numeric" value={f.sort_order} onChange={(e) => set('sort_order')(e.target.value)} className={inputClass} />}</Field>
      {initial.from_customer && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Sent by the customer from the website{initial.trip ? ` (${initial.trip})` : ''}. Turn on “Shown on the website” to approve it.</p>}
      <Toggle checked={f.is_active} onChange={(v) => set('is_active')(v)} label={f.is_active ? 'Shown on the website' : 'Hidden from the website'} />
      <FormActions busy={busy} error={error} isNew={isNew} onDelete={remove} onCancel={onDone} />
    </form>
  );
}
