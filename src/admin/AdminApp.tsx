import { useCallback, useEffect, useState } from 'react';
import { AuthGate } from './Auth';
import { BookingsPage } from './Bookings';
import { CarsPage, DestinationsPage, ReviewsPage, ToursPage } from './Content';
import { SettingsPage } from './Settings';
import { StaffPage } from './Staff';
import { callFunction, supabase } from './lib/supabase';
import { disablePush, enablePush, pushState, type PushState } from './lib/push';
import type { StaffMember } from './lib/types';
import { playChime, timeAgo, unlockSound } from './lib/util';
import { Button, ToastProvider, cx, useToast } from './ui';

type Route = { page: 'bookings'; id: string | null } | { page: 'tours' | 'cars' | 'destinations' | 'reviews' | 'settings' | 'staff' | 'alerts' };

function parseHash(): Route {
  const [, page, id] = window.location.hash.replace(/^#/, '').split('/');
  if (page === 'bookings' || !page) return { page: 'bookings', id: id ?? null };
  if (['tours', 'cars', 'destinations', 'reviews', 'settings', 'staff', 'alerts'].includes(page)) return { page } as Route;
  return { page: 'bookings', id: null };
}

function useRoute(): [Route, (hash: string) => void] {
  const [route, setRoute] = useState<Route>(parseHash);
  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return [route, (hash) => { window.location.hash = hash; }];
}

export default function AdminApp() {
  return (
    <ToastProvider>
      <AuthGate>{(me, signOut) => <Dashboard me={me} signOut={signOut} />}</AuthGate>
    </ToastProvider>
  );
}

const NAV = [
  { page: 'bookings', label: 'Bookings', owner: false },
  { page: 'tours', label: 'Tours', owner: true },
  { page: 'cars', label: 'Cars', owner: true },
  { page: 'destinations', label: 'Destinations', owner: true },
  { page: 'reviews', label: 'Reviews', owner: true },
  { page: 'settings', label: 'Business details', owner: true },
  { page: 'staff', label: 'Staff', owner: true },
  { page: 'alerts', label: 'Alerts', owner: false },
] as const;

const SHORT: Record<string, string> = { destinations: 'Places', settings: 'Business' };

function Dashboard({ me, signOut }: { me: StaffMember; signOut: () => void }) {
  const toast = useToast();
  const [route, go] = useRoute();
  const [pending, setPending] = useState(0);
  const isOwner = me.role === 'owner';

  // Unlock the notification sound on the first tap/click (browser rule).
  useEffect(() => {
    const on = () => unlockSound();
    window.addEventListener('pointerdown', on, { once: true });
    return () => window.removeEventListener('pointerdown', on);
  }, []);

  // Live alert for new bookings on every screen: sound + toast + tab title.
  const refreshPending = useCallback(async () => {
    const { count } = await supabase.from('bookings').select('id', { count: 'exact', head: true }).eq('status', 'pending');
    setPending(count ?? 0);
  }, []);
  useEffect(() => {
    void refreshPending();
    const ch = supabase
      .channel('new-bookings')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bookings' }, (p) => {
        const b = p.new as { reference: string; customer_name: string };
        playChime();
        toast(`New booking ${b.reference} from ${b.customer_name}`, 'info');
        void refreshPending();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bookings' }, () => void refreshPending())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [refreshPending, toast]);

  // Our own changes (accept/reject) refresh the counter immediately.
  useEffect(() => {
    const on = () => void refreshPending();
    window.addEventListener('tih:bookings-changed', on);
    return () => window.removeEventListener('tih:bookings-changed', on);
  }, [refreshPending]);

  useEffect(() => {
    document.title = `${pending ? `(${pending}) ` : ''}Admin · Travel In Himachal`;
  }, [pending]);

  const allowed = NAV.filter((n) => !n.owner || isOwner);
  const page = allowed.some((n) => n.page === route.page) ? route.page : 'bookings';

  return (
    <div className="min-h-screen bg-slate-100 pb-20 lg:pb-0">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <a href="#/bookings" className="flex min-w-0 flex-col leading-tight">
            <span className="font-bold text-brand">Admin</span>
            <span className="max-w-[9.5rem] truncate text-xs text-slate-500 sm:max-w-[14rem]" title={me.full_name}>👤 {me.full_name} · {isOwner ? 'Owner' : 'Staff'}</span>
          </a>
          <nav className="hidden gap-1 lg:flex" aria-label="Admin">
            {allowed.map((n) => (
              <a key={n.page} href={`#/${n.page}`} aria-current={page === n.page ? 'page' : undefined}
                className={cx('rounded-lg px-3 py-1.5 text-sm font-medium', page === n.page ? 'bg-slate-100 text-ink' : 'text-slate-600 hover:text-ink')}>
                {n.label}{n.page === 'bookings' && pending > 0 && <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 text-xs text-white">{pending}</span>}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {isOwner && <PublishButton />}
            <a href="/" target="_blank" rel="noopener" className="hidden rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:text-ink sm:block">View site ↗</a>
            <button type="button" onClick={signOut} className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">Sign out</button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {page === 'bookings' && <BookingsPage me={me} openId={route.page === 'bookings' ? route.id : null} onOpen={(id) => go(id ? `/bookings/${id}` : '/bookings')} />}
        {page === 'tours' && <ToursPage />}
        {page === 'cars' && <CarsPage />}
        {page === 'destinations' && <DestinationsPage />}
        {page === 'reviews' && <ReviewsPage />}
        {page === 'settings' && <SettingsPage />}
        {page === 'staff' && <StaffPage me={me} />}
        {page === 'alerts' && <AlertsPage me={me} />}
      </main>

      {/* Phone navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex overflow-x-auto border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="Admin">
        {allowed.map((n) => (
          <a key={n.page} href={`#/${n.page}`} aria-current={page === n.page ? 'page' : undefined}
            className={cx('relative shrink-0 grow whitespace-nowrap px-3.5 py-3 text-center text-xs font-semibold', page === n.page ? 'text-brand' : 'text-slate-500')}>
            {SHORT[n.page] ?? n.label}
            {n.page === 'bookings' && pending > 0 && <span className="ml-1 rounded-full bg-amber-500 px-1.5 text-[10px] text-white">{pending}</span>}
          </a>
        ))}
      </nav>
    </div>
  );
}

function PublishButton() {
  const toast = useToast();
  const [state, setState] = useState<{ changed: string | null; published: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('publish_state').select('content_changed_at, last_publish_at').single();
    if (data) setState({ changed: data.content_changed_at, published: data.last_publish_at });
  }, []);
  useEffect(() => {
    void load();
    const id = window.setInterval(load, 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  const unpublished = Boolean(state?.changed && (!state.published || state.changed > state.published));

  async function publish() {
    setBusy(true);
    const { status } = await callFunction('publish-site').catch(() => ({ status: 0 }));
    setBusy(false);
    if (status === 202) { toast('Publishing… your changes will be live in about 3 minutes.'); void load(); }
    else if (status === 429) toast('Already publishing — give it a couple of minutes.', 'info');
    else toast('Couldn’t start publishing. Please try again.', 'error');
  }

  return (
    <Button variant={unpublished ? 'success' : 'secondary'} className="py-1.5" busy={busy} onClick={publish}
      title={state?.published ? `Last published ${timeAgo(state.published)}` : undefined}>
      {unpublished ? '● Publish changes' : 'Publish'}
    </Button>
  );
}

function AlertsPage({ me }: { me: StaffMember }) {
  const toast = useToast();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void pushState().then(setState); }, []);

  async function toggle() {
    setBusy(true);
    try {
      setState(state === 'on' ? await disablePush() : await enablePush(me.user_id));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e);
      toast(`Couldn’t change alerts on this device (${msg}).`, 'error');
    }
    setBusy(false);
  }

  const text: Record<PushState, string> = {
    on: 'This device will get a notification for every new booking, even when this page is closed.',
    off: 'Turn on to get a notification on this device for every new booking.',
    denied: 'Notifications are blocked for this site. Allow them in your browser’s site settings, then come back.',
    unsupported: 'This browser can’t receive notifications. Try Chrome on Android or a desktop browser.',
    'needs-install': 'On iPhone: tap Share → “Add to Home Screen”, open the admin from the new icon, then turn alerts on here (iOS 16.4 or later).',
    'not-configured': 'Phone alerts aren’t set up on the server yet (docs/SETUP.md → Alerts).',
  };

  return (
    <div className="max-w-xl space-y-6">
      <div><h2 className="text-2xl font-bold">Alerts</h2><p className="text-sm text-slate-600">How you hear about new bookings.</p></div>
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
        <h3 className="font-bold">Notifications on this device</h3>
        <p className="mt-1 text-sm text-slate-600">{state ? text[state] : 'Checking…'}</p>
        {(state === 'on' || state === 'off') && (
          <Button className="mt-4" variant={state === 'on' ? 'secondary' : 'success'} busy={busy} onClick={toggle}>
            {state === 'on' ? 'Turn off on this device' : 'Turn on for this device'}
          </Button>
        )}
      </div>
      <div className="rounded-2xl bg-white p-5 text-sm text-slate-700 shadow-sm ring-1 ring-black/5">
        <h3 className="font-bold text-ink">Also</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>While this dashboard is open, new bookings play a sound and appear instantly.</li>
          <li>Owners also get an email for every new booking.</li>
          <li>If a booking is still waiting after 30 minutes, everyone gets a reminder.</li>
        </ul>
      </div>
    </div>
  );
}
