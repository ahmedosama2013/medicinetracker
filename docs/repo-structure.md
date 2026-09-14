# Repo structure

No dependencies, no build output, nothing generated except the icons - for the frontend. `supabase/` holds the backend: a Postgres migration, two Edge Functions, and the CLI setup notes.

```
CarePair/
├── index.html                 app shell: one <main>, an overlay host, a nav, a toast host
├── manifest.webmanifest       PWA manifest, all paths relative
├── sw.js                      service worker, plus Web Push handlers
├── README.md
├── .env.example                local dev / Supabase CLI variables (never real secrets)
│
├── css/
│   └── app.css                everything, two dialects switched by a body class
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
│   ├── day-model.js           pure-ish: one day described once - tone, status, summary
│   ├── marking.js             writing a dose: optimistic, queued, labelled, undoable
│   ├── photos.js              capture, compression, object-URL lifetime
│   ├── strings.js             every user-visible string, and APP_VERSION
│   ├── ui.js                  DOM helper, the screen scaffold, dialog/sheet/toast/viewer
│   └── views/
│       ├── onboarding.js      "Who uses this phone?" + the How-it-works carousel
│       ├── auth.js            simple-only: "Continue with Google", 3 states
│       ├── pairing.js         supporter-only: the share code, 5 states
│       ├── today.js           elder Today (E1); dispatches to today-supporter.js
│       ├── today-supporter.js supporter Today: collapsible slots, sync line, on-behalf
│       ├── slot.js            elder E2 - one time of day, photo first
│       ├── day.js             supporter: one calendar day, editable / locked / future
│       ├── calendar.js        month grid of day tiles
│       ├── organiser.js       filling the weekly pill box: start, step, check
│       ├── medicine-sheet.js  one medicine, everything known about it
│       ├── medicines.js       supporter: the medicine list, fetched live via the share code
│       ├── medicine-form.js   supporter: medicine + schedules in one form
│       └── settings.js        both roles, plus the times-of-day screen
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
│       ├── test-notification/ Edge Function: authenticated test push to the elder's own device
│       └── supporter-photo/   Edge Function: photo upload/delete/signed-URL for code-gated devices
│
├── icons/
│   ├── icon-192.png  icon-512.png  apple-touch-icon.png  favicon-32.png
│   ├── favicon.svg            the tab icon, hand-written to match the PNGs
│   └── make-icons.py          regenerates the four PNGs, stdlib only
│
├── design_handoff_carepair_elder_ui/   the v4 redesign source: a handoff README
│                                       and a navigable HTML prototype. Read as a
│                                       spec; nothing is ported from it
│
└── docs/
    ├── architecture.md
    ├── repo-structure.md
    ├── ui.md
    ├── flow.md
    ├── v3-plan.md                     the v3 overhaul: phases, decisions - historical
    ├── medicine-tracker-plan-v3.md    the original local-only build spec, superseded
    └── next-steps.md                  everything deferred
```

## What each module is responsible for

