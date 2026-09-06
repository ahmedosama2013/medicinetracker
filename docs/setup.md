# Setup

A complete, one-time walkthrough for standing up the backend and deploying the app. Written for whoever is setting this up for the first time — every external step links to where it actually happens, since these dashboards change over time.

For what the app *does* once it's running, see [flow.md](flow.md). For why it's built this way, see [architecture.md](architecture.md).

---

## Joining a project someone else already set up

If the backend exists and you are just picking up the code, you need **none**
of this walkthrough:

```bash
git pull
python3 -m http.server 8848      # or 8000; both are in the allow lists
```

`js/config.js` is committed, so the checkout already points at the right
Supabase project. Sign in with Google and you get your own household in it —
your own medicines, your own share code, alongside everyone else's. Migrations,
Edge Functions and VAPID keys are all properties of the project, already done.

Two things only the project's owner can do for you, and both fail in ways that
do not say what is wrong:

- **Your Google account must be allowed to sign in.** If the OAuth consent
  screen is in *Testing* mode — which it usually is at this scale — sign-in
  works only for accounts added under **Google Cloud → APIs & Services → OAuth
  consent screen → Audience → Test users**. Otherwise Google refuses with a
  generic "access blocked".
- **You need Supabase access only if you are changing the backend.** Running
  migrations or deploying functions needs `npx supabase login` and
  `link --project-ref …`, which needs an invite to the Supabase organisation.
  Editing the frontend needs neither.

