# Architecture

## Shape of it

A static site. Plain HTML, CSS and ES modules, no build step, no dependencies, no `package.json`. The browser loads `index.html`, which loads `js/main.js`, which opens IndexedDB and renders a view into `<main>`.

```
index.html
   │
   └── js/main.js ── opens DB, reads role, registers routes, draws nav
          │
          ├── js/router.js ────── hash routes (#/today), guarded by role
          ├── js/store.js ─────── the only module that touches the database
          │      └── js/db.js ─── IndexedDB promise wrapper
          ├── js/schedule.js ──── what is due on a date
          ├── js/backup.js ────── export / import orchestration
          │      └── js/merge.js  merge rules, pure functions
          └── js/views/* ──────── one module per screen
```

Three decisions explain most of the code:

**No build step.** Relative paths behave identically on `localhost` and on GitHub Pages, so the base-path problem that normally bites project pages does not exist. Deploy is a push. The cost is no bundler and no npm packages, which is why `js/db.js` is a hand-written IndexedDB wrapper instead of the `idb` library and the CSS is hand-written instead of a framework.

**Hash routing.** GitHub Pages has no redirects file, so a path-based client route 404s on refresh. `#/today` never does.

**Network-first service worker.** With no build step nothing bumps a cache version on deploy, so a cache-first worker would serve stale JavaScript forever. See §2.1 of the build plan; the `cache: 'no-cache'` in the fetch is load-bearing, not decoration.

## Data model

Six IndexedDB object stores, database `medtrack` version 1. Defined in [js/db.js](../js/db.js), accessed only through [js/store.js](../js/store.js).

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
