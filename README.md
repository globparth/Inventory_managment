# Sample Desk

QR-based sample tracking for a trade fair. Every product gets a QR label. When your team scans it they log who received the sample, and the stock count goes down. Anyone else who scans it sees only the product info.

- **Team scan** (signed in): product, samples left, form for name / phone / email / company. Sample numbers are handed out one by one (001, 002, …) and can never be duplicated.
- **Public scan** (not signed in): product name, category and description only. No counts, no names.
- **Blank labels**: create thousands of QR codes now, link products to them later.
- **Works when the Wi-Fi drops**: entries are saved on the phone and sent when the connection returns. Retrying can never create a double entry.
- **Admin area**: dashboard, product list, CSV import, QR label PDF generator, sample log with CSV export.

Stack: React (Vite) + Supabase (Postgres + login). It is a static site, so it can be hosted free on Vercel, Cloudflare Pages or Netlify.

---

## Which database?

Use **Supabase** (managed Postgres). Your data is small: 2,300 products plus a few thousand sample entries is a few MB. Even 100,000 entries would stay far below the free 500 MB limit. Size is not the problem; **availability** is.

| Option | Fits this project? | Notes |
|---|---|---|
| **Supabase** (recommended) | Yes | Postgres, login, and the safety rules are all built in. Free plan: 500 MB, 2 projects. |
| Neon (Postgres) | Possible | Needs a separate login system and API code. It also sleeps when idle and takes a moment to wake. |
| Firebase Firestore | Possible | Would need a rewrite. Stock counting works with transactions but more code is needed. |
| Google Sheets / Airtable | No | Two people scanning at once can hand out the same sample number. |

**Free-plan catch:** as of mid-2026, free Supabase projects pause after 7 days without activity, and pause means the app is down until someone restores it. Check current limits at supabase.com/pricing. For the event, either upgrade that one project to Pro (about $25 for the month, and you can downgrade afterwards) or make sure the app is used at least once a week beforehand. The Pro plan also includes daily backups.

**How much space will you actually use?** For 2,300 products and 2,500 people:

| Scenario | Approximate size |
|---|---|
| Products (2,300 QR codes + descriptions) | under 1 MB |
| 2,500 people, 5 samples each (typical for a fair) | about 5 MB |
| 2,500 people, 20 samples each (extreme case) | about 19 MB |
| 100,000 sample entries, never cleaned up, across many future events | about 38 MB |

Even the extreme case is a small fraction of the free 500 MB limit. Space will not be the reason to upgrade — availability (the pause-after-7-days rule) is the only real reason. That said, the backup tools below exist regardless, because "what if this database has a problem" deserves an answer no matter how unlikely.

---

## 1. Set up Supabase

