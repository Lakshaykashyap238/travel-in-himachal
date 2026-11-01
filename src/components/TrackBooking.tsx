import { useCallback, useEffect, useState } from 'react';
import { backendConfigured, getBookingByToken, type BookingStatus, type TrackedBooking } from '@/lib/api';

interface Props { phone: string | null }

const STATUS: Record<BookingStatus, { label: string; tone: string; text: string }> = {
  pending: { label: 'Waiting for confirmation', tone: 'bg-amber-100 text-amber-900', text: 'We’ve received your request and will call you soon to confirm the fare.' },
  accepted: { label: 'Confirmed', tone: 'bg-green-100 text-green-900', text: 'Your trip is confirmed. We’ll share driver details before your travel date.' },
  rejected: { label: 'Not available', tone: 'bg-red-100 text-red-900', text: 'Sorry, we can’t take this booking.' },
  completed: { label: 'Completed', tone: 'bg-slate-200 text-slate-800', text: 'Thank you for travelling with us.' },
  cancelled: { label: 'Cancelled', tone: 'bg-slate-200 text-slate-800', text: 'This booking was cancelled.' },
};

const POLL_MS = 20_000;
const POLL_FOR_MS = 30 * 60_000;

const fmtDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
const inr = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

export default function TrackBooking({ phone }: Props) {
  const [token, setToken] = useState<string | null>(null);
  const [booking, setBooking] = useState<TrackedBooking | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  // The token lives in the URL fragment (#…), which browsers never send to servers or put in logs.
  useEffect(() => {
    const read = () => setToken(window.location.hash.slice(1) || null);
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const b = await getBookingByToken(token);
      setBooking(b);
      setError(null);
      setCheckedAt(new Date());
    } catch {
      setError('Couldn’t load your booking right now. Check your connection — we’ll keep trying.');
    }
  }, [token]);

  useEffect(() => {
    if (!token || !backendConfigured) return;
    load();
    const started = Date.now();
    const id = window.setInterval(() => {
      if (document.hidden) return;
      if (Date.now() - started > POLL_FOR_MS) return window.clearInterval(id);
      load();
    }, POLL_MS);
    const onVisible = () => !document.hidden && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [token, load]);

  const box = 'rounded-2xl bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,.08)] ring-1 ring-black/5 sm:p-8';

  if (!backendConfigured) return <div className={box}><p>Booking tracking is being set up. Please contact us for your booking status.</p></div>;
  if (!token || !/^[0-9a-f]{48}$/.test(token))
    return (
      <div className={box}>
        <h2 className="text-xl font-bold">Tracking link not recognised</h2>
        <p className="mt-2 text-stone">Open the full link you received after booking. If you’ve lost it, call us with your booking reference.</p>
      </div>
    );
  if (booking === undefined && !error) return <div className={box} aria-busy="true"><p className="text-stone">Loading your booking…</p></div>;
  if (booking === null)
    return (
      <div className={box}>
        <h2 className="text-xl font-bold">Booking not found</h2>
        <p className="mt-2 text-stone">This link doesn’t match a booking. Please check you copied the whole link, or call us with your reference.</p>
      </div>
    );

  return (
    <div className={box}>
      {error && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900" role="alert">{error}</p>}
      {booking && (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm text-slate-500">Booking reference</p>
              <p className="font-mono text-2xl font-bold tracking-wider">{booking.reference}</p>
            </div>
            <span className={`rounded-full px-4 py-1.5 text-sm font-semibold ${STATUS[booking.status].tone}`} aria-live="polite">{STATUS[booking.status].label}</span>
          </div>

          <p className="mt-5 text-lg">{STATUS[booking.status].text}</p>
          {booking.status === 'rejected' && booking.rejection_reason && <p className="mt-2 rounded-xl bg-red-50 p-4 text-red-900">Reason: {booking.rejection_reason}</p>}
          {booking.status === 'accepted' && booking.agreed_fare != null && <p className="mt-2 text-lg">Agreed fare: <strong>{inr(booking.agreed_fare)}</strong></p>}

          <dl className="mt-6 grid gap-4 border-t border-slate-100 pt-6 sm:grid-cols-2">
            <div><dt className="text-sm text-slate-500">{booking.type === 'tour' ? 'Tour' : 'Trip'}</dt><dd className="font-semibold">{booking.package_name ?? 'Cab booking'}</dd></div>
            <div><dt className="text-sm text-slate-500">Car</dt><dd className="font-semibold">{booking.vehicle_name}</dd></div>
            <div><dt className="text-sm text-slate-500">Travel date</dt><dd className="font-semibold">{fmtDate(booking.travel_date)}</dd></div>
            <div><dt className="text-sm text-slate-500">Travellers</dt><dd className="font-semibold">{booking.travellers}</dd></div>
            <div><dt className="text-sm text-slate-500">Pickup</dt><dd className="font-semibold">{booking.pickup}</dd></div>
            {booking.dropoff && <div><dt className="text-sm text-slate-500">Drop-off</dt><dd className="font-semibold">{booking.dropoff}</dd></div>}
          </dl>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-6">
            <p className="text-xs text-slate-500">{checkedAt && `Updated ${checkedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} · refreshes automatically`}</p>
            <div className="flex flex-wrap gap-2">
              {(booking.status === 'accepted' || booking.status === 'completed') && (
                <a href="/review" className="rounded-md bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand-dark">Write a review</a>
              )}
              {phone && <a href={`tel:${phone}`} className="rounded-md border border-slate-300 px-5 py-2 text-sm font-semibold hover:bg-mist">Call us about this booking</a>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
