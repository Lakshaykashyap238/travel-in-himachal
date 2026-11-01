import { useState } from 'react';
import { submitReview, type SubmitReviewResult } from '@/lib/api';

const MESSAGES: Record<Exclude<SubmitReviewResult, 'ok'>, string> = {
  invalid: 'Please fill in your name, a star rating and at least one sentence.',
  busy: 'We’re receiving a lot of reviews right now. Please try again in an hour.',
  network: 'Couldn’t send your review. Check your internet connection and try again.',
};

const LABELS = ['', 'Poor', 'Okay', 'Good', 'Very good', 'Excellent'];

export default function ReviewForm() {
  const [f, setF] = useState({ name: '', place: '', body: '', website: '' });
  const [rating, setRating] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function send(e: { preventDefault(): void }) {
    e.preventDefault();
    setError(null);
    if (f.name.trim().length < 2) return setError('Enter your name.');
    if (!rating) return setError('Choose a star rating.');
    if (f.body.trim().length < 10) return setError('Write at least one sentence about your trip.');
    // Hidden field only bots fill in: pretend it worked, send nothing.
    if (f.website) return setDone(true);
    setBusy(true);
    const result = await submitReview({ name: f.name.trim(), place: f.place.trim(), rating, body: f.body.trim() });
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
    <form onSubmit={send} className="relative space-y-5" noValidate>
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block font-medium">Your name
          <input value={f.name} onChange={set('name')} maxLength={60} autoComplete="name" className={input} />
        </label>
        <label className="block font-medium">Your city <span className="font-normal text-stone">(optional)</span>
          <input value={f.place} onChange={set('place')} maxLength={60} placeholder="Delhi" className={input} />
        </label>
      </div>

      <input type="text" name="website" value={f.website} onChange={set('website')} tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-px w-px opacity-0" />

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
      <p className="text-sm text-stone">Booked online, by phone or in person? Everyone is welcome to share their experience. We read every review before it appears on the website.</p>
    </form>
  );
}
