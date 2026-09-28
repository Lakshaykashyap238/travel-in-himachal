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

## 3. Cloudflare

1. **Add the domain** to Cloudflare (free plan) and point the registrar's nameservers to Cloudflare.
2. **Workers & Pages → Create → Pages → Direct Upload**, project name `travel-in-himachal`. Add the custom domain.
3. **Turnstile → Add widget** for the domain (Managed mode). Copy the site key (public) and secret key (goes into Supabase, step 2.8).
4. **My Profile → API Tokens → Create token** using the "Cloudflare Pages: Edit" template → `CLOUDFLARE_API_TOKEN`. Copy the Account ID from the dashboard.
5. Redirect `travel-in-himachal.pages.dev` → the custom domain (Rules → Redirect Rules), so Google sees one address.

## 4. GitHub

Create a **private** repository and push this code. Then, in **Settings → Environments**, create an environment called `production` with:

**Variables**

| Name | Value |
|---|---|
| `PUBLIC_SITE_URL` | `https://<domain>` |
| `PUBLIC_SUPABASE_URL` | Supabase Project URL |
| `PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `PUBLIC_TURNSTILE_SITE_KEY` | Turnstile site key |
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
3. The owner logs in at `/admin` and enrols the authenticator app. From then on, the owner adds staff from the admin dashboard.

## 6. After the first deploy

- Run **Actions → Nightly backup & keep-alive → Run workflow** once and confirm an artifact appears.
- Do a restore drill (docs/RUNBOOK.md) before taking real bookings.
- Set up Better Stack uptime monitors for the home page and the booking function (free).
- Search setup: Google Search Console, Bing Webmaster Tools, Google Business Profile (see the plan).
