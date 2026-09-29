import { useEffect, useMemo, useRef, useState } from 'react';
import { bookingInputSchema, MAX_DAYS_AHEAD, MAX_TRAVELLERS, type BookingCreated, type BookingErrorCode } from '@shared/booking-schema';
import { backendConfigured, createBooking, rememberBooking } from '@/lib/api';

interface TourOption { slug: string; name: string; duration: string }
interface CarOption { slug: string; name: string; seats: number }

interface Props {
  tours: TourOption[];
  cars: CarOption[];
  turnstileSiteKey: string;
  phone: string | null;
}

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id?: string) => void;
    };
  }
}

const COUNTRY_CODES = [
  { code: '+91', label: 'India (+91)' },
  { code: '+971', label: 'UAE (+971)' },
  { code: '+44', label: 'UK (+44)' },
  { code: '+1', label: 'USA / Canada (+1)' },
  { code: '+61', label: 'Australia (+61)' },
  { code: '+65', label: 'Singapore (+65)' },
  { code: '+977', label: 'Nepal (+977)' },
];

const ERROR_TEXT: Record<BookingErrorCode | 'network', string> = {
  invalid_input: 'Some details need fixing — see the highlighted fields.',
  bot_check_failed: 'The security check didn’t pass. Please wait for it to finish and try again.',
  rate_limited: 'Too many requests from this number or connection. Please call us instead, or try again later.',
  unavailable_item: 'That tour or car is no longer available. Please choose another.',
  invalid_date: `Please choose a date between today and ${MAX_DAYS_AHEAD} days from now.`,
  server_error: 'Something went wrong on our side. Please try again, or call us.',
  network: 'Couldn’t reach our server. Check your internet connection and try again.',
};

