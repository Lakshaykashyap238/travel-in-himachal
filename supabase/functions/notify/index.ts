// notify — see handler.ts.
// Secrets: NOTIFY_SECRET (same value as the Vault secret "notify_secret"),
// VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:owner@…),
// SITE_URL, BUSINESS_NAME, and optionally RESEND_API_KEY + EMAIL_FROM.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';
import { createNotifyHandler, type OutboxItem } from './handler.ts';

const env = (n: string) => Deno.env.get(n) ?? '';

const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const vapidReady = Boolean(env('VAPID_PUBLIC_KEY') && env('VAPID_PRIVATE_KEY'));
if (vapidReady) {
  webpush.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:admin@example.com', env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));
}

const RESEND_KEY = env('RESEND_API_KEY');
const EMAIL_FROM = env('EMAIL_FROM');

Deno.serve(
  createNotifyHandler({
    secret: env('NOTIFY_SECRET'),
    siteUrl: env('SITE_URL').replace(/\/$/, ''),
    businessName: env('BUSINESS_NAME') || 'Travel In Himachal',
    emailConfigured: Boolean(RESEND_KEY && EMAIL_FROM),

    loadItem: async (id) => {
      const { data, error } = await db
        .from('notification_outbox')
        .select(
          'id, kind, sent_at, attempts, booking:bookings(id, reference, tracking_token, type, customer_name, phone, email, travel_date, travellers, pickup, dropoff, status, agreed_fare, rejection_reason, package:packages(name), vehicle:vehicles(name))',
        )
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      // deno-lint-ignore no-explicit-any
      const b = data.booking as any;
      return {
        id: data.id,
        kind: data.kind,
        sent_at: data.sent_at,
        attempts: data.attempts,
        booking: { ...b, package_name: b.package?.name ?? null, vehicle_name: b.vehicle?.name ?? '' },
      } as OutboxItem;
    },

    pushSubscriptions: async () => {
      if (!vapidReady) return [];
      // Only devices of staff who are still active.
      const { data, error } = await db
        .from('push_subscriptions')
        .select('id, endpoint, p256dh, auth, staff:staff!inner(is_active)')
        .eq('staff.is_active', true);
      if (error) throw new Error(error.message);
      return (data ?? []).map(({ id, endpoint, p256dh, auth }) => ({ id, endpoint, p256dh, auth }));
    },

    recipients: async () => {
      const { data, error } = await db.rpc('staff_alert_recipients');
      if (error) throw new Error(error.message);
      return data ?? [];
    },

    sendPush: async (sub, payload) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, {
          TTL: 60 * 60,
          urgency: 'high',
        });
        return 'ok';
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        return code === 404 || code === 410 ? 'gone' : 'error';
      }
    },

    deleteSubscription: async (id) => {
      await db.from('push_subscriptions').delete().eq('id', id);
    },

    sendEmail: async ({ to, subject, text, html }) => {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, text, html }),
        signal: AbortSignal.timeout(10_000),
      });
      return res.ok;
    },

    markSent: async (id, note) => {
      await db.from('notification_outbox').update({ sent_at: new Date().toISOString(), last_error: note ?? null }).eq('id', id);
    },

    markFailed: async (id, error) => {
      const { data } = await db.from('notification_outbox').select('attempts').eq('id', id).single();
      await db.from('notification_outbox').update({ attempts: (data?.attempts ?? 0) + 1, last_error: error.slice(0, 500) }).eq('id', id);
    },
  }),
);
