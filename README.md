# Travel In Himachal

Tour and cab booking website with a real-time admin inbox. Customers book online; the owner accepts or rejects each booking; the customer follows the status on a private tracking link.

Runs entirely on free plans with no payment method on any account — see [docs/SETUP.md](docs/SETUP.md).

| Layer | Technology |
|---|---|
| Website | Astro + React + TypeScript + Tailwind CSS, static, on Cloudflare Pages |
| Database | Supabase Postgres (Mumbai) with row-level security |
| Booking API | Supabase Edge Function `create-booking` (Deno) |
| Staff login | Supabase Auth, email + password + authenticator app |
| Real-time | Supabase Realtime |
| Bot protection | Cloudflare Turnstile + database rate limits |
| CI/CD & backups | GitHub Actions |

## Project layout
```
src/                         website (Astro pages, React components)
supabase/migrations/         database schema, security rules, catalogue data
supabase/functions/
  _shared/booking-schema.ts  booking rules shared by the form and the server
  create-booking/            the booking API + its tests
tests/db/                    database security & workflow tests
.github/workflows/           ci, deploy, nightly backup
docs/                        setup, runbook, owner inputs
```

## Local development
Requires Node.js 22+. On Windows, use WSL2 (Ubuntu).
```bash
npm install
cp .env.example .env
npm run dev                  # http://localhost:4321
```

## Tests
```bash
# database: any PostgreSQL 15+ you can create databases on
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run test:db

# booking API (needs Deno 2)
cd supabase/functions/create-booking && deno test

# website
npx astro check && npm run build
```

## How a booking flows
1. The form validates input with the shared schema and gets a Turnstile token.
2. `create-booking` re-validates, verifies Turnstile, hashes the visitor IP, and calls `public.create_booking()` with the service role.
3. `create_booking()` validates again, applies rate limits (3 per phone per day, 10 per IP per hour), saves the booking and an audit event, and returns a reference (`TIH-10001`) and a secret tracking token.
4. Staff see it instantly through Realtime and change it only via `set_booking_status()`:
   `pending → accepted | rejected`, `accepted → completed | cancelled`. Every change is written to the append-only `booking_events` table.
5. The customer's tracking page calls `get_booking_by_token()`, which returns only customer-safe fields.
