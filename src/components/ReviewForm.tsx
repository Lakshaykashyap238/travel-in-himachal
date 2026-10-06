import { useEffect, useState } from 'react';
import { submitReview, type SubmitReviewResult } from '@/lib/api';

const MESSAGES: Record<Exclude<SubmitReviewResult, 'ok'>, string> = {
  invalid: 'Please fill in every field: your name, a star rating and at least one sentence.',
  not_found: 'We couldn’t find a booking with that reference and phone number. Check both and try again.',
  not_eligible: 'This booking isn’t confirmed yet. You can write a review once your trip is confirmed.',
  already_reviewed: 'A review for this booking has already been sent. Thank you!',
  busy: 'We’re receiving a lot of reviews right now. Please try again in an hour.',
  network: 'Couldn’t send your review. Check your internet connection and try again.',
};

const LABELS = ['', 'Poor', 'Okay', 'Good', 'Very good', 'Excellent'];

export default function ReviewForm() {
  const [f, setF] = useState({ reference: '', phone: '', name: '', place: '', body: '' });
  const [rating, setRating] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  // A link like /review?ref=TIH-10023 fills in the reference.
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get('ref');
    if (ref && /^TIH-\d{1,9}$/i.test(ref)) setF((x) => ({ ...x, reference: ref.toUpperCase() }));
  }, []);

  async function send(e: { preventDefault(): void }) {
    e.preventDefault();
    setError(null);
    if (!/^TIH-\d{1,9}$/i.test(f.reference.trim())) return setError('Enter your booking reference, for example TIH-10023.');
    if (f.phone.replace(/\D/g, '').length < 10) return setError('Enter the 10-digit phone number you booked with.');
    if (f.name.trim().length < 2) return setError('Enter your name.');
    if (!rating) return setError('Choose a star rating.');
    if (f.body.trim().length < 10) return setError('Write at least one sentence about your trip.');
    setBusy(true);
    const result = await submitReview({ ...f, reference: f.reference.trim(), rating });
    setBusy(false);
    if (result === 'ok') setDone(true);
    else setError(MESSAGES[result]);
  }

  const input = 'mt-1 w-full rounded-md border border-black/15 bg-white px-3 py-2.5 text-base focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30';

  if (done)
    return (
      <div className="rounded-xl bg-mist p-8 text-center" role="status">
        <p className="display text-4xl uppercase">Thank you!</p>
        <p className="mt-3 text-lg text-stone">Your review has been sent. It will appear on the website once we’ve checked it.</p>
        <a href="/" className="mt-6 inline-block rounded-md bg-brand px-6 py-3 font-semibold text-white hover:bg-brand-dark">Back to home</a>
      </div>
    );

  return (
    <form onSubmit={send} className="space-y-5" noValidate>
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block font-medium">Booking reference
          <input value={f.reference} onChange={set('reference')} placeholder="TIH-10023" autoCapitalize="characters" className={input} />
        </label>
        <label className="block font-medium">Phone number you booked with
          <input value={f.phone} onChange={set('phone')} inputMode="tel" autoComplete="tel" placeholder="98765 43210" className={input} />
        </label>
        <label className="block font-medium">Your name
          <input value={f.name} onChange={set('name')} maxLength={60} autoComplete="name" className={input} />
        </label>
        <label className="block font-medium">Your city <span className="font-normal text-stone">(optional)</span>
          <input value={f.place} onChange={set('place')} maxLength={60} placeholder="Delhi" className={input} />
        </label>
      </div>

      <fieldset>
        <legend className="font-medium">How was your trip?</legend>
        <div className="mt-2 flex items-center gap-1" role="radiogroup">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} star${n > 1 ? 's' : ''}, ${LABELS[n]}`}
              onClick={() => setRating(n)}
              className={`text-4xl leading-none transition ${n <= rating ? 'text-accent' : 'text-black/15 hover:text-accent/60'}`}>★</button>
          ))}
          {rating > 0 && <span className="ml-3 font-semibold">{LABELS[rating]}</span>}
        </div>
      </fieldset>

      <label className="block font-medium">Your review
        <textarea value={f.body} onChange={set('body')} rows={5} maxLength={700} placeholder="What did you like about the trip, the car and the driver?" className={input} />
        <span className="mt-1 block text-right text-sm font-normal text-stone">{f.body.length}/700</span>
      </label>

      {error && <p className="rounded-md bg-red-50 p-3 text-red-800" role="alert">{error}</p>}

      <button type="submit" disabled={busy} className="w-full rounded-md bg-brand px-6 py-3.5 text-lg font-semibold text-white hover:bg-brand-dark disabled:opacity-60 sm:w-auto">
        {busy ? 'Sending…' : 'Send review'}
      </button>
      <p className="text-sm text-stone">We check every review before it appears. Your phone number is only used to match your booking and is never shown.</p>
    </form>
  );
}