/** Today's date in India as YYYY-MM-DD. */
const todayIst = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export default function BookingForm({ tours, cars, turnstileSiteKey, phone }: Props) {
  const [type, setType] = useState<'tour' | 'cab'>('tour');
  const [packageSlug, setPackageSlug] = useState('');
  const [vehicleSlug, setVehicleSlug] = useState(cars[0]?.slug ?? '');
  const [customerName, setName] = useState('');
  const [countryCode, setCountryCode] = useState('+91');
  const [localPhone, setLocalPhone] = useState('');
  const [email, setEmail] = useState('');
  const [travelDate, setTravelDate] = useState('');
  const [travellers, setTravellers] = useState(2);
  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');
  const [notes, setNotes] = useState('');
  const [consent, setConsent] = useState(false);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<BookingCreated | null>(null);

  const [token, setToken] = useState<string | null>(null);
  const widgetRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | undefined>(undefined);

  const minDate = useMemo(todayIst, []);
  const maxDate = useMemo(() => addDays(minDate, MAX_DAYS_AHEAD), [minDate]);
  const car = cars.find((c) => c.slug === vehicleSlug);

  // Pre-fill from links like /book?tour=spiti-kaza-7-days or /book?type=cab&car=maruti-ertiga
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const t = q.get('tour');
    if (t && tours.some((x) => x.slug === t)) {
      setType('tour');
      setPackageSlug(t);
    } else if (q.get('type') === 'cab') setType('cab');
    const c = q.get('car');
    if (c && cars.some((x) => x.slug === c)) setVehicleSlug(c);
  }, [tours, cars]);

  // Cloudflare Turnstile bot check
  useEffect(() => {
    if (!backendConfigured || !turnstileSiteKey || !widgetRef.current) return;
    const render = () => {
      if (!window.turnstile || !widgetRef.current || widgetId.current) return;
      widgetId.current = window.turnstile.render(widgetRef.current, {
        sitekey: turnstileSiteKey,
        action: 'booking',
        callback: (t: string) => setToken(t),
        'expired-callback': () => setToken(null),
        'error-callback': () => setToken(null),
      });
    };
    if (window.turnstile) render();
    else {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = render;
      document.head.appendChild(s);
    }
    return () => {
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = undefined;
    };
  }, [turnstileSiteKey, done]);

  const normalisedPhone = () => {
    const digits = localPhone.replace(/\D/g, '').replace(/^0+/, '');
    return `${countryCode}${digits}`;
  };

  async function onSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    setFormError(null);

    const input = {
      type,
      packageSlug: type === 'tour' ? packageSlug || undefined : undefined,
      vehicleSlug,
      customerName,
      phone: normalisedPhone(),
      email,
      travelDate,
      travellers,
      pickup,
      dropoff: dropoff || undefined,
      notes: notes || undefined,
      consent,
    };

    const parsed = bookingInputSchema.safeParse(input);
    const fieldErrors: Record<string, string> = {};
    if (!parsed.success) for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    if (countryCode === '+91' && !/^[6-9]\d{9}$/.test(localPhone.replace(/\D/g, '').replace(/^0+/, '')))
      fieldErrors.phone = 'Enter a 10-digit Indian mobile number';
    if (travelDate && (travelDate < minDate || travelDate > maxDate))
      fieldErrors.travelDate = `Choose a date between today and ${MAX_DAYS_AHEAD} days from now`;
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length) {
      document.getElementById(`f-${Object.keys(fieldErrors)[0]}`)?.focus();
      return;
    }
    if (!token) {
      setFormError('Please wait a moment for the security check to finish.');
      return;
    }

    setSubmitting(true);
    const res = await createBooking({ ...input, turnstileToken: token } as never);
    setSubmitting(false);

    if (res.ok) {
      rememberBooking(res.booking);
      setDone(res.booking);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (res.fields?.length) setErrors(Object.fromEntries(res.fields.map((f) => [f.field.split('.')[0], f.message])));
    setFormError(ERROR_TEXT[res.code] ?? ERROR_TEXT.server_error);
    setToken(null);
    if (widgetId.current) window.turnstile?.reset(widgetId.current);
  }

  if (done) {
    const trackUrl = `/track#${done.trackingToken}`;
    return (
      <div className="rounded-2xl bg-white p-8 text-center shadow-[0_10px_30px_rgba(0,0,0,.08)] ring-1 ring-black/5" role="status">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-brand/10 text-2xl text-brand">✓</div>
        <h2 className="mt-4 text-2xl font-bold">Booking request sent</h2>
        <p className="mt-2 text-slate-600">Your reference is</p>
        <p className="mt-1 font-mono text-3xl font-bold tracking-wider">{done.reference}</p>
        <p className="mx-auto mt-4 max-w-md text-slate-600">
          We’ll review your request and call you to confirm the fare. Follow the status on your private tracking page — bookmark it or save the link.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <a href={trackUrl} className="rounded-full bg-brand px-6 py-3 font-semibold text-white hover:bg-brand-dark">Track my booking</a>
          {phone && <a href={`tel:${phone}`} className="rounded-full border border-slate-300 px-6 py-3 font-semibold hover:bg-slate-50">Call us</a>}
        </div>
      </div>
    );
  }

  const field = 'mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base outline-none focus:border-ink focus:ring-4 focus:ring-black/5 aria-[invalid=true]:border-red-500';
  const label = 'block text-sm font-semibold text-slate-700';
  const err = (k: string) =>
    errors[k] ? <p id={`e-${k}`} className="mt-1 text-sm text-red-600">{errors[k]}</p> : null;
  const aria = (k: string) => ({ 'aria-invalid': Boolean(errors[k]), 'aria-describedby': errors[k] ? `e-${k}` : undefined });

  return (
    <form onSubmit={onSubmit} noValidate className="rounded-2xl bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,.08)] ring-1 ring-black/5 sm:p-8">
      {!backendConfigured && (
        <p className="mb-6 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
          Online booking is being set up. {phone ? <>Please call <a className="font-semibold underline" href={`tel:${phone}`}>{phone}</a> to book.</> : 'Please contact us to book.'}
        </p>
      )}

      <fieldset>
        <legend className={label}>What would you like to book?</legend>
        <div className="mt-2 grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
          {(['tour', 'cab'] as const).map((t) => (
            <label key={t} className={`cursor-pointer rounded-lg px-4 py-2.5 text-center font-semibold transition ${type === t ? 'bg-white shadow-sm' : 'text-slate-600'}`}>
              <input type="radio" name="type" value={t} checked={type === t} onChange={() => setType(t)} className="sr-only" />
              {t === 'tour' ? 'Tour package' : 'Cab only'}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        {type === 'tour' && (
          <div className="sm:col-span-2">
            <label htmlFor="f-packageSlug" className={label}>Tour</label>
            <select id="f-packageSlug" value={packageSlug} onChange={(e) => setPackageSlug(e.target.value)} className={field} {...aria('packageSlug')}>
              <option value="">Choose a tour…</option>
              {tours.map((t) => <option key={t.slug} value={t.slug}>{t.name} — {t.duration}</option>)}
            </select>
            {err('packageSlug')}
          </div>
        )}

        <div>
          <label htmlFor="f-vehicleSlug" className={label}>Car</label>
          <select id="f-vehicleSlug" value={vehicleSlug} onChange={(e) => setVehicleSlug(e.target.value)} className={field} {...aria('vehicleSlug')}>
            {cars.map((c) => <option key={c.slug} value={c.slug}>{c.name} · {c.seats} seats</option>)}
          </select>
          {err('vehicleSlug')}
        </div>

        <div>
          <label htmlFor="f-travellers" className={label}>Travellers</label>
          <input id="f-travellers" type="number" inputMode="numeric" min={1} max={MAX_TRAVELLERS} value={travellers} onChange={(e) => setTravellers(Number(e.target.value))} className={field} {...aria('travellers')} />
          {car && travellers > car.seats && !errors.travellers && (
            <p className="mt-1 text-sm text-amber-700">A {car.name} seats {car.seats}. We’ll suggest a bigger car or two cars.</p>
          )}
          {err('travellers')}
        </div>

        <div>
          <label htmlFor="f-travelDate" className={label}>Travel date</label>
          <input id="f-travelDate" type="date" min={minDate} max={maxDate} value={travelDate} onChange={(e) => setTravelDate(e.target.value)} className={field} {...aria('travelDate')} />
          {err('travelDate')}
        </div>

        <div>
          <label htmlFor="f-customerName" className={label}>Your name</label>
          <input id="f-customerName" autoComplete="name" value={customerName} onChange={(e) => setName(e.target.value)} className={field} {...aria('customerName')} />
          {err('customerName')}
        </div>

        <div>
          <label htmlFor="f-phone" className={label}>Mobile number</label>
          <div className="mt-1 flex gap-2">
            <select aria-label="Country code" value={countryCode} onChange={(e) => setCountryCode(e.target.value)} className="rounded-xl border border-slate-300 bg-white px-2 py-3">
              {COUNTRY_CODES.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </select>
            <input id="f-phone" type="tel" inputMode="tel" autoComplete="tel-national" placeholder={countryCode === '+91' ? '98765 43210' : ''} value={localPhone} onChange={(e) => setLocalPhone(e.target.value)} className={`${field} mt-0`} {...aria('phone')} />
          </div>
          {err('phone')}
        </div>

        <div>
          <label htmlFor="f-email" className={label}>Email <span className="font-normal text-slate-500">(optional, for updates)</span></label>
          <input id="f-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={field} {...aria('email')} />
          {err('email')}
        </div>

        <div className={type === 'tour' ? 'sm:col-span-2' : ''}>
          <label htmlFor="f-pickup" className={label}>Pickup location</label>
          <input id="f-pickup" placeholder="e.g. Chandigarh railway station" value={pickup} onChange={(e) => setPickup(e.target.value)} className={field} {...aria('pickup')} />
          {err('pickup')}
        </div>

        {type === 'cab' && (
          <div>
            <label htmlFor="f-dropoff" className={label}>Drop-off location</label>
            <input id="f-dropoff" placeholder="e.g. Manali Mall Road" value={dropoff} onChange={(e) => setDropoff(e.target.value)} className={field} {...aria('dropoff')} />
            {err('dropoff')}
          </div>
        )}

        <div className="sm:col-span-2">
          <label htmlFor="f-notes" className={label}>Anything else? <span className="font-normal text-slate-500">(optional)</span></label>
          <textarea id="f-notes" rows={3} maxLength={1000} placeholder="Return date, hotel help, child seat, luggage…" value={notes} onChange={(e) => setNotes(e.target.value)} className={field} />
        </div>
      </div>

      <div className="mt-6">
        <label className="flex items-start gap-3 text-sm text-slate-700">
          <input id="f-consent" type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-5 w-5 accent-[var(--color-brand)]" {...aria('consent')} />
          <span>I agree that my details are used to handle this booking, as described in the <a href="/privacy" className="font-semibold text-brand underline" target="_blank">privacy policy</a>.</span>
        </label>
        {err('consent')}
      </div>

      <div ref={widgetRef} className="mt-6 min-h-[65px]" />

      {formError && <p className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800" role="alert">{formError}</p>}

      <button type="submit" disabled={submitting || !backendConfigured} className="mt-6 w-full rounded-full bg-brand px-6 py-4 text-lg font-semibold text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60">
        {submitting ? 'Sending…' : 'Send booking request'}
      </button>
      <p className="mt-3 text-center text-sm text-slate-500">No payment now. We’ll call you to confirm the fare.</p>
    </form>
  );
}
