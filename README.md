# Medicine Tracker

A medicine reminder and pill identification app for elderly users. Runs in the browser, backed by Supabase (Postgres, Auth, Realtime, Storage). Only the person taking the medicines has an account — a helper never signs up at all, they just enter a code.

It solves two problems:

1. **Which pill is which.** Every medicine can carry a photo the helper took themselves, shown full screen with one tap. This is the point of the app.
2. **What was taken.** One tap marks a whole time of day as done, and a month calendar shows the record.

A helper's edits reach the elder's phone within a few seconds, live — no exporting or importing a file. See [docs/architecture.md](docs/architecture.md) for how.

---

## Two people, two phones

The app asks one question on first run — *"Who uses this phone?"* — and becomes a different app depending on the answer.

| | **Simple** (the person taking medicines) | **Supporter** (the person helping) |
|---|---|---|
| Sees | Today, Calendar, Settings | Medicines, Settings |
| Does | Marks doses done, checks photos | Adds medicines, photos, times |
| Account | Signs in with Google, once | None. Enters a code from the simple person's Settings screen |
| Interface | 20px minimum text, 56px minimum targets | Normal density, forms are fine |

The simple person's Google account owns the household and its share code. A supporter's device holds only that code — nothing about a supporter is ever stored server-side. That's a deliberate tradeoff at this app's scale (a handful of households): lower friction for the helper, at the cost of not knowing *which* supporter made a given edit, and a code rotation cutting off everyone who had the old one, not just one person. See [docs/architecture.md](docs/architecture.md) for the reasoning.

The mode can be changed at any time in Settings, and is not hidden behind a gesture.

---

## Setting it up

Both phones and the daily routine are in **[docs/flow.md](docs/flow.md)**, written to be read aloud over a call.

The short version: the elder installs the app and signs in with Google. Settings shows their code. The helper installs the app, chooses "I help someone", and enters that code — no account needed. From then on, anything the helper adds or changes appears on the elder's phone automatically.

## Backend setup (for developers)

The app needs a Supabase project behind it — see **[docs/setup.md](docs/setup.md)** for the complete, step-by-step one-time setup (Supabase project, Google OAuth, migration, VAPID keys, deploying). `js/config.js` holds the public project URL and keys; see the comment there for why those are safe to commit.

## Running it locally

Still no build step, no `npm install`, no `node_modules` for the frontend itself.

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000/. Service workers and IndexedDB both work on `localhost` without HTTPS. You'll need `js/config.js` pointing at a real Supabase project (see above) for sign-in and sync to do anything.

## Deploying

Push to `main` and point GitHub Pages at the repository root, same as always — the frontend is still a static site with relative paths. `js/config.js`'s values are safe to commit, so there's nothing to inject at deploy time.

The service worker fetches network-first, so a deploy reaches the phone on the next open with no cache version to bump and nothing to clear.

## Cost

Free at this app's scale (a handful of households): Supabase's free tier covers the database, auth, storage, and Edge Function calls with room to spare, and GitHub Pages hosting stays free. The one thing worth watching: Supabase free projects pause after 7 days with zero activity — the reminder cron running every few minutes should prevent that in practice, but it's worth confirming rather than assuming.

---

## Known limits

- **iOS can still evict local data**, but it now matters far less: the phone's IndexedDB is a cache, not the source of truth, so a reinstall or an evicted cache just re-syncs from Supabase on the next sign-in.
- **Days before the last freeze are read only.** A nightly job freezes yesterday's calendar so an updated routine cannot rewrite last month. The trade-off is that a mistake more than a couple of days old cannot be corrected.
- **One household per Google account, one account per household**, for now — a caregiver looking after two parents needs two accounts. Multiple supporters *can* share one household's code, though.
- **A supporter's write access is only as secure as the code.** Anyone who has it can add or edit medicines; there's no per-supporter identity or audit trail. Rotating the code in Settings cuts off everyone who had the old one.
- **No clinical logic.** No interaction checking, no dose validation, no advice. This is a memory aid.

---

## Documentation

| File | What is in it |
|---|---|
| [docs/flow.md](docs/flow.md) | **Start here.** What both people do, step by step, and what to do when something goes wrong |
| [docs/architecture.md](docs/architecture.md) | How it works: data model, the rules that must not be broken |
| [docs/repo-structure.md](docs/repo-structure.md) | What every file does |
| [docs/ui.md](docs/ui.md) | Every screen, and the design rules behind them |
| [docs/medicine-tracker-plan-v3.md](docs/medicine-tracker-plan-v3.md) | Historical: the original local-only build spec, superseded by the online-sync design above |
| [docs/next-steps.md](docs/next-steps.md) | Everything deliberately deferred (reminders and two-way sync are now done) |
| [docs/setup.md](docs/setup.md) | **Start here if you're standing this up.** Backend setup, step by step: Supabase project, Google OAuth, migration, VAPID keys, deploying |
