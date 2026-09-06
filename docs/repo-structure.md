# Repo structure

No dependencies, no build output, nothing generated except the icons — for the frontend. `supabase/` holds the backend: a Postgres migration, two Edge Functions, and the CLI setup notes.

```
Medicine Tracker/
├── index.html                 app shell: one <main>, an overlay host, a nav
├── manifest.webmanifest       PWA manifest, all paths relative
├── sw.js                      service worker, plus Web Push handlers
├── README.md
├── .env.example                local dev / Supabase CLI variables (never real secrets)
│
├── css/
│   └── app.css                everything, two densities switched by a body class
│
├── js/
│   ├── main.js                boot, route registration, navigation, auth resolution
│   ├── router.js              hash router with a per-role route guard
│   ├── config.js              public Supabase URL / anon key / VAPID public key
│   ├── supabase.js            memoized Supabase client (CDN ESM import)
│   ├── auth.js                simple-only: Google sign-in, household create/resume
│   ├── supporter.js           code-gated Supabase calls for a supporter device, no session
│   ├── supporter-sync.js      supporter-only: polls those calls into the same local cache
│   ├── doses.js               one dose-writing facade; picks outbox or RPC by role
│   ├── sync.js                simple-only: Realtime mirror into the local cache, dose-log offline outbox
│   ├── push.js                simple-only: Web Push subscribe/unsubscribe
│   ├── db.js                  IndexedDB promise wrapper, schema, upgrade
│   ├── store.js               typed access to the local cache; the only module that touches db.js
│   ├── date.js                local YYYY-MM-DD maths
│   ├── schedule.js            what is due on a date; snapshots; calendar counts
│   ├── organiser.js           pure: what goes in each pill-box compartment for a week
│   ├── photos.js              capture, compression, object-URL lifetime
│   ├── strings.js             every user-visible string, and APP_VERSION
│   ├── ui.js                  DOM helper, dialog, sheet, toast, photo viewer
│   └── views/
│       ├── onboarding.js      "Who uses this phone?" — routes into auth.js or pairing.js
│       ├── auth.js            simple-only: "Sign in with Google"
│       ├── pairing.js         supporter-only: enter the household's share code
│       ├── today.js           the Today screen
│       ├── day.js             one day's slots — shared by Today and Calendar
│       ├── calendar.js        month grid, rings, day sheet
│       ├── organiser.js       filling the weekly pill box: start, step, check
│       ├── medicine-sheet.js  one medicine, everything known about it
│       ├── medicines.js       supporter: the medicine list, fetched live via the share code
│       ├── medicine-form.js   supporter: medicine + schedules in one form
│       └── settings.js        both modes, plus the slot-times screen
│
├── supabase/
│   ├── README.md               one-time backend setup steps
│   ├── migrations/
│   │   ├── 0001_init.sql      tables, RLS, the code-gated function surface, freeze + reminder jobs
│   │   ├── 0002 / 0003        service-role photo grants; Realtime
│   │   ├── 0004_second_reminder.sql   one follow-up if a slot is still unmarked
│   │   ├── 0005_skipped_doses.sql     widens dose_log.status, adds the UPDATE policy
│   │   ├── 0006_supporter_parity.sql  logged_by + four code-gated read/write functions
│   │   ├── 0007_nudge.sql             last_nudge_at, the nudge rate limit
│   │   ├── 0008_nudge_grants.sql      service_role grants the nudge needs
│   │   ├── 0009_reminder_rpc_wrappers.sql  public wrappers for the app.* push
│   │   │                              functions -- PostgREST cannot reach the
│   │   │                              app schema, so cron had nothing to call
│   │   ├── 0010_slot_time_in_snapshots.sql  a medicine's own time stops
│   │   │                              relabelling the slot it sits in
│   │   ├── 0011_medicine_details.sql  purpose, packet photo, and dosage text
│   │   │                              replaced by numeric dose_qty
│   │   └── 0012_pill_box_slots.sql    slots.in_box + set_slot_in_box
│   └── functions/
│       ├── send-reminders/    Edge Function: Web Push delivery, cron-triggered
│       ├── nudge/             Edge Function: the supporter's "have you taken them?" push
│       └── supporter-photo/   Edge Function: photo upload/delete/signed-URL for code-gated devices
│
├── icons/
│   ├── icon-192.png  icon-512.png  apple-touch-icon.png  favicon-32.png
│   ├── favicon.svg            the tab icon, hand-written to match the PNGs
│   └── make-icons.py          regenerates the four PNGs, stdlib only
│
└── docs/
    ├── architecture.md
    ├── repo-structure.md
    ├── ui.md
    ├── flow.md
    ├── v3-plan.md                     the v3 overhaul: phases, decisions, what is left
    ├── medicine-tracker-plan-v3.md    the original local-only build spec, superseded
    └── next-steps.md                  everything deferred
```