1. Create a project at supabase.com. Choose the region closest to where the event is.
2. Copy `.env.example` to `.env`.
3. Fill in `SUPABASE_DB_URL` — Supabase dashboard → **Project Settings → Database → Connection string → URI** (use "Direct connection", and put your real database password in place of `[YOUR-PASSWORD]`).
4. Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` — **Project Settings → API**.
5. Optional but recommended: fill in `SUPABASE_SERVICE_ROLE_KEY` (also under Project Settings → API — the **secret** `service_role` key, not the anon one), plus `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME`. With these filled in, the next step also creates your first admin login automatically.
6. Run:
   ```bash
   npm install
   npm run setup
   ```
   This connects straight to your database and creates every table, security rule and function — the whole of `supabase/schema.sql` — with no dashboard clicking. If you filled in the service role key and admin details, it creates that login and makes it an admin too. It's safe to run more than once (for example after pulling an update to this project).
7. The one thing Supabase doesn't expose an API for, so it has to be clicked by hand: **Authentication → Sign In / Providers → turn off "Allow new users to sign up"**. `npm run setup` reminds you of this at the end. Without it, anyone could create their own account.

If you'd rather not fill in the service role key, leave the admin section of `.env` blank — `npm run setup` still creates all the tables, and prints the two manual steps for adding your own login (Authentication → Users → Add user, then one line of SQL to make it an admin) instead.

To add more team members later, or to remove someone's access, use the Supabase dashboard directly (Authentication → Users; and `update public.profiles set role = 'disabled' where email = '…';` to revoke without deleting their account). Or list several people in `TEAM_MEMBERS` in `.env` (`email:password:Name`, comma-separated) and run `npm run setup` again — it creates any that don't already exist and leaves the rest untouched.

There's no limit on how many people can sign in — every team member gets their own login and their own name attached to every sample they log (visible in Admin → Sample log and the Dashboard's "By team member" list). Only accounts promoted with `role = 'admin'` can see the admin area; everyone else can scan and log samples but not touch products, imports or backups.

## 2. Run it on your computer (optional)

```bash
npm run dev
```
(`.env` is already set up from step 1 above.)

## 3. Put it online

Push this folder to a GitHub repository, then import it into one of these. In every case add the two environment variables and deploy.

| Host | Build command | Output folder | Notes |
|---|---|---|---|
| **Cloudflare Pages** | `npm run build` | `dist` | Free plan allows commercial use. Recommended for a company tool. |
| **Netlify** | `npm run build` | `dist` | `public/_redirects` is already included. |
| **Vercel** | detected automatically | `dist` | `vercel.json` is included. Vercel's free Hobby plan is meant for non-commercial use, so check their terms before using it for company work. |

Environment variables:

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-or-publishable-key
VITE_ORG_NAME=Globriddge International          (shown on the public page)
VITE_PUBLIC_CONTACT=samples@yourcompany.com     (optional, shown on the public page)
VITE_PUBLIC_BASE_URL=https://samples.yourcompany.com   (optional, the address printed in the QR codes)
```

> **Decide the web address before printing.** The QR codes contain the address of your site. If you print labels with `myproject.vercel.app` and later move to a different address, every label is wrong. Best: use your own domain or subdomain (for example `samples.yourcompany.com`), open the admin page from that address, and only then print.

## 4. The workflow

**Now, before you have product details**

1. Sign in as admin, open **Admin > QR labels**.
2. Create about 2,300 codes (2,000 products plus spares). Each code is random and holds no product information.
3. Download the label PDF (default: 40 labels per A4 page, about 21 mm QR) and print it at 100% scale on sticker sheets. The code is printed under each QR so a damaged label can be typed in by hand.

**When product information arrives, use either method (or mix them)**

- **CSV import** (Admin > Import): columns `name`, `total_samples`, `category`, `description`, and optionally `code`. Rows without a code fill the next blank code; download the resulting product and code list to know which label goes on which product.
- **Claim on the spot**: a team member sticks a blank label on a product, scans it, and the app asks for name, category and sample count. Done in 20 seconds and the label is live.

Names, counts and descriptions can be edited at any time (Admin > Products). Nothing needs reprinting.

**At the event**

- Everyone signs in once on their own phone. Tap Share, then **Add to Home Screen** so it opens like an app.
- Scan with the in-app scanner or the normal camera. Fill the form, press **Give sample**. The screen shows the sample number and how many are left.
- Typing a phone number that was used before fills in the name, email and company.
- Wrong entry? Admin > Sample log > Cancel. The sample returns to stock and its number is not reused.
- After the event: **Sample log > Download unique contacts** gives one row per person with everything they received.

## 5. Event-day reliability checklist

- [ ] Web address is final, and labels were printed from that address.
- [ ] Supabase project is on Pro for the event month (or was used in the last week).
- [ ] Every team member has signed in on their phone **once with internet** and opened the app on the home screen.
- [ ] Dry run: 5 phones, one product, scan at the same moment. Numbers must all be different. Then switch a phone to airplane mode, log a sample, switch back, and confirm it arrives.
- [ ] Mobile data on every phone as a backup for the hall Wi-Fi.
- [ ] Do not deploy new versions during the event (the app updates itself on the next open).
- [ ] Download the sample log CSV at the end of each day as a backup.
- [ ] Keep a paper fallback sheet in case every phone is dead.

