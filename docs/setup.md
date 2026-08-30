# Setup

A complete, one-time walkthrough for standing up the backend and deploying the app. Written for whoever is setting this up for the first time — every external step links to where it actually happens, since these dashboards change over time.

For what the app *does* once it's running, see [flow.md](flow.md). For why it's built this way, see [architecture.md](architecture.md).

---

## What you'll end up with

- A free [Supabase](https://supabase.com) project: Postgres database, Google sign-in, Realtime, file storage, and two small serverless functions.
- A free Google Cloud OAuth client, so "Sign in with Google" works.
- The static frontend deployed on GitHub Pages, exactly as before — still no build step.

Total cost at this app's scale (a handful of households): **$0/month**. See the root [README](../README.md#cost) for the one caveat worth knowing about.

## What you need before starting

- A Google account (for both the Supabase sign-up and the Google Cloud OAuth client — they don't have to be the same one, but it's simpler if they are).
- A terminal with `npx` available (comes with Node.js — if `npx --version` fails, install [Node.js](https://nodejs.org) first; it's only needed for these one-time setup commands, never for running the app itself).
- This repo, cloned locally.

---

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) and sign up or sign in.
2. Create a new project (an organization is created for you automatically the first time). Pick any name and a database password — you won't need the password again if you use the CLI login flow below, but save it somewhere anyway.
3. Wait for it to finish provisioning (a minute or two).
4. Once it's ready, go to **Project Settings > API** (in the dashboard's left sidebar, or `https://supabase.com/dashboard/project/_/settings/api`). You'll need three values from this page over the next few steps:
   - **Project URL** — looks like `https://abcdefghijk.supabase.co`
   - **`anon` `public` key** — safe to expose client-side
   - **`service_role` key** — secret, never put this in a file that gets committed

## 2. Put the public values into the app

Open [`js/config.js`](../js/config.js) and fill in:

```js
export const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR-SUPABASE-ANON-KEY';
export const VAPID_PUBLIC_KEY = 'YOUR-VAPID-PUBLIC-KEY';   // step 6 below
```

This file is meant to be committed — see the comment at its top for why the anon key is safe to expose (Row Level Security and the code-gated functions protect the data, not this key).

## 3. Set up Google sign-in

Two sides to this: a Google Cloud OAuth client, and telling Supabase about it.

### 3a. Google Cloud Console

1. Go to [console.cloud.google.com](https://console.cloud.google.com/home/dashboard) and create a project (or reuse one), if you don't already have one.
2. Go to **APIs & Services > OAuth consent screen** (`console.cloud.google.com/auth/overview`). Choose **External** as the user type, fill in the required fields (app name, support email), and save. You don't need to submit it for verification for this app's scale — a handful of named test users is fine, or leave it in "Testing" mode and add each household's Google account as a test user under **Audience**.
3. Go to **APIs & Services > Credentials > Create Credentials > OAuth client ID** (`console.cloud.google.com/auth/clients/create`).
   - Application type: **Web application**.
   - **Authorized JavaScript origins**: add where the app will be served from, e.g. `https://YOUR-GITHUB-USERNAME.github.io` and `http://localhost:8000` for local testing.
   - **Authorized redirect URIs**: this has to match Supabase's callback URL exactly — get it from the Supabase side first (next step), then come back and paste it in here.
4. Save. You'll get a **Client ID** and **Client Secret** — copy both.

### 3b. Supabase dashboard

1. In your Supabase project, go to **Authentication > Providers** and select **Google**.
2. Toggle it on. The page shows a **Callback URL (for OAuth)** — it looks like `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`. Copy this and paste it into the Google Cloud client's **Authorized redirect URIs** from step 3a (go back and add it there now, then save that Google Cloud page too).
3. Paste the **Client ID** and **Client Secret** from Google Cloud into this Supabase provider page. Save.
4. Go to **Authentication > URL Configuration** and set the **Site URL** to wherever the app is actually served (e.g. `https://YOUR-GITHUB-USERNAME.github.io/Medicine-Tracker/`), and add it under **Redirect URLs** too. Add `http://localhost:8000/*` as an additional redirect URL for local testing.

## 4. Install the Supabase CLI and apply the migration

No global install needed — run it via `npx` from the repo root:

```bash
npx supabase login
npx supabase link --project-ref YOUR-PROJECT-REF
npx supabase db push
```

- `login` opens a browser to authenticate the CLI with your Supabase account.
- `link` connects this repo to the project you created in step 1 (find `YOUR-PROJECT-REF` in the project's dashboard URL, or on the API settings page from step 1).
- `db push` applies [`supabase/migrations/0001_init.sql`](../supabase/migrations/0001_init.sql) — every table, RLS policy, the code-gated function surface, and the nightly freeze cron job.

Check it worked: in the Supabase dashboard's **Table Editor**, you should see `households`, `medicines`, `schedules`, `dose_log`, `day_snapshots`, `push_subscriptions`, and `slots`.

## 5. Generate VAPID keys (for reminders)

VAPID keys let the app send Web Push notifications without any third-party service. Generate a pair once:

```bash
npx web-push generate-vapid-keys
```

This prints a public and private key. Put the **public** one into `js/config.js` (step 2, above). Keep the **private** one for the next step — never commit it.

## 6. Deploy the Edge Functions and set their secrets

```bash
npx supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_CONTACT_EMAIL=you@example.com
npx supabase functions deploy send-reminders
npx supabase functions deploy supporter-photo
```

- `send-reminders` sends the actual push notifications, cron-triggered (next step).
- `supporter-photo` handles photo upload/delete/viewing for a supporter's device, which has no login session to use Supabase Storage directly.

Secrets set this way live only in Supabase's infrastructure — never in this repo.

## 7. Schedule the reminder cron

The migration already scheduled the nightly freeze job (`app.run_daily_freeze`), but the push-reminder cron needs your `service_role` key, which shouldn't live in a committed file. Add it from the Supabase dashboard's **SQL Editor** instead, filling in your project ref and the `service_role` key from step 1:

```sql
select cron.schedule('medtrack-push', '*/5 * * * *', $$
  select net.http_post(
    url     := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('Authorization', 'Bearer YOUR-SERVICE-ROLE-KEY',
                                  'Content-Type',  'application/json'),
    body    := '{}'::jsonb)
$$);
```

This runs every 5 minutes. See [`supabase/migrations/0001_init.sql`](../supabase/migrations/0001_init.sql) for why `net.http_post` (pg_net always creates its own `net` schema, regardless of what schema it's installed "into").

## 8. Run it locally

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000/`. No build step, no `npm install` for the frontend itself — only `js/config.js` needs real values (steps 2 and 5). Service workers and IndexedDB both work on `localhost` without HTTPS.

Try the full loop:
1. Choose **"I take the medicines"** → **Sign in with Google**. A household row should appear in the `households` table, with a 6-character `share_code`.
2. Open the app in a private/incognito window (so it doesn't share the session) → **"I help someone with their medicines"** → enter that code. It should load straight into the Medicines screen.
3. Add a medicine as the supporter. It should appear on the elder's Today screen within a few seconds — no manual refresh.
4. In the elder's Settings, turn on **Reminders** and allow the browser permission prompt.

## 9. Deploy

Push to `main`, then in the repo's GitHub settings go to **Settings > Pages** and set **Source** to **Deploy from a branch**, branch `main`, folder `/root`. (The repository needs to be public for this free option — see [GitHub's Pages docs](https://docs.github.com/en/pages) if you'd rather use a GitHub Actions-based deploy on a private repo instead.)

`js/config.js`'s values are safe to commit, so there's nothing to inject at deploy time — same "push and it's live" simplicity as before. Remember to add the GitHub Pages URL to both the Google Cloud OAuth client's authorized origins/redirect URIs (step 3a) and Supabase's Site URL / Redirect URLs (step 3b) once you know the real URL.

---

## Verification checklist

- [ ] Sign in with Google works and creates exactly one household per account.
- [ ] A wrong or expired code shows a plain error on the pairing screen, not a crash.
- [ ] A medicine added by the supporter reaches the elder's Today screen live.
- [ ] Marking a dose Done/Undo works with the browser's network set to offline, and syncs once back online (devtools > Network > Offline, tap Done, go back online, check the `dose_log` table).
- [ ] Reminders arrive for a due-and-unlogged slot (test by adding a schedule due a few minutes from now, or by manually calling `select * from app.claim_due_notifications();` in the SQL editor to confirm it finds the right rows).
- [ ] Rotating the share code (Settings, elder) invalidates the old code immediately.
- [ ] A direct query against `medicines`/`schedules`/`slots` using only the anon key (no session, no code) returns nothing — confirms the code-gated function surface is the only way in.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Google sign-in redirects to an error page | The redirect URI in Google Cloud doesn't exactly match Supabase's callback URL (step 3), or the Site URL/Redirect URLs in Supabase (step 3b) don't include the origin you're testing from |
| `db push` fails with a permission or connection error | Not logged in (`npx supabase login`) or not linked to the right project (`npx supabase link --project-ref ...`) |
| Push notifications never arrive | VAPID keys mismatched between `js/config.js` (public) and the function secrets (private) — regenerate and reset both together; also confirm the `medtrack-push` cron job exists (`select * from cron.job;` in the SQL editor) |
| A Supabase project stops responding after being idle | Free-tier projects pause after 7 days with zero activity — open the dashboard to un-pause it. The reminder cron running every 5 minutes should prevent this in practice; worth confirming rather than assuming |
| "That code is not valid" for a code you're sure is right | The code may have been rotated since it was shared, or was mistyped — codes exclude `0`, `O`, `1`, `I`, `L` on purpose to avoid exactly this confusion |