Do **not** point `js/config.js` at a different project and leave it
uncommitted — see [Which Supabase project is this checkout pointing
at?](#which-supabase-project-is-this-checkout-pointing-at) for why that
presents as data disappearing rather than as a configuration mistake.

## Already have your own project? Start here

Only if you maintain your own Supabase project for this app. If you are joining
someone else's, see the section above instead.

If your project predates v3, run this from the repo root. **In this
order** — the functions read tables the migrations create.

```bash
git pull
npx supabase link --project-ref YOUR-PROJECT-REF   # skip if already linked
npx supabase db push
npx supabase functions deploy send-reminders
npx supabase functions deploy supporter-photo --no-verify-jwt
npx supabase functions deploy nudge --no-verify-jwt
```

### Which Supabase project is this checkout pointing at?

Check before anything else, because getting this wrong wastes an afternoon:

```bash
grep SUPABASE_URL js/config.js
git diff js/config.js          # empty output = you are on the committed one
```

`js/config.js` is **committed on purpose** — it holds only the project URL, the
publishable key and the VAPID public key, none of which are secrets (Row Level
Security and the code-gated functions protect the data; verified by the last
two items in the [checklist](#verification-checklist)). So whatever is committed
is what GitHub Pages serves.

That means an **uncommitted local edit is a trap**. `git pull` will not touch it,
so your laptop talks to one database and the deployed site talks to another.
The symptom is not an error — it is signing in on a second device and finding
no medicines, because you have landed in a different database with an empty
household of the same name.

Decide which you want and make it explicit:

- **Everyone shares one backend.** Commit `js/config.js` so laptop and
  deployment agree. Whoever owns that project runs the catch-up above.
- **You want your own backend for testing.** Fine, but keep it out of the repo
  rather than as a dirty file — and know that the deployed site is *not*
  testing your changes. Nothing you verify locally has been exercised against
  the deployed backend until someone points them at the same place.

If you change which project is committed, the new project's Supabase **Site URL
/ Redirect URLs** (step 3b) and the Google Cloud OAuth client's **authorized
origins** (step 3a) both have to include the GitHub Pages URL, or sign-in breaks
there while continuing to work on `localhost`.

### Then check three things push depends on

None of these are done by the commands above, and **all three fail silently**.
Until v3 nobody's reminders actually worked, so do not assume yours were fine
before.

**1. Your VAPID public key is valid and matches.** `js/config.js` must be
byte-identical to the `VAPID_PUBLIC_KEY` secret, and the key must be 65 bytes
decoded — a malformed one crashes the function on boot with no useful message.

```bash
node -e "const k=process.argv[1];const b=Buffer.from(k,'base64url');console.log(k.length+' chars ->',b.length,'bytes',b.length===65&&b[0]===4?'OK':'INVALID')" "$(grep -oP "VAPID_PUBLIC_KEY = '\K[^']+" js/config.js)"
npx supabase secrets list   # VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_CONTACT_EMAIL must all exist
```

If you have to regenerate them (step 5), **everyone with reminders on has to
toggle them off and back on** — a subscription is bound to the key that created
it. Do that anyway once, on the patient's phone, since any subscription older
than your current key is dead.

**2. The reminder cron exists.** `db push` schedules the nightly freeze but not
this one, because it needs your `service_role` key. Check with
`select * from cron.job;` in the SQL Editor — you want a `medtrack-push` row.
If it is missing, do step 7.

**3. The wrappers landed.** `select * from public.claim_due_notifications();`
in the SQL Editor. "function does not exist" means `0009` did not apply, and
the reminder cron cannot work no matter what else is right.

Then work down the [verification checklist](#verification-checklist). If push
still does not arrive, ["Why push looked broken"](#why-push-looked-broken-and-how-to-tell-what-is-wrong)
lists the four causes and how to tell them apart.

What `db push` applies:

| Migration | What it does |
|---|---|
| `0005_skipped_doses` | Widens `dose_log.status` to allow `skipped`, adds the UPDATE policy `0001` omitted |
| `0006_supporter_parity` | `logged_by`, plus four code-gated functions so a supporter can read history and mark doses |
| `0007_nudge` | `last_nudge_at`, the nudge rate limit |
| `0008_nudge_grants` | `service_role` grants the nudge function needs |
| `0009_reminder_rpc_wrappers` | `public` wrappers so `send-reminders` can reach its `app.*` functions at all |
| `0010_slot_time_in_snapshots` | Stops one medicine's own time relabelling its whole slot on frozen days |

Migrations are additive and safe to re-run; `db push` skips ones already
applied.

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
  - `anon` ****`public` **key** — safe to expose client-side
  - `service_role` **key** — secret, never put this in a file that gets committed



## 2. Put the public values into the app

Open `[js/config.js](../js/config.js)` and fill in:

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
2. Go to **APIs & Services > OAuth consent screen** (`console.cloud.google.com/auth/overview`). Choose **External** as the user type, fill in the required fields (app name, support email), and save.

   Then decide the **publishing status**, because it decides who can sign in at all:

   | | Who can sign in | Cost to you |
   |---|---|---|
   | **Testing** (default) | Accounts listed under **Audience → Test users**, max 100 — *plus anyone with an owner or editor role on the Google Cloud project*. Everyone else gets `403 access_denied` | One entry per person, added by you |
   | **In production** | Anyone with a Google account | Every sign-in creates a household in *your* Supabase project |

   **That owner/editor exception is worth knowing before you conclude anything from testing.** Your own accounts probably have a role on the Cloud project, so they sign in whatever the publishing status is — which makes Testing look open when it is not. Check the status on the **Audience** page rather than inferring it from whether you personally can sign in.

   **Publishing does not require Google's verification review.** That is only for sensitive scopes — Gmail, Drive, contacts. Supabase's Google provider asks for `email`, `profile` and `openid`, which are not sensitive, so "Publish App" is the whole step. (Confirm in the console; Google moves these rules around.)

   Which to pick is a real choice, not a formality. **In production** is right as soon as anyone outside your Cloud project needs to sign in — a relative, a second household, a collaborator — and it saves adding each one by hand. **Testing** only buys you a gate against strangers finding the URL, and the thing that gate protects is free-tier storage, which photos are the only meaningful consumer of.

   One Testing-mode caveat that sounds alarming and is not: Google expires *its* refresh tokens after 7 days. It does not sign anyone out, because Supabase issues its own session tokens after the initial sign-in and never returns to Google to refresh them.
3. Go to **APIs & Services > Credentials > Create Credentials > OAuth client ID** (`console.cloud.google.com/auth/clients/create`).
  - Application type: **Web application**.
  - **Authorized JavaScript origins**: the **origin only, no path** — e.g. `https://YOUR-GITHUB-USERNAME.github.io`, plus `http://localhost:8000` and `http://localhost:8848` for local testing.
  - **Authorized redirect URIs**: this has to match Supabase's callback URL exactly — get it from the Supabase side first (next step), then come back and paste it in here.
4. Save. You'll get a **Client ID** and **Client Secret** — copy both.



### 3b. Supabase dashboard

1. In your Supabase project, go to **Authentication > Providers** and select **Google**.
2. Toggle it on. The page shows a **Callback URL (for OAuth)** — it looks like `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`. Copy this and paste it into the Google Cloud client's **Authorized redirect URIs** from step 3a (go back and add it there now, then save that Google Cloud page too).
3. Paste the **Client ID** and **Client Secret** from Google Cloud into this Supabase provider page. Save.
4. Go to **Authentication > URL Configuration**.
   - **Site URL** is a single field, not a list — it is only the fallback used when a request specifies no redirect. Set it to where the app is actually served, e.g. `https://YOUR-GITHUB-USERNAME.github.io/YOUR-REPO/`.
   - **Redirect URLs** is the allow list that matters, because `js/auth.js` always sends an explicit `redirectTo` of `origin + pathname` — **with no `#/...` fragment**. An entry like `https://…/YOUR-REPO/#/today` will therefore never match. Add a wildcard instead:
     - `https://YOUR-GITHUB-USERNAME.github.io/YOUR-REPO/*`
     - `http://localhost:8000/*` and `http://localhost:8848/*` — the walkthrough below uses 8000, `.claude/launch.json` uses 8848, and only the ports listed here can sign in.



## 4. Install the Supabase CLI and apply the migration

No global install needed — run it via `npx` from the repo root:

```bash
npx supabase login
npx supabase link --project-ref YOUR-PROJECT-REF
npx supabase db push
```

- `login` opens a browser to authenticate the CLI with your Supabase account.
- `link` connects this repo to the project you created in step 1 (find `YOUR-PROJECT-REF` in the project's dashboard URL, or on the API settings page from step 1).
- `db push` applies `[supabase/migrations/0001_init.sql](../supabase/migrations/0001_init.sql)` — every table, RLS policy, the code-gated function surface, and the nightly freeze cron job.

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
npx supabase functions deploy supporter-photo --no-verify-jwt
npx supabase functions deploy nudge --no-verify-jwt
```

- `send-reminders` sends the actual push notifications, cron-triggered (next step). It is called server-side by cron with the service-role key, so it keeps JWT verification.
- `supporter-photo` handles photo upload/delete/viewing for a supporter's device, which has no login session to use Supabase Storage directly.
- `nudge` sends the supporter's "have you taken them?" push.

**`--no-verify-jwt` on the last two is load-bearing, not optional.** Both are
called from a supporter's browser, which has no Supabase session — the share
code is the credential, checked inside the function itself. With JWT
verification on, Supabase's gateway rejects the browser's CORS *preflight*
before the function ever runs, and a preflight never carries an `Authorization`
header, so no amount of client-side auth helps.

The failure is worth recognising because it does not look like what it is: the
browser reports a bare "Failed to fetch", identical to the function not
existing at all, while `npx supabase functions list` cheerfully shows it
ACTIVE. If you hit that, check the preflight directly — a 401 with
`UNAUTHORIZED_NO_AUTH_HEADER` on an `OPTIONS` request is this problem.

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

This runs every 5 minutes. See `[supabase/migrations/0001_init.sql](../supabase/migrations/0001_init.sql)` for why `net.http_post` (pg_net always creates its own `net` schema, regardless of what schema it's installed "into").

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



## Why push looked broken (and how to tell what is wrong)

Four separate faults sat between "the function is deployed" and "a notification
arrives", and **every one of them failed silently**. They are all fixed in the
code, but if you are setting up a fresh project and push does not work, this is
the order to check — and the reason the errors are worth trusting now.

**1. The function is ACTIVE but the browser says "Failed to fetch."**
`supporter-photo` and `nudge` are called from a browser with no Supabase
session. If they are deployed *without* `--no-verify-jwt`, the gateway rejects
the CORS preflight — which never carries an `Authorization` header — before
your code runs. This is indistinguishable from the function not existing.
Confirm with an `OPTIONS` request: a `401 UNAUTHORIZED_NO_AUTH_HEADER` is this.

**2. `WORKER_ERROR: Function exited due to an error.`**
Something threw at module load. Most likely your VAPID keys. The functions now
report this as `push-not-configured` with a detail string rather than dying,
so you should get a readable message instead.

**3. `{"sent": 0, "reason": "db-error", ...}`**
A missing grant. `service_role` bypasses RLS but **still needs ordinary table
grants**, and `0001` only granted table access to `anon` and `authenticated`.
`0002` and `0008` exist entirely because of this. If you add a function that
queries a new table with the service key, it needs a grant too.

**4. `{"sent": 0, "reason": "no-subscriptions"}` when someone has reminders on.**
Either their subscription predates your current VAPID key (toggle reminders off
and on), or it is genuinely absent. The patient's Settings now reflects the
*server's* state, not the browser's, so if it says off then the row is missing.

### Checking a VAPID public key

`setVapidDetails` rejects anything that is not 65 bytes decoded. The key in
`js/config.js` must be byte-identical to the `VAPID_PUBLIC_KEY` secret:

```bash
node -e "const k=process.argv[1];const b=Buffer.from(k,'base64url');console.log(k.length+' chars ->',b.length,'bytes',b.length===65&&b[0]===4?'OK':'INVALID')" "$(grep -oP "VAPID_PUBLIC_KEY = '\K[^']+" js/config.js)"
```

**Changing VAPID keys invalidates every existing subscription.** Everyone with
reminders on has to toggle them off and back on. There is no way around this;
the subscription is cryptographically bound to the key it was created with.

## Verification checklist

- [ ] Sign in with Google works and creates exactly one household per account.
- [ ] A wrong or expired code shows a plain error on the pairing screen, not a crash.
- [ ] A medicine added by the supporter reaches the elder's Today screen live.
- [ ] Marking a dose Done/Undo works with the browser's network set to offline, and syncs once back online (devtools > Network > Offline, tap Done, go back online, check the `dose_log` table).
- [ ] Reminders arrive for a due-and-unlogged slot (test by adding a schedule due a few minutes from now, or by manually calling `select * from app.claim_due_notifications();` in the SQL editor to confirm it finds the right rows).
- [ ] A second reminder arrives ~45 minutes later if the slot is still unlogged, and stops entirely once the slot is marked done — test by lowering `p_followup`/`p_followup_grace` temporarily when calling `claim_due_notifications()` directly rather than waiting 45 real minutes.
- [ ] Rotating the share code (Settings, elder) invalidates the old code immediately.
- [ ] A direct query against `medicines`/`schedules`/`slots` using only the anon key (no session, no code) returns nothing — confirms the code-gated function surface is the only way in.
- [ ] A supporter device shows the patient's Today with their marks on it, and the "Updated ..." line under the date changes as it polls.
- [ ] The supporter's **Send a reminder** button buzzes the patient's phone, and pressing it again straight away says "Already sent" rather than buzzing twice.
- [ ] A medicine marked from the supporter's phone shows "Marked by your helper" on the patient's.
- [ ] Cycling a dose target twice records `status = 'skipped'` in `dose_log`, and tapping **Done** for that slot afterwards leaves the skip alone.
- [ ] `select * from public.claim_due_notifications();` runs from the SQL editor — if it errors with "function does not exist", `0009` has not been applied and the reminder cron cannot work.
- [ ] A direct call to `public.claim_due_notifications()` with **only the anon key** is refused. It returns push endpoints and their encryption keys, and must be `service_role` only.



## Troubleshooting


| Symptom                                                  | Likely cause                                                                                                                                                                                                                  |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google sign-in redirects to an error page                | The redirect URI in Google Cloud doesn't exactly match Supabase's callback URL (step 3), or the Site URL/Redirect URLs in Supabase (step 3b) don't include the origin you're testing from                                     |
| `db push` fails with a permission or connection error    | Not logged in (`npx supabase login`) or not linked to the right project (`npx supabase link --project-ref ...`)                                                                                                               |
| Push notifications never arrive                          | Work through "Why push looked broken" above — there are four distinct causes and they look alike. Confirm the `medtrack-push` cron exists (`select * from cron.job;`) and that `0009` is applied                                |
| An Edge Function is ACTIVE but the browser says "Failed to fetch" | Deployed without `--no-verify-jwt`, so the gateway rejects the CORS preflight. Applies to `supporter-photo` and `nudge`, never to `send-reminders`                                                                       |
| Reminders show "on" but nothing sends                    | A subscription created before the current VAPID key. Toggle reminders off and on. If it now shows "off", the server row was never written — the toggle reflects the server, not the browser                                    |
| A new Edge Function query returns nothing, with no error | `service_role` needs an explicit table grant; `0001` granted only `anon`/`authenticated`. See `0002` and `0008`. Always check `error`, never just `data`                                                                        |
| A Supabase project stops responding after being idle     | Free-tier projects pause after 7 days with zero activity — open the dashboard to un-pause it. The reminder cron running every 5 minutes should prevent this in practice; worth confirming rather than assuming                |
| "That code is not valid" for a code you're sure is right | The code may have been rotated since it was shared, or was mistyped — codes exclude `0`, `O`, `1`, `I`, `L` on purpose to avoid exactly this confusion                                                                        |


