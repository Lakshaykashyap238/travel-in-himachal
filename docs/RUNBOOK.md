# Runbook

## Deploy
Push or merge to `main`. GitHub Actions runs all tests, applies database migrations, deploys the booking function, then uploads the website. If any test fails, nothing is deployed.

## Roll back the website
Cloudflare → Workers & Pages → `travel-in-himachal` → Deployments → choose the previous deployment → **Rollback**. Takes seconds.
Database changes are never rolled back automatically: fix forward with a new migration.

## Add or remove a staff member
Owner, in `/admin` → **Staff** → Add a person. They get an email to set a password, then set up an authenticator app on first sign-in.
To remove access immediately: **Remove access**. Their login stops working at once. The last owner can't be removed or demoted.

## Someone lost their phone (authenticator)
1. Owner (or you) in Supabase → **Authentication → Users** → the person → remove their MFA factor.
2. They sign in with their password and scan a new QR code.
3. If the lost phone had alerts on, it stops getting them once removed: Supabase → Table editor → `push_subscriptions` → delete that person's rows.
If the **only** owner loses their phone, step 1 is done by whoever has the Supabase account (the owner's email).

## Alerts not arriving
- Dashboard open? New bookings still show and chime there.
- Supabase → Table editor → `notification_outbox`: rows with `sent_at` empty and `last_error` filled show why. Failed rows retry every 5 minutes, up to 5 times.
- `last_error` mentions Vault / notify_url → redo SETUP step 2.9.
- Phone alerts only: in `/admin` → Alerts, turn off and on again on that device.

## Website content
Owners edit tours, cars, places, prices, photos and business details in `/admin`, then press **Publish changes**. The site rebuilds in about 3 minutes. If it doesn't update: GitHub → Actions → "Publish content" shows the error; the live site keeps the previous version.

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
Rotate if anyone with access leaves: Supabase DB password and access token, Cloudflare API token, Turnstile secret, IP hash salt, GitHub dispatch token, NOTIFY_SECRET (update Vault `notify_secret` too), Resend API key. Update the GitHub repository secrets and Supabase function secrets, then redeploy.

## Renew the Supabase access token (yearly)
The GitHub token `SUPABASE_ACCESS_TOKEN` expires one year after it was created (first one: early October 2027). When it expires, deploys and the owner's **Publish changes** fail; the live website and bookings keep working.
1. Supabase → avatar → Account → Access Tokens → Generate new token: name `github-tih`, Custom expiry, one year ahead, Resource access = Project → travel-in-himachal, Permissions = Full access, then set Account and organization to None except Organizations and Projects (account-wide) = Read, and Infrastructure and delivery to None (Development/Production Branches may stay Read).
2. GitHub → Settings → Secrets and variables → Actions → `SUPABASE_ACCESS_TOKEN` → Update → paste.
3. Delete the old token in Supabase.
Set a calendar reminder about a week before each expiry.
