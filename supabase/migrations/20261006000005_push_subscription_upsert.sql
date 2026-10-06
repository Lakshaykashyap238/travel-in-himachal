-- Turning alerts on uses an upsert (insert … on conflict update), which
-- needs UPDATE as well as INSERT. The row-level policy already limits
-- each user to their own subscriptions.
grant update on public.push_subscriptions to authenticated;