| File | Responsibility |
|---|---|
| `js/db.js` | `open`, `get`, `getAll`, `getAllFromIndex`, `put`, `putMany`, `del`, `delMany`, `clear`, `replaceAll`, `uuid`. Stands in for the `idb` library. `replaceAll` empties and refills a store in **one** transaction - a clear followed by a separate write leaves a window in which the routine is empty, and a read landing in it renders the elder's cold-start screen |
| `js/store.js` | Reads used by every view (`getMedicines`, `getDoseLogForDate`, ...), the dose-log append-only rule, and a small set of cache-writer/outbox functions used only by `js/sync.js`. Also the organiser session (`getOrganiser`, `startOrganiser`, `setOrganiserStepDone`) and `getBoxSlots()`. `clearHouseholdData()` wipes everything but settings, on sign-out and disconnect |
| `js/auth.js` | Google sign-in, household create/resume, share-code rotation - simple-only |
| `js/supporter.js` | `loadRoutine`, `saveMedicine`, `replaceSchedules`, `saveSlots`, photo actions, `loadDoseLog`/`loadHistory`/`logDose`/`unlogSlot`, `nudge` - every one code-gated, no session |
| `js/supporter-sync.js` | `hydrate`, `ensureRange`, `refresh`, `startPolling`, `lastSync`. Fills the same cache `js/sync.js` does, but by polling - Realtime cannot reach a sessionless device. `refresh` returns whether anything actually changed, so a tick that changed nothing does not re-render the screen |
| `js/doses.js` | `setDose`, `logSlot`, `undoSlot`. The one place that knows the elder writes through the outbox and the supporter writes through RPCs |
| `js/sync.js` | Supabase Realtime subscription that mirrors a household's tables into the local cache, plus the dose-log offline outbox |
| `js/date.js` | `todayStr`, `addDays`, `daysBetween`, `dayOfWeek`, `monthGrid`, `formatTime`, `formatLong`, `msUntilTomorrow`. No UTC anywhere |
| `js/schedule.js` | `isDueOn`, `buildDay`, `dueOn`, `expectedFor`, `completionForDates`. The pure functions take plain arrays and can be called from the console; `isDueOn` is also ported into Postgres as `app.is_due` |
| `js/organiser.js` | `planWeek(startDate, {medicines, schedules, slots})` → `{ dates, boxSlots, steps, compartments, outOfBox }`. Pure, console-callable. `steps` and `compartments` are the same numbers pivoted for the two screens, computed together so they cannot disagree. `BOX_FORMS` is what may physically go in a tray |
| `js/views/organiser.js` | `#/organiser` - start screen, one step per medicine (`?step=N`), then the check screen (`?step=check`). Owns the wake lock, and the three sheets that belong to the flow (box compartments, out-of-the-box, one compartment) |
| `js/day-model.js` | `loadDay(date)` → `{ groups, states, loggedBy }`, then `describeSlot` / `describeDay` turn that into what every day screen renders: the medicines due, how many are marked, whether it is past due, the state tone, the status string, the collapsed medicine-name summary and the take-button label. **Four screens need exactly that set** - the elder's Today and slot detail, the helper's Today and day detail - and deriving it once is what stops two of them disagreeing while the same household looks at both |
| `js/marking.js` | The write side of the same thing: `mayMark`/`mayMarkSlot` (the helper's once-per-session confirmation, plus `onBehalfActive()` for their persistent chip), the per-dose write queue (`queueWrite`, `settled`), and `toastWithUndo`. It re-exports `doses` so a view imports one module to mark a dose |
| `js/photos.js` | `compress`, `objectUrl`/`release`, `blobToDataUrl`/`dataUrlToBlob` |
| `js/ui.js` | `el()` for DOM building and `screen()`/`mount()` for the shell, plus `confirmDialog`, `alertDialog`, `openSheet`, `openShareSheet`, `openPhotoViewer`, `busyOverlay`, `toast`, `closeOverlays`, `pickFile`, `pillTile`, `codeCard`, `loadingState`, `progressBar`, `applyTheme`, the state tones (`TONE`, `doseTone`, `paintTone`, `stateRing`), and `doseText`/`doseAmount` (a `doseQty` plus a `form` rendered as "2 tablets" or just "½") |
| `js/views/day.js` | One calendar day for the supporter: says which of editable / locked / future applies before showing anything, then a card per slot. Corrections open the same medicine sheet the rest of the app uses, so there is no second vocabulary for fixing yesterday |

## Conventions

- **One module owns the local cache.** Views call `store.*`, never `db.*`. `js/sync.js` is the one exception permitted to write through `store.*`'s cache-writer functions.
- **The supporter's cache is read-only.** Since v3 a supporter device does cache the routine and history (`js/supporter-sync.js`), so Today and Calendar can render. But supporter *writes* never touch the outbox - nothing there would flush it - they go out through `js/supporter.js` and are mirrored in afterwards. `js/doses.js` is the only module that knows this.
- **Writes go through `js/doses.js`, not `js/sync.js`.** A view that calls `sync.*` directly works on the elder's device and silently does nothing useful on the supporter's.
- **A view must check `isCurrent()` after every await, before touching the DOM.** The router passes it in and uses it to drop superseded renders. Skipping it reintroduces the two-copies-of-the-screen bug - see [architecture.md](architecture.md), "Rendering: one screen at a time".
- **Read the node you are replacing before you build its replacement,** and read `document.activeElement` before the swap, not after. Both mistakes fake success: the builder registers what it creates so a later lookup hands back the new detached node, and removing a focused element resets `activeElement` to `<body>` immediately. Each has cost a day once already.
- **No text outside `strings.js`.** Views reference `S.something`. This is what
  makes an Urdu translation a data change rather than a refactor. The one
  exception is the state *glyphs* - `✓ ○ ! - · ▣ ‹` - which are typographic
  marks rather than words and live with their tone in `ui.js`'s `TONE`; they do
  not translate, and keeping them beside the colour is what makes "colour is
  never alone" checkable in one place.
- **No HTML strings with data in them.** Everything goes through `el()` and `textContent`, so a medicine named `<img onerror=…>` is just a medicine with a silly name.
- **Views return their cleanup.** A view that creates photo object URLs returns a function; the router calls it before rendering the next screen.
- **Update in place, do not re-render.** After a write, replace the one node that changed. Rebuilding a whole screen re-reads the database, reloads photos and resets the scroll, which looks like the page refreshing.
- **`append()` tolerates null; `appendChild` throws.** Any builder that can
  return nothing - an empty section, an absent strip - must be added with
  `append()` from `js/ui.js`. This has broken a screen once already, and only
  in the case where the feature had nothing to show, which is the case
  fixtures habitually omit.
- **A new `medicines` column has seven homes**, and a missed one fails
  silently: the migration, `public.get_routine`, `public.upsert_medicine`,
  `app.compute_day`, `mapMedicine` in `js/sync.js`, the medicine form, and -
  if `supporter-photo` writes it - the column-level `service_role` grant.
- **A view renders exactly one `screen()`, and only `.screen-scroll` scrolls.**
  The shell is a fixed viewport column - `body` is `100dvh` with
  `overflow: hidden`, `#app` is a flex column, and the nav sits below it. A view
  that appends two roots, or puts its content outside the scroll region, breaks
  the whole thing quietly: the nav goes off-screen on a small phone instead of
  the content scrolling. This replaced a `--nav-h` token that every fit layout
  had to subtract by hand and that was wrong by 10px for a while.
- **The elder's type and touch floors are load-bearing**, not a style
  preference: 17px for anything you must read to act, 44px for anything you can
  tap, 54–64px for a primary action. Where a floor and a tidy single line
  conflict, the floor wins and the text wraps. The responsive rules in
  `css/app.css` §15 give up padding and gaps, never type.
- **Form controls need `min-width: 0`.** Their `min-width` defaults to `auto`,
  which is the control's intrinsic minimum - the width of a native date or time
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

Writes the four PNGs from scratch using only `zlib` and `struct` - no Pillow, no ImageMagick. Paths are relative to the script, so it runs from any checkout.

Credentials that are not safe to commit live **outside** the repository, in
`~/.medicine-tracker/`. `js/config.js` is committed on purpose - the anon key
and the VAPID public key are meant to be public and the deployed site needs
them - which is why `.gitignore` says so explicitly rather than listing it.

`apple-touch-icon.png` is a full opaque square because iOS composites onto black and applies its own corner mask. `favicon.svg` is not generated: it is hand-written to the same geometry, because a vector stays crisp at every tab-bar size and zoom level in under a kilobyte. `favicon-32.png` exists only for browsers that ignore SVG icons. If you change the mark, change both.