**What happens with no signal:** the phone shows the product from a list it saved earlier, accepts the entry and keeps it on the phone. It sends automatically when the connection is back (also when the app is opened again). The sample number is assigned by the server at that moment, so the phone shows "waiting to sync" instead of a number. One limit: a phone that is offline cannot know the live "left" count, so it does not show it.

## 6. How it protects the data

- Nobody can read the tables directly except admins. Everything the app does goes through database functions that check who is calling.
- Handing out a sample locks that product's row for a moment, so two people can never receive the same number or take the last sample together.
- Every submission carries its own ID. If the phone retries after a bad connection, the server recognises it and does not record it twice.
- Public scans use a function that returns product name, category and description only.

## 7. Backups, and what to do if something goes wrong

Three tools, for three different situations:

**Admin → Backup → "Download backup (.zip)"**
One click, works from a phone or laptop, no terminal needed. Downloads every product and every sample entry as CSV files, zipped together. Good for a daily safety copy during the event and for your own records afterwards. It is a *readable* copy, not a database restore file — you can't load it back into the app by itself.

**`scripts/backup.sh`** — the real, restorable backup
Run from a computer with internet and `pg_dump` installed (comes with PostgreSQL; on Mac: `brew install postgresql`, on Windows: install PostgreSQL from postgresql.org, on Ubuntu: `sudo apt install postgresql-client`):
```bash
export SUPABASE_DB_URL="postgresql://postgres:YOUR-PASSWORD@db.xxxx.supabase.co:5432/postgres"
./scripts/backup.sh
```
Find that connection string in Supabase: **Project Settings → Database → Connection string → URI** (use "Direct connection"; if your network blocks it, use "Connection pooling" and change the port in the string from 6543 to 5432, or vice versa if direct doesn't work). This makes a compressed `.dump` file in `backups/`. Run it weekly during the event, and copy the file somewhere other than the one laptop running it — email it to yourself, or drop it in Google Drive.

**`scripts/restore.sh`** — moving to a new Supabase project
Use this if your project is deleted, locked, or you're moving off a free project that hit a limit:
```bash
# 1. Create a new Supabase project.
# 2. Run supabase/schema.sql on it (SQL Editor). Do NOT add team logins yet.
export SUPABASE_DB_URL="postgresql://postgres:NEW-PASSWORD@db.yyyy.supabase.co:5432/postgres"
./scripts/restore.sh backups/sampledesk_full_<timestamp>.dump
# 3. NOW add team logins in Authentication > Users, then set their roles:
#      update public.profiles set role = 'admin' where email = '...';
# 4. Point your hosting provider's environment variables at the new project and redeploy.
```
I tested this exact round trip (dump → fresh empty project → restore) locally: every product, QR code and sample entry came back correctly. One thing that doesn't transfer: team logins themselves, since Supabase manages those separately and issues new IDs — you re-add your team after restoring, not before. Each sample entry still shows who gave it out, because that name is stored as text on the entry itself, not just as a link to the login.

**Admin → Backup → "Start a new event"** — reusing printed labels
Your 2,300 printed QR labels don't have to be one-time-use. Once a fair is over, this clears the sample log and sets every product back to zero given, but keeps every product name, description and QR code exactly as-is — so the same labels work at your next fair with no reprinting, and the database never grows beyond what one event adds. It asks you to type `RESET` to confirm and cannot be undone from inside the app, so download a backup first.

## 8. Project layout

```
supabase/schema.sql        tables, security rules, all database functions (run once)
src/pages/Scan.jsx         the scan page (public view + team form)
src/pages/Home.jsx         team home: camera scanner, typed code, unsent samples
src/pages/admin/*          dashboard, products, import, QR labels, sample log, backup
src/offline.js             offline queue, retry, product cache
src/lib/labels.js          QR label PDF generator
scripts/setup.mjs          one-command setup: creates tables + first admin login
scripts/backup.sh          full database backup (pg_dump) — run from a terminal
scripts/restore.sh         restores a backup into a new Supabase project
scripts/make-icons.py      regenerates the app icons (optional)
```
