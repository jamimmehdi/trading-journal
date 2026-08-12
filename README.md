# TradePnL Tracker

Mobile-first trade P&L journal. Static site (no build step) + [Supabase](https://supabase.com) as a free backendless database/API. Deploys to GitHub Pages.

## 1. Create a free Supabase project

1. Go to [supabase.com](https://supabase.com) → New project (free tier: 500MB DB, unlimited API requests, plenty for personal use).
2. Once created, open **SQL Editor** → New query → paste the contents of [`schema.sql`](schema.sql) → Run. This creates the `trades` table and Row Level Security policies so you can only ever read/write your own rows.
3. Go to **Authentication → Providers → Email** and turn **off** "Confirm email" (Settings → Auth → toggle "Enable email confirmations" off) so you can sign in immediately without clicking a confirmation link. Optional but convenient for a single-user app.
4. Go to **Project Settings → API**. Copy the **Project URL** and the **anon public** key.

## 2. Configure the app

`js/config.js` is gitignored — it's generated, not committed, so your keys never sit in the repo history.

For local testing, copy the template and fill in your values:

```bash
cp js/config.template.js js/config.js
```

Then edit `js/config.js` with your Project URL and anon key.

The anon key is meant to be public — it's baked into every Supabase JS frontend. Your data stays private because of the Row Level Security policies in `schema.sql` (a row is only visible to the `user_id` that owns it). Keeping it out of git is still good hygiene — it means you can rotate the key or make the repo public later without a history scrub.

## 3. Run it locally (optional)

Any static file server works, e.g.:

```bash
npx serve .
```

Then open the printed URL, sign up with an email/password (this is just your own account in your own Supabase project — nothing is emailed anywhere unless you turn confirmation back on).

## 4. Deploy to GitHub Pages

```bash
git init
git add .
git commit -m "Initial commit"
gh repo create trading-journal --public --source=. --push
```

Then set up the two repo secrets the deploy workflow needs:

1. On GitHub: **Settings → Secrets and variables → Actions → New repository secret**.
2. Add `SUPABASE_URL` with your Project URL.
3. Add `SUPABASE_ANON_KEY` with your anon public key.
4. Go to **Settings → Pages → Source: GitHub Actions** (not "Deploy from branch").
5. Push to `main` (or re-run the workflow from the **Actions** tab). [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) generates `js/config.js` from those secrets at deploy time and publishes the site.

Your app will be live at `https://<your-username>.github.io/trading-journal/`.

## 5. Install it like an app

On your phone, open the GitHub Pages URL in Chrome/Safari → **Add to Home Screen**. It launches full-screen like a native app (via `manifest.json`).

## Notes

- Everything (auth, storage, API) runs on Supabase's free tier — no server of your own to host or pay for.
- All amounts are unitless — just be consistent with one currency.
- P&L formula: Long = `(exit - entry) * qty - fees`, Short = `(entry - exit) * qty - fees`.
