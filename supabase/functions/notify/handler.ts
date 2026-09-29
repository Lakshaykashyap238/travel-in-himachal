// notify — delivers one queued notification from public.notification_outbox.
//
// Called by the database (pg_net) right after a notification is queued, and
// again by the 5-minute retry job if delivery failed. Protected by a shared
// secret header; never called from browsers.
//
//   booking_created   → push to every staff device + email to owners
//   pending_reminder  → push to every staff device + email to owners
//   booking_decided   → email to the customer (accepted / not available)

export interface OutboxItem {
  id: number;
  kind: 'booking_created' | 'booking_decided' | 'pending_reminder';
  sent_at: string | null;
  attempts: number;
  booking: {
    id: string;
    reference: string;
    tracking_token: string;
    type: 'tour' | 'cab';
    customer_name: string;
    phone: string;
    email: string | null;
    travel_date: string;
    travellers: number;
    pickup: string;
    dropoff: string | null;
    status: string;
    agreed_fare: number | null;
    rejection_reason: string | null;
    package_name: string | null;
    vehicle_name: string;
  };
}

export interface PushSubscription { id: string; endpoint: string; p256dh: string; auth: string }
export interface Recipient { full_name: string; role: 'owner' | 'staff'; email: string | null }

export interface NotifyDeps {
  secret: string;
  siteUrl: string;
  businessName: string;
  loadItem: (id: number) => Promise<OutboxItem | null>;
  pushSubscriptions: () => Promise<PushSubscription[]>;
  recipients: () => Promise<Recipient[]>;
  /** Returns 'ok', 'gone' (subscription expired → delete it) or 'error'. */
  sendPush: (sub: PushSubscription, payload: string) => Promise<'ok' | 'gone' | 'error'>;
  deleteSubscription: (id: string) => Promise<void>;
  /** Returns false if email isn't configured or the provider refused. */
  sendEmail: (msg: { to: string; subject: string; text: string; html: string }) => Promise<boolean>;
  emailConfigured: boolean;
  markSent: (id: number, note?: string) => Promise<void>;
  markFailed: (id: number, error: string) => Promise<void>;
  log?: (...a: unknown[]) => void;
}

/** Constant-time string comparison for the shared secret. */
export function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

export function tripLine(b: OutboxItem['booking']): string {
  const what = b.type === 'tour' ? (b.package_name ?? 'Tour') : `Cab: ${b.pickup} → ${b.dropoff ?? ''}`;
  return `${what} · ${fmtDate(b.travel_date)} · ${b.travellers} ${b.travellers === 1 ? 'traveller' : 'travellers'}`;
}

export function staffPushPayload(item: OutboxItem, siteUrl: string): string {
  const b = item.booking;
  const reminder = item.kind === 'pending_reminder';
  return JSON.stringify({
    title: reminder ? `⏰ Still waiting: ${b.reference}` : `New booking ${b.reference}`,
    body: `${b.customer_name} — ${tripLine(b)}`,
    url: `${siteUrl}/admin#/bookings/${b.id}`,
    tag: `booking-${b.id}`,
    renotify: reminder,
  });
}

export function staffEmail(item: OutboxItem, siteUrl: string, businessName: string) {
  const b = item.booking;
  const reminder = item.kind === 'pending_reminder';
  const subject = reminder
    ? `Reminder: booking ${b.reference} is still waiting for a decision`
    : `New booking ${b.reference} — ${b.customer_name}`;
  const link = `${siteUrl}/admin#/bookings/${b.id}`;
  const rows: [string, string][] = [
    ['Customer', b.customer_name],
    ['Phone', b.phone],
    ['Trip', tripLine(b)],
    ['Car', b.vehicle_name],
    ['Pickup', b.pickup],
    ...(b.dropoff ? [['Drop-off', b.dropoff] as [string, string]] : []),
  ];
  const text = `${subject}\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nOpen it: ${link}\n\n— ${businessName} booking system`;
  const html = `<p>${esc(subject)}</p><table cellpadding="4">${rows
    .map(([k, v]) => `<tr><td style="color:#666">${esc(k)}</td><td><strong>${esc(v)}</strong></td></tr>`)
    .join('')}</table><p><a href="${esc(link)}">Open the booking</a></p><p style="color:#888">— ${esc(businessName)} booking system</p>`;
  return { subject, text, html };
}

