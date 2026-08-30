# Architecture

## Online sync (current)

Only the "simple" (elder) person has an account: Google sign-in via Supabase Auth, one household per account. A supporter has **no account at all** — their device holds a standing share code (shown and rotatable in the simple person's Settings) and every write it makes goes through a `SECURITY DEFINER` Postgres function that resolves the household from that code (`supabase/migrations/0001_init.sql`). Nothing about a supporter is ever stored server-side. This is a deliberate friction/security tradeoff at this app's scale (a handful of households) — see the schema comments and `supabase/README.md`.

```
index.html
   │
   └── js/main.js ── opens local DB (cache), resolves auth/role, registers routes, draws nav
          │
          ├── js/router.js ────── hash routes (#/today), guarded by role
          ├── js/auth.js ───────── simple-only: Google sign-in, household create/resume
          ├── js/supporter.js ──── code-gated Supabase calls, no local cache, no session
          ├── js/sync.js ───────── simple-only: realtime mirror into IndexedDB + dose-log offline outbox
          ├── js/store.js ──────── the only module that touches the local IndexedDB cache
          │      └── js/db.js ─── IndexedDB promise wrapper
          ├── js/schedule.js ──── what is due on a date (also ported into Postgres, `app.compute_day`/`app.is_due`)
          └── js/views/* ──────── one module per screen
```

The **simple device**: Supabase Postgres is the source of truth; IndexedDB is a write-through cache kept fresh by `js/sync.js`'s Realtime subscription, plus a small `outbox` store so Done/Undo taps queue and replay if the connection drops — the one action that must never silently fail. Medicines, schedules and slots are read-only here; editing them has only ever lived in supporter-mode screens.

The **supporter device**: no local cache at all. Every screen calls `js/supporter.js`, which round-trips to Supabase on every load and every save. This requires connectivity, which is fine — routine edits are not the time-critical path.

A nightly Postgres cron job (`app.run_daily_freeze`) replaces the old file-import-time freeze: it computes and stores "what was due" for each household's local yesterday, then advances a read-only lock line that trails the freeze by a couple of days, so the offline dose-log outbox always has slack to catch up into. Reminders are Web Push (VAPID), sent by a `pg_cron`-scheduled Edge Function querying "due, unlogged, unnotified" slots — see the schema for the exact query.

The rest of this document describes the parts that are unchanged from the original local-only design: the append-only dose log rule, local-date arithmetic, and photo compression all still apply exactly as written below, just enforced in Postgres (constraints, triggers) as well as in `js/store.js`. The **"Import merges, it never replaces"** section further down describes the retired file-based sync model; it's kept for historical context, since the same asymmetry (routine vs. history have different owners) is what the RLS/function design above encodes, just as database policy instead of merge rules.

## Shape of it (local cache layer)

Plain HTML, CSS and ES modules, no build step for the frontend, no `package.json`. The one exception is `js/supabase.js`, which imports the Supabase client from a CDN ESM build (`esm.sh`) rather than `node_modules` — same "no bundler" constraint, just extended to cover a dependency that can't reasonably be hand-rolled.

Three decisions still explain most of the frontend code:

**No build step.** Relative paths behave identically on `localhost` and on GitHub Pages, so the base-path problem that normally bites project pages does not exist. Deploy is a push. `js/config.js`'s Supabase URL and anon key are safe to commit, so there's nothing to inject at deploy time either.

**Hash routing.** GitHub Pages has no redirects file, so a path-based client route 404s on refresh. `#/today` never does.

**Network-first service worker.** With no build step nothing bumps a cache version on deploy, so a cache-first worker would serve stale JavaScript forever. See §2.1 of the build plan; the `cache: 'no-cache'` in the fetch is load-bearing, not decoration. Supabase calls are cross-origin and pass through the service worker untouched.

## Local cache data model

Six IndexedDB object stores plus an `outbox`, database `medtrack` version 2. Defined in [js/db.js](../js/db.js), accessed only through [js/store.js](../js/store.js). This is the *cache* shape on the simple device; the authoritative shape lives in Postgres (`supabase/migrations/0001_init.sql`).

| Store | Key | Holds |
|---|---|---|
| `medicines` | `id` | name, strength, dosage, form, notes, `archived` |
| `photos` | `medicineId` | one compressed JPEG `Blob`. Optional |
| `schedules` | `id` | one row per medicine-and-slot pairing, plus frequency |
| `doseLog` | `id` | one row per medicine per slot per day, when marked done |
| `daySnapshots` | `date` | what was expected on a frozen past day |
| `settings` | `"app"` | single row: role, slot definitions, `lockedThrough` |

### Slots

A "slot" is a time of day — morning, afternoon, evening, night, plus any the supporter adds. They live in `settings.slots`, not their own store, because they are a short list edited as a unit:

```js
{ id: 'morning', label: 'Morning', time: '08:00', order: 1, builtIn: true }
```

A schedule points at a slot by `slotId` and may override its time (`time: '06:30'`) for one medicine. `null` means inherit the slot's time.

### Frequency

```js
{ type: 'daily' }
{ type: 'everyNDays', interval: 2, anchorDate: '2026-09-01' }
{ type: 'weekly', daysOfWeek: [0, 6] }        // 0 = Sunday
```

`anchorDate` is **mandatory** for `everyNDays`. Without a date to count from there is no way to know whether today is an "on" day; a missing anchor is treated as never due rather than guessed at.

## The rules that must not be broken

### 1. The dose log is append-only with respect to schedules

Editing, archiving or deleting a medicine, a schedule or a slot must **never** touch an existing `doseLog` row. History records what happened, not what the current routine says should have happened. Removing a schedule deactivates it (`active: false`) rather than deleting it, so old log rows still resolve.

There is exactly **one** sanctioned deletion, `undoSlot` in [js/store.js](../js/store.js): an explicit Undo tap removes the rows for that `(date, slotId)`. That is a person correcting a mis-tap, not code rewriting history. Nothing else may delete from this store.

### 2. Dates are local strings, never timestamps

All date maths goes through [js/date.js](../js/date.js) on `"YYYY-MM-DD"` strings. Never `new Date("2026-08-30")` — a bare date string parses as UTC and lands on the previous day west of Greenwich. Never add `86400000` to a timestamp — DST makes some local days 23 or 25 hours long. Day counting treats the local calendar parts as UTC, which makes every day exactly 24 hours without implying a timezone.

### 3. Import merges, it never replaces

The supporter's device is the source of truth for the routine. The other device is the source of truth for what was actually taken. So:

| Store | Rule |
|---|---|
| `medicines`, `schedules`, `slots` | The file wins. Dropped schedules are deactivated, not deleted |
| `doseLog` | **Union by id. Never overwritten, never deleted** |
| `daySnapshots` | Union by date, local wins — a local snapshot is what that device actually saw |
| `role` | Never imported. It is a property of the device |

The whole merge is one IndexedDB transaction, so a half-merged database is impossible. [js/merge.js](../js/merge.js) is pure functions over plain arrays — no database, no DOM — so the rules can be exercised from the browser console.

### 4. Past days are frozen at import time

Calendar rings need to know what was *expected* on a past day. Recomputing from the current routine would silently rewrite last month every time the supporter changes something.

So on import, before anything is written, every day from the last import up to yesterday is computed against the **pre-import** routine and written to `daySnapshots`; `lockedThrough` advances to yesterday. Frozen days are read only.

Consequences, both intended: corrections only reach back to the last import, and a device that never imports never freezes anything — correct, because nothing changed.

### 5. Photos are compressed before storage, and never in localStorage

Capture, then draw to a canvas at 800px on the longest edge and encode JPEG at 0.7 — roughly 60–120 KB, from a 3–6 MB camera original. Fifteen uncompressed photos would hit the storage quota, and the failure mode is a thrown exception mid-save rather than a warning.

localStorage is out entirely: ~5 MB, strings only, and base64 adds a third on top.

Every `URL.createObjectURL` in the app is created and revoked in [js/photos.js](../js/photos.js). Views collect tokens and release them on unmount; nothing else may create an object URL.

## Export format

One JSON file, photos base64 inline. Roughly 1–2 MB with fifteen photos, which sends fine over WhatsApp.

```js
{
  schemaVersion: 4,
  exportedAt, slots, medicines, schedules,
  doseLog,        // empty from supporter mode
  daySnapshots,   // empty from supporter mode
  lockedThrough,  // null from supporter mode
  photos: [ { medicineId, dataUrl } ]
}
```

One shape serves both directions; a supporter export simply has no history in it. Filenames differ on purpose — `medtrack-medicines-<date>.json` versus `medtrack-mycopy-<date>.json` — so two files arriving on the same day are not indistinguishable in the Files app.

Three checks run before the confirmation dialog: shape, a `schemaVersion` higher than the app's (which means this install is stale, not that the file is bad), and that every schedule's `slotId` exists in the file's slots. That last one matters because slots are replaced wholesale, so an orphan schedule would be invisible on every screen with no way for either person to notice a medicine had gone missing.