## What each module is responsible for

| File | Responsibility |
|---|---|
| `js/db.js` | `open`, `get`, `getAll`, `getAllFromIndex`, `put`, `putMany`, `del`, `delMany`, `clear`, `replaceAll`, `uuid`. Stands in for the `idb` library. `replaceAll` empties and refills a store in **one** transaction — a clear followed by a separate write leaves a window in which the routine is empty, and a read landing in it renders the elder's cold-start screen |
| `js/store.js` | Reads used by every view (`getMedicines`, `getDoseLogForDate`, ...), the dose-log append-only rule, and a small set of cache-writer/outbox functions used only by `js/sync.js`. Also the organiser session (`getOrganiser`, `startOrganiser`, `setOrganiserStepDone`) and `getBoxSlots()`. `clearHouseholdData()` wipes everything but settings, on sign-out and disconnect |
| `js/auth.js` | Google sign-in, household create/resume, share-code rotation — simple-only |
| `js/supporter.js` | `loadRoutine`, `saveMedicine`, `replaceSchedules`, `saveSlots`, photo actions, `loadDoseLog`/`loadHistory`/`logDose`/`unlogSlot`, `nudge` — every one code-gated, no session |
| `js/supporter-sync.js` | `hydrate`, `ensureRange`, `refresh`, `startPolling`, `lastSync`. Fills the same cache `js/sync.js` does, but by polling — Realtime cannot reach a sessionless device. `refresh` returns whether anything actually changed, so a tick that changed nothing does not re-render the screen |
| `js/doses.js` | `setDose`, `logSlot`, `undoSlot`. The one place that knows the elder writes through the outbox and the supporter writes through RPCs |
| `js/sync.js` | Supabase Realtime subscription that mirrors a household's tables into the local cache, plus the dose-log offline outbox |
| `js/date.js` | `todayStr`, `addDays`, `daysBetween`, `dayOfWeek`, `monthGrid`, `formatTime`, `formatLong`, `msUntilTomorrow`. No UTC anywhere |
| `js/schedule.js` | `isDueOn`, `buildDay`, `dueOn`, `expectedFor`, `completionForDates`. The pure functions take plain arrays and can be called from the console; `isDueOn` is also ported into Postgres as `app.is_due` |
| `js/organiser.js` | `planWeek(startDate, {medicines, schedules, slots})` → `{ dates, boxSlots, steps, compartments, outOfBox }`. Pure, console-callable. `steps` and `compartments` are the same numbers pivoted for the two screens, computed together so they cannot disagree. `BOX_FORMS` is what may physically go in a tray |
| `js/views/organiser.js` | `#/organiser` — start screen, one step per medicine (`?step=N`), then the check screen (`?step=check`). Owns the wake lock |
| `js/photos.js` | `compress`, `objectUrl`/`release`, `blobToDataUrl`/`dataUrlToBlob` |
| `js/ui.js` | `el()` for DOM building, plus `confirmDialog`, `alertDialog`, `openSheet`, `openPhotoViewer`, `busyOverlay`, `toast`, `pickFile`, `pillTile`, `loadingState`, `applyTheme`, and `doseText`/`doseAmount` (a `doseQty` plus a `form` rendered as "2 tablets" or just "½") |
| `js/views/day.js` | The shared day renderer, so a past day is corrected with the same controls as today |

## Conventions