export function customerEmail(item: OutboxItem, siteUrl: string, businessName: string) {
  const b = item.booking;
  const track = `${siteUrl}/track#${b.tracking_token}`;
  const accepted = b.status === 'accepted';
  const subject = accepted
    ? `Your booking ${b.reference} is confirmed`
    : `About your booking ${b.reference}`;
  const lines = accepted
    ? [
        `Hello ${b.customer_name},`,
        `Good news — your booking is confirmed.`,
        tripLine(b),
        ...(b.agreed_fare != null ? [`Agreed fare: ${inr(b.agreed_fare)}`] : []),
        `We'll share your driver's details before the trip.`,
      ]
    : [
        `Hello ${b.customer_name},`,
        `Sorry, we can't take this booking.`,
        tripLine(b),
        ...(b.rejection_reason ? [`Reason: ${b.rejection_reason}`] : []),
        `Please get in touch if you'd like to try another date or car.`,
      ];
  const text = `${lines.join('\n\n')}\n\nYour booking page: ${track}\n\n— ${businessName}`;
  const html = `${lines.map((l) => `<p>${esc(l)}</p>`).join('')}<p><a href="${esc(track)}">View your booking</a></p><p>— ${esc(businessName)}</p>`;
  return { subject, text, html };
}

export function createNotifyHandler(deps: NotifyDeps) {
  const log = deps.log ?? console.error;
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
    if (!deps.secret || !safeEqual(req.headers.get('x-notify-secret') ?? '', deps.secret))
      return json(401, { error: 'unauthorized' });

    let id: number;
    try {
      id = Number((await req.json()).outbox_id);
      if (!Number.isInteger(id) || id <= 0) throw new Error();
    } catch {
      return json(400, { error: 'bad_request' });
    }

    const item = await deps.loadItem(id);
    if (!item) return json(404, { error: 'not_found' });
    if (item.sent_at) return json(200, { status: 'already_sent' });

    try {
      if (item.kind === 'booking_decided') {
        if (!item.booking.email) {
          await deps.markSent(id, 'no customer email');
          return json(200, { status: 'skipped' });
        }
        if (!deps.emailConfigured) {
          await deps.markSent(id, 'email not configured');
          return json(200, { status: 'skipped' });
        }
        const ok = await deps.sendEmail({ to: item.booking.email, ...customerEmail(item, deps.siteUrl, deps.businessName) });
        if (!ok) throw new Error('customer email failed');
        await deps.markSent(id);
        return json(200, { status: 'sent', email: 1 });
      }

      // Staff alerts: phone/desktop push to every device, email to owners.
      const payload = staffPushPayload(item, deps.siteUrl);
      const subs = await deps.pushSubscriptions();
      let pushed = 0;
      for (const sub of subs) {
        const r = await deps.sendPush(sub, payload);
        if (r === 'ok') pushed++;
        if (r === 'gone') await deps.deleteSubscription(sub.id);
      }

      let emailed = 0;
      if (deps.emailConfigured) {
        const msg = staffEmail(item, deps.siteUrl, deps.businessName);
        for (const r of (await deps.recipients()).filter((r) => r.role === 'owner' && r.email)) {
          if (await deps.sendEmail({ to: r.email!, ...msg })) emailed++;
        }
      }

      if (pushed === 0 && emailed === 0 && (subs.length > 0 || deps.emailConfigured)) {
        throw new Error('no alert could be delivered');
      }
      await deps.markSent(id, pushed + emailed === 0 ? 'no devices or email configured' : undefined);
      return json(200, { status: 'sent', push: pushed, email: emailed });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log('notify failed', id, msg);
      await deps.markFailed(id, msg);
      return json(502, { error: 'delivery_failed' });
    }
  };
}
