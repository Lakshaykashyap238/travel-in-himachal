# Setup guide — accounts, secrets and first deploy

Everything runs on free plans. **Follow the zero-cost rules below at every step.**

## Zero-cost rules

1. **Never add a card, UPI mandate or any payment method** to GitHub, Cloudflare, Supabase, Resend, Sentry or Better Stack. With no payment method, none of them can charge.
2. **Never click "Upgrade" or start a trial** of Supabase Pro, Cloudflare Workers Paid / R2, GitHub Team, or any paid add-on.
3. **Don't use** Vercel, Firebase Blaze, Google Maps or Cloudflare R2. Each needs a card, or its free plan forbids commercial use.
4. Create every account **in the customer's name, with the owner's email**, so limit warnings reach the business.

## 1. Accounts (free)

| Service | Plan | Used for |
|---|---|---|
| GitHub | Free (private repo) | Code, CI/CD, nightly backups |
| Cloudflare | Free | Website hosting (Pages), DNS, Turnstile bot check, Web Analytics, email forwarding |
| Supabase | Free | Database, staff login, real-time updates, file storage, Edge Functions |
| Resend | Free | Customer emails (optional — bookings work without it) |

## 2. Supabase

1. Create an organisation and a project named `travel-in-himachal`, region **Mumbai (ap-south-1)**. Save the database password in a password manager.
2. **Authentication → Sign In / Providers → Email:** turn **off** "Allow new users to sign up". Only the owner adds staff.
3. **Authentication → Multi-Factor:** enable **TOTP (authenticator app)**.
4. **Authentication → URL Configuration:** Site URL = `https://<domain>`, redirect URL = `https://<domain>/admin`.
5. **Project Settings → API:** copy the Project URL and the anon (publishable) key.
6. **Connect → Session pooler:** copy the connection string (IPv4). This is `SUPABASE_DB_POOLER_URL`.
7. **Account → Access Tokens:** create a token for GitHub Actions (`SUPABASE_ACCESS_TOKEN`).
8. Edge Function secrets (Project Settings → Edge Functions → Secrets):
   - `TURNSTILE_SECRET_KEY` — from Cloudflare Turnstile (step 3)
   - `IP_HASH_SALT` — 32+ random characters (`openssl rand -hex 32`)
   - `ALLOWED_ORIGINS` — `https://<domain>,https://www.<domain>`
   - `GITHUB_REPO` — `owner/repo-name` of this project's GitHub repository
   - `GITHUB_DISPATCH_TOKEN` — a GitHub **fine-grained** token limited to this one repository with only **Actions: Read and write**. Used by the owner's "Publish changes" button to rebuild the site
   - `SITE_URL` — `https://<domain>` (links in emails and invites)
   - `BUSINESS_NAME` — `Travel In Himachal`
   - `NOTIFY_SECRET` — 32+ random characters (`openssl rand -hex 32`); the same value goes into Vault (step 9)
   - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` — phone alert keys: run `npx web-push generate-vapid-keys` once
   - `VAPID_SUBJECT` — `mailto:<owner email>`
   - `RESEND_API_KEY`, `EMAIL_FROM` — from Resend (step 2.10), e.g. `Travel In Himachal <bookings@<domain>>`. Leave out to skip emails; phone alerts still work
9. **Alerts wiring** (makes new-booking alerts and 30-minute reminders fire):
   - **Database → Extensions:** enable `pg_net` and `pg_cron`.
   - **SQL Editor**, run once (use your values):
     ```sql
     select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/notify', 'notify_url');
     select vault.create_secret('<same NOTIFY_SECRET as above>', 'notify_secret');
     ```
   - Re-run the latest migration (or push again) so the 5-minute job is scheduled: check **Integrations → Cron** shows `tih-notification-jobs`.
10. **Resend (free, no card):** add and verify the domain (DNS records in Cloudflare), create an API key. Then **Supabase → Authentication → Emails → SMTP Settings:** host `smtp.resend.com`, port `465`, user `resend`, password = the API key, sender = `EMAIL_FROM`. This replaces Supabase's built-in mailer, which only allows a few emails per hour — needed for staff invites and password resets.

## 3. Cloudflare

1. **Add the domain** to Cloudflare (free plan) and point the registrar's nameservers to Cloudflare.
2. **Workers & Pages → Create → Pages → Direct Upload**, project name `travel-in-himachal`. Add the custom domain.
3. **Turnstile → Add widget** for the domain (Managed mode). Copy the site key (public) and secret key (goes into Supabase, step 2.8).
4. **My Profile → API Tokens → Create token** using the "Cloudflare Pages: Edit" template → `CLOUDFLARE_API_TOKEN`. Copy the Account ID from the dashboard.
5. Redirect `travel-in-himachal.pages.dev` → the custom domain (Rules → Redirect Rules), so Google sees one address.

## 4. GitHub

Create a **private** repository and push this code. Then, in **Settings → Secrets and variables → Actions**, add these as **repository** secrets and variables. (Don't use Environments: on GitHub Free they don't work in private repositories.)

**Variables**

| Name | Value |
|---|---|
| `PUBLIC_SITE_URL` | `https://<domain>` |
| `PUBLIC_SUPABASE_URL` | Supabase Project URL |
| `PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `PUBLIC_TURNSTILE_SITE_KEY` | Turnstile site key |
| `PUBLIC_VAPID_PUBLIC_KEY` | the VAPID **public** key (same as the function secret) |
| `SUPABASE_PROJECT_REF` | the part before `.supabase.co` |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| `CLOUDFLARE_PAGES_PROJECT` | `travel-in-himachal` |

**Secrets**

| Name | Value |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | Supabase access token |
| `SUPABASE_DB_PASSWORD` | database password |
| `SUPABASE_DB_POOLER_URL` | Session pooler connection string (with password) |
| `CLOUDFLARE_API_TOKEN` | Pages: Edit token |
| `BACKUP_PASSPHRASE` | 32+ random characters. **Store a copy offline** — without it, backups can't be opened |

Pushing to `main` then tests and deploys everything automatically.

## 5. First owner account

1. Supabase → **Authentication → Users → Invite user** with the owner's email. The owner sets a password from the email link.
2. Supabase → **SQL Editor**, run once:
   ```sql
   insert into public.staff (user_id, full_name, role)
   select id, 'Owner Name', 'owner' from auth.users where email = 'owner@example.com';
   ```
3. The owner logs in at `/admin`, scans the QR code with an authenticator app (Google Authenticator, Microsoft Authenticator…) and enters the 6-digit code. From then on, the owner adds staff from **Staff** in the dashboard.
4. On each phone that should ring for bookings: open `/admin` → **Alerts** → **Turn on for this device**. On iPhone, first Share → Add to Home Screen and open from that icon.
5. Make a test booking on the website and check the phone alert, the owner email and the dashboard all fire. Accept it with a fare, then reject a second one, and confirm the customer emails arrive.

## 6. After the first deploy

- Run **Actions → Nightly backup & keep-alive → Run workflow** once and confirm an artifact appears.
- Do a restore drill (docs/RUNBOOK.md) before taking real bookings.
- Set up Better Stack uptime monitors for the home page and the booking function (free).
- Search setup: Google Search Console, Bing Webmaster Tools, Google Business Profile (see the plan).