- **One module owns the local cache.** Views call `store.*`, never `db.*`. `js/sync.js` is the one exception permitted to write through `store.*`'s cache-writer functions.
- **The supporter's cache is read-only.** Since v3 a supporter device does cache the routine and history (`js/supporter-sync.js`), so Today and Calendar can render. But supporter *writes* never touch the outbox — nothing there would flush it — they go out through `js/supporter.js` and are mirrored in afterwards. `js/doses.js` is the only module that knows this.
- **Writes go through `js/doses.js`, not `js/sync.js`.** A view that calls `sync.*` directly works on the elder's device and silently does nothing useful on the supporter's.
- **A view must check `isCurrent()` after every await, before touching the DOM.** The router passes it in and uses it to drop superseded renders. Skipping it reintroduces the two-copies-of-the-screen bug — see [architecture.md](architecture.md), "Rendering: one screen at a time".
- **Read the node you are replacing before you build its replacement,** and read `document.activeElement` before the swap, not after. Both mistakes fake success: the builder registers what it creates so a later lookup hands back the new detached node, and removing a focused element resets `activeElement` to `<body>` immediately. Each has cost a day once already.
- **No text outside `strings.js`.** Views reference `S.something`. This is what makes an Urdu translation a data change rather than a refactor.
- **No HTML strings with data in them.** Everything goes through `el()` and `textContent`, so a medicine named `<img onerror=…>` is just a medicine with a silly name.
- **Views return their cleanup.** A view that creates photo object URLs returns a function; the router calls it before rendering the next screen.
- **Update in place, do not re-render.** After a write, replace the one node that changed. Rebuilding a whole screen re-reads the database, reloads photos and resets the scroll, which looks like the page refreshing.
- **`append()` tolerates null; `appendChild` throws.** Any builder that can
  return nothing — an empty section, an absent strip — must be added with
  `append()` from `js/ui.js`. This has broken a screen once already, and only
  in the case where the feature had nothing to show, which is the case
  fixtures habitually omit.
- **A new `medicines` column has seven homes**, and a missed one fails
  silently: the migration, `public.get_routine`, `public.upsert_medicine`,
  `app.compute_day`, `mapMedicine` in `js/sync.js`, the medicine form, and —
  if `supporter-photo` writes it — the column-level `service_role` grant.
- **`--nav-h` must be the bar's exact height**, applied as `height` and not
  `min-height`. The organiser's fit layout subtracts it to size itself, so a
  declared height the content then exceeds makes that subtraction wrong — it
  did, by 10px, and the buttons sat under the bar.
- **Form controls need `min-width: 0`.** Their `min-width` defaults to `auto`,
  which is the control's intrinsic minimum — the width of a native date or time
  input's shadow content. WebKit enforces it and `width: 100%` loses, taking
  the page into horizontal scroll; Blink renders them compactly enough to fit.
- **A percentage height needs a definite parent.** `max-height: 100%` against
  a chain of `auto` heights resolves to `none` in WebKit and to something
  usable in Blink, so it works in desktop responsive mode and fails on the
  phone. If a box must constrain its contents, give it a real height.
- **Comments explain why, not what.** The ones worth reading are on the append-only rule, the service worker's `no-cache`, and the two-clock freeze design in `supabase/migrations/0001_init.sql`.

## Regenerating the icons

```bash
python3 icons/make-icons.py
```

Writes the four PNGs from scratch using only `zlib` and `struct` — no Pillow, no ImageMagick. Paths are relative to the script, so it runs from any checkout.

Credentials that are not safe to commit live **outside** the repository, in
`~/.medicine-tracker/`. `js/config.js` is committed on purpose — the anon key
and the VAPID public key are meant to be public and the deployed site needs
them — which is why `.gitignore` says so explicitly rather than listing it.

`apple-touch-icon.png` is a full opaque square because iOS composites onto black and applies its own corner mask. `favicon.svg` is not generated: it is hand-written to the same geometry, because a vector stays crisp at every tab-bar size and zoom level in under a kilobyte. `favicon-32.png` exists only for browsers that ignore SVG icons. If you change the mark, change both.
