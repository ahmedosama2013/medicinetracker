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
          ├── js/supporter.js ──── code-gated Supabase calls, no session
          ├── js/supporter-sync.js  supporter-only: polls those calls into the same cache
          ├── js/sync.js ───────── simple-only: realtime mirror into IndexedDB + dose-log offline outbox
          ├── js/doses.js ──────── one dose-writing facade over both of the above
          ├── js/store.js ──────── the only module that touches the local IndexedDB cache
          │      └── js/db.js ─── IndexedDB promise wrapper
          ├── js/schedule.js ──── what is due on a date (also ported into Postgres, `app.compute_day`/`app.is_due`)
          ├── js/organiser.js ─── pure: what goes in each pill-box compartment for a week
          └── js/views/* ──────── one module per screen
```

The **simple device**: Supabase Postgres is the source of truth; IndexedDB is a write-through cache kept fresh by `js/sync.js`'s Realtime subscription, plus a small `outbox` store so dose taps queue and replay if the connection drops — the one action that must never silently fail. Medicines, schedules and slots are read-only here; editing them has only ever lived in supporter-mode screens.

The **supporter device**: also has a local cache now, filled by `js/supporter-sync.js` through the code-gated RPCs. This reverses the original "no local cache at all", and the reversal is deliberate — see below.

### Why the supporter gained a cache (v3)

Until v3 a supporter had no screen that rendered a day, so every screen could
round-trip on load and hold nothing. Giving them Today and Calendar changed
that: those screens are `js/schedule.js` + `js/views/day.js`, which read from
`js/store.js`. The alternative was parameterising every read path by role,
which is far more code and gives two ways for one screen to be wrong.

So `js/supporter-sync.js` fills the same IndexedDB stores the elder's device
uses. **The reason behind the old rule still holds and still shapes the file:
the cache is read-only on that side.** Supporter writes never enter
`js/sync.js`'s outbox — nothing on a supporter device would ever flush it, so a
queued write would sit there looking saved forever. They go straight out
through the RPCs in `js/supporter.js` and are mirrored into the cache
afterwards. `js/doses.js` is the seam: one facade, those two routes underneath.

The consequence is intended: a supporter write needs connectivity and reports
failure, rather than deferring silently. Marking a dose on someone else's
behalf is not something to queue.

**The cache belongs to a household, and leaving one clears it.**
`store.clearHouseholdData()` runs on sign-out and on disconnect, before the
settings are rewritten. `replaceMedicinesCache` overwrites medicines on the
next sync, but `doseLog`, `daySnapshots` and `photos` are only ever added to —
so without this, signing in with a different account or pairing to another
household left the previous one's dose history and pill photos on the device
and rendering in the calendar.

**Realtime is not available to a supporter.** It respects RLS, and with no
session they match no rows, so no events can ever arrive. `supporter-sync`
polls while the app is visible instead, and the UI says when it last reached
the server rather than implying it is live. History is fetched a range at a
time — 75 days on open, then `ensureRange` pulls a month the first time the
calendar pages to it, because hollow rings do not read as "not loaded", they
read as "they took nothing that month".

### Rendering: one screen at a time (v3, Phase 2.5)

Every view is `clear(app)` → `await` → `appendChild`, and for a long time
nothing serialised them. Two overlapping renders therefore appended **two live
copies of the same screen** — the same slots, the same medicines — which
disappeared on reload because a reload runs exactly one render.

`js/router.js` numbers each render and hands the view an `isCurrent()`
predicate. **A view must check it after every await, before touching the DOM.**
That is the contract; a new view that skips it reintroduces the bug. Where it
was cheap, views also build detached and clear only once they hold everything,
which removes the window rather than only guarding it.

The router also catches a throwing view. Before, a rejection went nowhere and
the person sat on the previous screen with no explanation.

### What may re-render, and when

The rule underneath all of this: **a screen that has already updated itself
must not be redrawn for the change it just made.** `js/views/day.js` swaps one
slot node on a dose change specifically to avoid re-reading the database,
reloading every photo and jumping the scroll position — and two separate
mechanisms used to undo that on every tap.

- **Realtime echoes.** Postgres broadcasts to every subscriber including the
  writer, so a Done tap on a five-medicine slot came back as five events and
  five refreshes. `js/sync.js` mirrors every event into the cache — that part
  is not optional — but skips the redraw for row ids this device wrote in the
  last ten seconds, and coalesces bursts from separate tables into one refetch.
- **The supporter's poll.** It called back every sixty seconds regardless.
  `supporter-sync.refresh()` now returns whether the server's view actually
  differs from the last sync, and the poll only re-renders when it does.
- **The elder's own routine writes.** Since the pill-box flags, the elder's
  device writes to `slots` too, and that write echoes straight back. The
  routine tables use the same `localWrites` map the dose log does, keyed on row
  id. `isLocalEcho` *consumes* its entry, so the burst check maps before it
  reduces — short-circuiting would leave ids in the map to swallow somebody
  else's later change.
- **Boot and backfill.** `refetchRoutine` and `refetchHistory` return whether
  anything actually differed, signature-compared against the cache. Boot
  renders from cache immediately and redraws only if the server turned out to
  differ — which is what makes an elder signing in on a wiped cache see their
  medicines rather than the cold-start screen, without making every daily open
  wait on the network. `backfill()` uses the same answer, so returning to the
  app does not rebuild a screen that was already right.

  `backfill`'s in-flight guard is a timestamp, not a boolean. Cleared only in a
  `finally`, a fetch that never settles — one bar of signal, no response and no
  rejection — would disable backfill for the life of the page: the mechanism
  for recovering from a bad connection, switched off by one.

An in-place update that finds its node detached (something re-rendered while a
write was in flight — easy during a confirmation dialog) calls back to
`onStale`, and the caller re-renders from the store. Silently doing nothing was
the old behaviour and it read exactly like the tap being ignored.

### Organiser mode

Filling a weekly pill box. `js/organiser.js` is pure and console-callable;
`js/views/organiser.js` is the screen. Four rules hold it together:

- **It never writes to the dose log.** Filling a tray is not taking a medicine.
  Nothing in either file imports `js/doses.js`, and it must stay that way.
- **The plan is computed forward from `schedule.isDueOn`, never from
  snapshots** — those only exist for past days.
- **The plan is frozen when a sitting starts** (`store.startOrganiser`) and
  read back on every render, so a supporter's edit cannot move the grid under
  someone's hands. The one exception: if the set of `inBox` slots no longer
  matches the plan's, the sitting is discarded, because the tray it was planned
  for no longer exists.
- **The step lives in the hash** (`#/organiser?step=3`, or `?step=check`), not
  in a variable. Realtime, the midnight check and the supporter's poll all call
  `router.refresh()`, and a step index in a closure would reset someone to
  medicine one mid-tray.

The wake lock is module-level, released only when `currentPath()` is no longer
`#/organiser` — the router runs a view's cleanup *after* the hash has changed,
which is what makes a step change distinguishable from leaving.

### Today has to mean today

Every screen used to compute the date once, at mount. An installed PWA left on
Today overnight showed yesterday in the morning and wrote doses to yesterday's
`local_date` — which, once the freeze has advanced `locked_through`, is
rejected, and the outbox cannot tell a rejection from being offline, so it
retries forever.

`js/main.js` watches for the day to change: a timer to the next local midnight
for a phone left awake, and a `visibilitychange`/`focus` check for one that was
asleep and had its timers throttled. The calendar re-reads both the date and
the lock line on every draw rather than capturing them at mount.

The same visibility trigger, and the Realtime `SUBSCRIBED` callback, backfill
history on the elder's device. The client reconnects its websocket on its own
but never replays what was missed.

A nightly Postgres cron job (`app.run_daily_freeze`) replaces the old file-import-time freeze: it computes and stores "what was due" for each household's local yesterday, then advances a read-only lock line that trails the freeze by a couple of days, so the offline dose-log outbox always has slack to catch up into. Reminders are Web Push (VAPID), sent by a `pg_cron`-scheduled Edge Function querying "due, unlogged, unnotified" slots — see the schema for the exact query.

The rest of this document describes the parts unchanged from the original local-only design: the append-only dose log rule, local-date arithmetic, and photo compression all still apply, now enforced in Postgres (constraints, triggers, RLS) as well as in `js/store.js`.

## Shape of it (local cache layer)

Plain HTML, CSS and ES modules, no build step for the frontend, no `package.json`. The one exception is `js/supabase.js`, which imports the Supabase client from a CDN ESM build (`esm.sh`) rather than `node_modules` — same "no bundler" constraint, just extended to cover a dependency that can't reasonably be hand-rolled.

Three decisions still explain most of the frontend code:

**No build step.** Relative paths behave identically on `localhost` and on GitHub Pages, so the base-path problem that normally bites project pages does not exist. Deploy is a push. `js/config.js`'s Supabase URL and anon key are safe to commit, so there's nothing to inject at deploy time either.

**Hash routing.** GitHub Pages has no redirects file, so a path-based client route 404s on refresh. `#/today` never does.

**Network-first service worker.** With no build step nothing bumps a cache version on deploy, so a cache-first worker would serve stale JavaScript forever. See §2.1 of the build plan; the `cache: 'no-cache'` in the fetch is load-bearing, not decoration. Supabase calls are cross-origin and pass through the service worker untouched.

## Local cache data model

Seven IndexedDB object stores plus an `outbox`, database `medtrack` version 3. Defined in [js/db.js](../js/db.js), accessed only through [js/store.js](../js/store.js). This is the *cache* shape on the simple device; the authoritative shape lives in Postgres (`supabase/migrations/0001_init.sql`).

| Store | Key | Holds |
|---|---|---|
| `medicines` | `id` | name, strength, `doseQty` (a number), `form`, `purpose`, notes, `archived` |
| `photos` | `medicineId` | `blob` (the pill) and `packetBlob` (the box), both optional, one record |
| `schedules` | `id` | one row per medicine-and-slot pairing, plus frequency |
| `doseLog` | `id` | one row per medicine per slot per day: `status` (`taken`/`skipped`) and `loggedBy` |
| `daySnapshots` | `date` | what was expected on a frozen past day |
| `settings` | `"app"` | single row: role, slot definitions, `lockedThrough`, `theme` |
| `outbox` | `id` | elder-only: dose writes queued while offline |
| `organiser` | `"current"` | one in-progress pill-box filling. Local, never synced |

### Slots

A "slot" is a time of day — morning, afternoon, evening, night, plus any the supporter adds. They live in `settings.slots`, not their own store, because they are a short list edited as a unit:

```js
{ id: 'morning', label: 'Morning', time: '08:00', order: 1, builtIn: true, inBox: true }
```

`inBox` is whether this time of day goes in the weekly pill box. It is
household state, not device state — there is one physical tray — so it lives on
`public.slots` and both phones agree about it. Written by `set_slot_in_box`,
which is deliberately narrower than `save_slots`: the elder's Settings can call
it, and that screen has no business archiving a time of day.

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

There is exactly **one** sanctioned deletion, `undoSlot` in [js/store.js](../js/store.js): an explicit Undo tap removes the rows for that `(date, slotId)`. That is a person correcting a mis-tap, not code rewriting history. Nothing else may delete from this store. Since v3 a person can also clear one medicine by cycling its target past `skipped`, which is the same thing at a finer grain.

A dose row now carries `status` (`taken` or `skipped`) and `loggedBy`
(`patient` or `supporter`, null on rows predating migration 0006). Moving a row
between states is an **update**, not a delete-and-insert: migration 0005 adds
the UPDATE policy that 0001 deliberately omitted, because expressing a state
change as two queued operations lets the offline outbox flush them in the wrong
order and erase a dose the person recorded. See the migration header.

### 2. Dates are local strings, never timestamps

All date maths goes through [js/date.js](../js/date.js) on `"YYYY-MM-DD"` strings. Never `new Date("2026-08-30")` — a bare date string parses as UTC and lands on the previous day west of Greenwich. Never add `86400000` to a timestamp — DST makes some local days 23 or 25 hours long. Day counting treats the local calendar parts as UTC, which makes every day exactly 24 hours without implying a timezone.

And **never treat the date as fixed for the life of a screen.** A view that
captures `todayStr()` at mount is correct until midnight and then quietly wrong
in the worst possible way: it keeps accepting taps and writing them to
yesterday. See "Today has to mean today" above.

### 2b. Every write is one write

Two rules that both exist because the same tap arrived twice:

- **Only one outbox flush at a time.** Every dose write kicks off a flush
  without awaiting it, so a burst of taps used to start a burst of flushes,
  each holding a different snapshot of the queue and racing to the network.
  Whichever landed last won, which is not necessarily the one the person tapped
  last. Writes for a single dose are also chained in `js/views/day.js`, so the
  last tap is the last write.
- **A button that starts a round trip disables itself.** Medicine-form Save did
  not, and two taps meant two medicines with the same name — `draft.id` was
  still null on the second pass.

### 3. Retired: the file-based hand-off

v1 and v2 moved data between the two phones as a JSON file, and this document
used to describe the merge rules and export format at length. Both are gone —
Supabase is the transport now, and `js/merge.js` no longer exists.

The asymmetry those rules encoded is still the design, just expressed as
database policy instead: **the supporter's device is the source of truth for
the routine, the elder's for what was actually taken.** That is what the RLS
policies and the code-gated function surface in
`supabase/migrations/0001_init.sql` enforce, and it is why the dose log is
append-only above while medicines and schedules are replaced wholesale.

### 4. Past days are frozen server-side

Calendar rings need to know what was *expected* on a past day. Recomputing from
the current routine would silently rewrite last month every time the supporter
changed something.

A `pg_cron` job (`app.run_daily_freeze`, every 15 minutes) computes each
household's local yesterday against the routine as it stands and writes it to
`day_snapshots`, then advances `locked_through` — a read-only line trailing the
freeze by `lock_lag_days` (default 2), so the offline outbox always has slack
to catch up into. Days on or before that line are read-only on both devices.

This replaced the v1 behaviour of freezing at import time, whose consequence
was that a device which never imported never froze anything.

### 5. Photos are compressed before storage, and never in localStorage

Capture, then draw to a canvas at 800px on the longest edge and encode JPEG at 0.7 — roughly 60–120 KB, from a 3–6 MB camera original. Fifteen uncompressed photos would hit the storage quota, and the failure mode is a thrown exception mid-save rather than a warning.

localStorage is out entirely: ~5 MB, strings only, and base64 adds a third on top.

Every `URL.createObjectURL` in the app is created and revoked in [js/photos.js](../js/photos.js). Views collect tokens and release them on unmount; nothing else may create an object URL.
