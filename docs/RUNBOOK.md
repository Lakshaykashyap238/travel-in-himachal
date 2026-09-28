# Runbook

## Deploy
Push or merge to `main`. GitHub Actions runs all tests, applies database migrations, deploys the booking function, then uploads the website. If any test fails, nothing is deployed.

## Roll back the website
Cloudflare → Workers & Pages → `travel-in-himachal` → Deployments → choose the previous deployment → **Rollback**. Takes seconds.
Database changes are never rolled back automatically: fix forward with a new migration.

## Add or remove a staff member
Owner, in `/admin` → Staff. (Until that screen ships in week 4: invite the user in Supabase → Authentication, then insert a row in `public.staff` with role `staff`.)
To remove access immediately: set `is_active = false`. Their login stops working for bookings at once.

## Restore a backup
Backups are encrypted `pg_dump` files kept 30 days as artifacts of the "Nightly backup & keep-alive" workflow.

1. Download the artifact and decrypt it:
   `gpg --batch --passphrase "<BACKUP_PASSPHRASE>" -d -o tih.dump tih-<date>.dump.gpg`
2. Restore into a **new** Supabase project (never over the live one until it's verified):
   - apply this repo's migrations to the new project: `supabase link --project-ref <new>` then `supabase db push`
   - restore the data:
     `pg_restore --data-only --no-owner --disable-triggers -d "<new session pooler URL>" --schema=public tih.dump`
     `pg_restore --data-only --no-owner --disable-triggers -d "<new session pooler URL>" --schema=auth --table=users --table=identities tih.dump`
3. Check the booking count matches, then point the website at the new project (update the GitHub variables and redeploy).

Restore drill: do this once before launch and every 3 months. The drill was run during development; it restored all bookings, events and staff with matching checksums.

## Limit warnings
| Warning | What to do |
|---|---|
| Supabase: approaching a free-plan quota | Check Reports → usage. Usually photos: compress or remove old uploads. Upgrading is optional, not required. |
| Supabase: project paused | Dashboard → Restore project. Data is kept. Check the nightly workflow is running. |
| Resend: daily limit | Bookings are unaffected; decision emails resume the next day. |
| GitHub Actions minutes | Deploys pause until the next month; the live site is unaffected. |

## Secrets rotation
Rotate if anyone with access leaves: Supabase DB password and access token, Cloudflare API token, Turnstile secret, IP hash salt. Update the GitHub environment secrets and Supabase function secrets, then redeploy.
