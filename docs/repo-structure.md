# Repo structure

Roughly 4,000 lines total. No dependencies, no build output, nothing generated except the icons.

```
Medicine Tracker/
├── index.html                 app shell: one <main>, an overlay host, a nav
├── manifest.webmanifest       PWA manifest, all paths relative
├── sw.js                      service worker
├── README.md
│
├── css/
│   └── app.css                everything, two densities switched by a body class
│
├── js/
│   ├── main.js                boot, route registration, navigation
│   ├── router.js              hash router with a per-role route guard
│   ├── db.js                  IndexedDB promise wrapper, schema, upgrade
│   ├── store.js               typed CRUD; the only module that touches db.js
│   ├── date.js                local YYYY-MM-DD maths
│   ├── schedule.js            what is due on a date; snapshots; calendar counts
│   ├── merge.js               import validation and merge rules, pure functions
│   ├── backup.js              export and import orchestration
│   ├── photos.js              capture, compression, object-URL lifetime
│   ├── strings.js             every user-visible string, and APP_VERSION
│   ├── ui.js                  DOM helper, dialog, sheet, toast, photo viewer
│   └── views/
│       ├── onboarding.js      "Who uses this phone?"
│       ├── today.js           the Today screen
│       ├── day.js             one day's slots — shared by Today and Calendar
│       ├── calendar.js        month grid, rings, day sheet
│       ├── medicines.js       supporter: the medicine list
│       ├── medicine-form.js   supporter: medicine + schedules in one form
│       └── settings.js        both modes, plus the slot-times screen
│
├── icons/
│   ├── icon-192.png  icon-512.png  apple-touch-icon.png
│   └── make-icons.py          regenerates the three PNGs, stdlib only
│
└── docs/
    ├── architecture.md
    ├── repo-structure.md
    ├── ui.md
    ├── medicine-tracker-plan-v3.md    the build spec
    └── next-steps.md                  everything deferred
```

## What each module is responsible for

| File | Responsibility |
|---|---|
| `js/db.js` | `open`, `get`, `getAll`, `getAllFromIndex`, `put`, `putMany`, `del`, `transaction`, `uuid`. Stands in for the `idb` library |
| `js/store.js` | One function per meaningful operation: `saveMedicine`, `logSlot`, `undoSlot`, `applyImport`. Holds the append-only rule in a header comment |
| `js/date.js` | `todayStr`, `addDays`, `daysBetween`, `dayOfWeek`, `monthGrid`, `formatTime`. No UTC anywhere |
| `js/schedule.js` | `isDueOn`, `buildDay`, `dueOn`, `expectedFor`, `completionForDates`. The pure functions take plain arrays and can be called from the console |
| `js/merge.js` | `validateFile`, `summarize`, `plan`. No database access at all |
| `js/backup.js` | Builds the export file, inspects an import, freezes past days, calls `store.applyImport` |
| `js/photos.js` | `compress`, `objectUrl`/`release`, `blobToDataUrl`/`dataUrlToBlob` |
| `js/ui.js` | `el()` for DOM building, plus `confirmDialog`, `alertDialog`, `openSheet`, `openPhotoViewer`, `toast`, `pickFile` |
| `js/views/day.js` | The shared day renderer, so a past day is corrected with the same controls as today |

## Conventions

- **One module owns the database.** Views call `store.*`, never `db.*`.
- **No text outside `strings.js`.** Views reference `S.something`. This is what makes an Urdu translation a data change rather than a refactor.
- **No HTML strings with data in them.** Everything goes through `el()` and `textContent`, so a medicine named `<img onerror=…>` is just a medicine with a silly name.
- **Views return their cleanup.** A view that creates photo object URLs returns a function; the router calls it before rendering the next screen.
- **Update in place, do not re-render.** After a write, replace the one node that changed. Rebuilding a whole screen re-reads the database, reloads photos and resets the scroll, which looks like the page refreshing.
- **Comments explain why, not what.** The ones worth reading are on the append-only rule, the service worker's `no-cache`, and the import-time freeze.

## Regenerating the icons

```bash
python3 icons/make-icons.py
```

Writes the three PNGs from scratch using only `zlib` and `struct` — no Pillow, no ImageMagick. `apple-touch-icon.png` is a full opaque square because iOS composites onto black and applies its own corner mask.
