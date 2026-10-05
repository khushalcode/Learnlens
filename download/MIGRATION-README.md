# LearnLens v4 — Supabase Migration Foundation + Landing Page Style

## What's in this build

This is the **foundation** for migrating LearnLens from Prisma+SQLite to **real Supabase** (auth + database + storage), plus the visual upgrade to the landing page's design language (Plus Jakarta Sans + Inter + JetBrains Mono, brand/accent/ink palette, hero-grid/aurora/sweep animations).

### What's done in this round

1. **Env vars** — `.env` updated with your Supabase URL + publishable key + stable NextAuth secret
2. **Supabase packages** — `@supabase/supabase-js` + `@supabase/ssr` installed
3. **Supabase client files** — `src/lib/supabase/browser.ts` (client) + `src/lib/supabase/server.ts` (server + admin)
4. **SQL schema file** — `scripts/sql/supabase-schema.sql` (run in Supabase SQL editor)
5. **SQL seed file** — `scripts/sql/supabase-seed.sql` (run after schema — creates 35 demo users, course, 5 assignments, 150 submissions, **ZERO peer reviews** per "fresh site today" request)
6. **Visual upgrade** — `src/app/layout.tsx` now loads Plus Jakarta Sans + Inter + JetBrains Mono; `src/app/globals.css` adopts the brand/accent/ink palette + hero-grid + aurora + sweep + shimmer animations

### What's pending (next round, after you run the SQL)

- Migrate all `src/lib/queries.ts` functions from Prisma → Supabase client
- Migrate all API routes from Prisma → Supabase client
- Replace NextAuth credentials auth with Supabase auth (signInWithPassword)
- Update login-form to match the landing page aesthetic (gradient buttons, glassmorphism card)
- Update app-shell to read session from Supabase instead of NextAuth
- Test all 5 role dashboards end-to-end against Supabase data

## How to run the SQL

### Step 1 — Run the schema file

1. Open your Supabase dashboard: https://supabase.com/dashboard/project/nzxqeeesemlvoqhcuppr
2. Click **SQL Editor** in the left sidebar
3. Click **+ New query**
4. Open `scripts/sql/supabase-schema.sql` from this zip, copy everything, paste into the editor
5. Click **Run** (or Ctrl+Enter)
6. You should see "Success. No rows returned." — that means tables + RLS + storage bucket are all set up

### Step 2 — Run the seed file

1. In the same SQL editor, click **+ New query** again
2. Open `scripts/sql/supabase-seed.sql`, copy, paste, **Run**
3. You should see "Success. No rows returned." — that means 35 demo users + course + assignments + 150 submissions are inserted

### Step 3 — Test a demo login

Once the SQL runs successfully, you should be able to sign in at Supabase with:

| Role | Email | Password |
|---|---|---|
| Admin | `admin@learnlens.edu` | `demo1234` |
| Faculty | `faculty@learnlens.edu` | `demo1234` |
| Coordinator | `coordinator@learnlens.edu` | `demo1234` |
| Mentor | `mentor@learnlens.edu` | `demo1234` |
| Student | `student01@learnlens.edu` | `demo1234` |

(The seed inserts directly into `auth.users` with `email_confirmed_at = now()`, so no email confirmation is required — the demo logins work immediately.)

## After you've run the SQL

Tell me "SQL done" and I'll execute the next round:
1. Migrate queries.ts → Supabase
2. Migrate API routes → Supabase
3. Switch auth from NextAuth → Supabase auth
4. Adopt the landing page's login form + hero design
5. Test + verify
6. Send you the final updated zip

## Files changed in this round

```
.env                                                     # added Supabase env vars
package.json                                             # added @supabase/* deps
src/app/layout.tsx                                       # Plus Jakarta Sans + Inter + JetBrains Mono
src/app/globals.css                                      # brand/accent/ink palette + animations
src/lib/supabase/browser.ts                              # NEW — browser Supabase client
src/lib/supabase/server.ts                               # NEW — server + admin Supabase client
scripts/sql/supabase-schema.sql                          # NEW — tables + RLS + storage bucket
scripts/sql/supabase-seed.sql                            # NEW — 35 demo users + course + 5 assignments + 150 submissions + 0 peer reviews
```

## Demo logins reminder

All 35 demo accounts have password `demo1234`. The 5 main ones to try:
- `admin@learnlens.edu`
- `faculty@learnlens.edu`
- `coordinator@learnlens.edu`
- `mentor@learnlens.edu`
- `student01@learnlens.edu`
