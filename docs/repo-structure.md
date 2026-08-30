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
│   ├── supporter.js           code-gated Supabase calls for a supporter device, no local cache
│   ├── sync.js                simple-only: Realtime mirror into the local cache, dose-log offline outbox
│   ├── push.js                simple-only: Web Push subscribe/unsubscribe
│   ├── db.js                  IndexedDB promise wrapper, schema, upgrade
│   ├── store.js               typed access to the local cache; the only module that touches db.js
│   ├── date.js                local YYYY-MM-DD maths
│   ├── schedule.js            what is due on a date; snapshots; calendar counts
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
│       ├── medicines.js       supporter: the medicine list, fetched live via the share code
│       ├── medicine-form.js   supporter: medicine + schedules in one form
│       └── settings.js        both modes, plus the slot-times screen
│
├── supabase/
│   ├── README.md               one-time backend setup steps
│   ├── migrations/0001_init.sql   tables, RLS, the code-gated function surface, freeze + reminder jobs
│   └── functions/
│       ├── send-reminders/    Edge Function: Web Push delivery, cron-triggered
│       └── supporter-photo/   Edge Function: photo upload/delete/signed-URL for code-gated devices
│
├── icons/
│   ├── icon-192.png  icon-512.png  apple-touch-icon.png
│   └── make-icons.py          regenerates the three PNGs, stdlib only
│
└── docs/
    ├── architecture.md
    ├── repo-structure.md
    ├── ui.md
    ├── flow.md
    ├── medicine-tracker-plan-v3.md    the original local-only build spec, superseded
    └── next-steps.md                  everything deferred (reminders and two-way sync are now done)
```

## What each module is responsible for

| File | Responsibility |
|---|---|
| `js/db.js` | `open`, `get`, `getAll`, `getAllFromIndex`, `put`, `putMany`, `del`, `delMany`, `clear`, `uuid`. Stands in for the `idb` library |
| `js/store.js` | Reads used by every view (`getMedicines`, `getDoseLogForDate`, ...), the dose-log append-only rule, and a small set of cache-writer/outbox functions used only by `js/sync.js` |
| `js/auth.js` | Google sign-in, household create/resume, share-code rotation — simple-only |
| `js/supporter.js` | `loadRoutine`, `saveMedicine`, `replaceSchedules`, `saveSlots`, `uploadPhoto`/`deletePhoto`/`getPhotoUrl` — every one code-gated, no session |
| `js/sync.js` | Supabase Realtime subscription that mirrors a household's tables into the local cache, plus the dose-log offline outbox (`logSlot`/`undoSlot`) |
| `js/date.js` | `todayStr`, `addDays`, `daysBetween`, `dayOfWeek`, `monthGrid`, `formatTime`, `formatLong`. No UTC anywhere |
| `js/schedule.js` | `isDueOn`, `buildDay`, `dueOn`, `expectedFor`, `completionForDates`. The pure functions take plain arrays and can be called from the console; `isDueOn` is also ported into Postgres as `app.is_due` |
| `js/photos.js` | `compress`, `objectUrl`/`release`, `blobToDataUrl`/`dataUrlToBlob` |
| `js/ui.js` | `el()` for DOM building, plus `confirmDialog`, `alertDialog`, `openSheet`, `openPhotoViewer`, `toast`, `pickFile` |
| `js/views/day.js` | The shared day renderer, so a past day is corrected with the same controls as today |

## Conventions

- **One module owns the local cache.** Views call `store.*`, never `db.*`. `js/sync.js` is the one exception permitted to write through `store.*`'s cache-writer functions.
- **A supporter device has no local cache.** Every supporter screen calls `js/supporter.js` live, on every load — see `docs/architecture.md`.
- **No text outside `strings.js`.** Views reference `S.something`. This is what makes an Urdu translation a data change rather than a refactor.
- **No HTML strings with data in them.** Everything goes through `el()` and `textContent`, so a medicine named `<img onerror=…>` is just a medicine with a silly name.
- **Views return their cleanup.** A view that creates photo object URLs returns a function; the router calls it before rendering the next screen.
- **Update in place, do not re-render.** After a write, replace the one node that changed. Rebuilding a whole screen re-reads the database, reloads photos and resets the scroll, which looks like the page refreshing.
- **Comments explain why, not what.** The ones worth reading are on the append-only rule, the service worker's `no-cache`, and the two-clock freeze design in `supabase/migrations/0001_init.sql`.

## Regenerating the icons

```bash
python3 icons/make-icons.py
```

Writes the three PNGs from scratch using only `zlib` and `struct` — no Pillow, no ImageMagick. `apple-touch-icon.png` is a full opaque square because iOS composites onto black and applies its own corner mask.
