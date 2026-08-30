# Medicine Tracker: Build Plan v3

Supersedes `medicine-tracker-spec.md` v1.0 and Build Plan v2. On approval this becomes the canonical spec in the repo; v1 and v2 are kept for reference.

> **Amended before build.** Five defects found in review, folded in below.
>
> - **§2.1** The shell is network first too. Cache first on `index.html` would pin the module graph, so fresh JS would never load.
> - **§2.1** Network first races a 2.5s timeout and only caches `res.ok`, so a flaky connection cannot hang the app and a 404 page cannot overwrite working JS.
> - **§5.2, §6** `daySnapshots` and `lockedThrough` are exported after all. Without them the elder's own backup silently loses frozen history and reopens locked days. `schemaVersion` is now 4.
> - **§6** Two validations before the confirmation dialog: every imported `slotId` must exist in the file's `slots`, and a file from a newer app version gets its own message.
> - **§6, §8** The two directions produce differently named files, and the picker declares `.json` explicitly for iOS Safari.
> - **§2.1** The worker fetches with `cache: 'no-cache'`. Found in testing: without it a static host answers 304, the browser rebuilds the response from its own HTTP cache, and network-first serves stale code while believing it hit the network.
> - **§4.1** Today no longer reacts to the clock, and medicine rows are compact. See the section for why.

---

## Context

Two people, two phones. An elder needs to remember which pills to take and when, and to check a photo of each pill when refilling a weekly organiser. A supporter (adult child) does all the setup on their own phone and sends the result as a file.

Everything runs in the browser off GitHub Pages. No backend, no accounts, no server database. All data lives on each device.

### What changed from v2

| Area | v2 | v3 |
|---|---|---|
| Reminders | ntfy scheduling, full implementation | **Cut from v1.** Moved to Future Steps |
| `refCode` | Pairing code carried in export | **Cut.** Its only job was deriving the ntfy topic |
| Skip | Per-medicine Skip toggle, status `taken` or `skipped` | **Cut.** Status is `taken` only. Done or not done |
| Supporter Today/Calendar | Present | **Cut.** With one-way flow they show an empty history |
| Snapshots | Written every time a date is first opened | **Written only on import**, for the days being locked |
| Sync direction | Merge implied round-tripping | **One-way only.** Supporter to elder |
| Unit tests | `node --test`, `test/` directory | **Cut.** No Node files, no `package.json`. Cases moved to the manual checklist |
| Service worker | Cache-first, versioned cache name | **Network-first for the shell, JS and CSS**, with a 2.5s timeout. No version to bump |

Everything else from v2 holds: append-only dose log, photo compression, one-form medicine plus schedule, relative paths, hash routing, 20px and 56px targets in simple mode.

---

## 1. Settled decisions

| Question | Decision |
|---|---|
| Framework | None. Plain HTML, CSS, JS. ES modules, no build step, no CDN, no `node_modules`, no `package.json` |
| Repo / URL | Repo `Medicine Tracker` to GitHub slug `Medicine-Tracker` to `https://umerbutt.github.io/Medicine-Tracker/` |
| Base path | Relative paths everywhere (`./sw.js`, `"start_url": "./"`). Nothing to configure |
| Routing | Hash routing (`#/today`, `#/calendar`, `#/medicines`, `#/settings`) |
| Responsive | Mobile first, identical behaviour at every width. Desktop is the same layout in a centred max-width column |
| Roles | Chosen on first run. Internally `simple` and `supporter`. Never labelled "elder" in the UI |
| Devices | Two phones, two installs. Data moves by file, one way |
| Mode switch | Open, in Settings. No PIN, no hidden gesture |
| Slots | Four built ins (morning, afternoon, evening, night) with editable times, plus supporter-defined custom slots |
| Per-medicine time | Supporter can override a slot's default time for one medicine |
| Logging | One large **Done** per slot. Tapping again is **Undo** |
| History | Month calendar, elder only, navigable by month and year, completion ring per day |
| Past-day editing | Allowed from the last import forward. Days on or before `lockedThrough` are read only. Future days are read only |
| Photos | Optional |
| Import | Merge, never replace. Dose history always survives |
| Export | Single `.json`, photos base64 inline. Different filename per direction, see §6 |
| Reminders | Not in v1 |
| Language | English only, all strings in one file for later Urdu |

### Naming

The UI never names the roles. First run asks *"Who uses this phone?"* with two answers: **"I take the medicines"** for `simple` mode, **"I help someone with their medicines"** for `supporter` mode.

---

## 2. Technical approach

No build step is the load-bearing decision. Plain ES modules served as static files means relative paths behave identically on `localhost:8000` and on GitHub Pages, deploy is a push to `main`, and there is no lockfile or CI.

Two deliberate consequences:

- **No `idb` library.** A roughly 70 line promise wrapper in `js/db.js`. The surface needed is small: open with upgrade, get, getAll, put, delete, getAllFromIndex.
- **No CSS framework.** A CDN stylesheet breaks offline use, and self-hosting one to override its 14px defaults for a 20px minimum interface is more work than writing the CSS. Hand-written, custom properties, roughly 500 lines.

### 2.1 Service worker

**Network first for the shell, JS and CSS. Cache first for icons and the manifest.**

```js
const TIMEOUT_MS = 2500;

function networkFirst(request) {
  return new Promise(resolve => {
    let settled = false;
    const fallback = () => {
      if (settled) return;
      settled = true;
      resolve(caches.match(request).then(hit => hit || Response.error()));
    };
    const timer = setTimeout(fallback, TIMEOUT_MS);

    // cache: 'no-cache' is load bearing. Without it the host answers the
    // revalidation with 304, the browser rebuilds the response from its own
    // HTTP cache, and this function serves stale code believing it went to
    // the network. Built from request.url because a navigation request cannot
    // be reconstructed directly.
    fetch(new Request(request.url, { cache: 'no-cache', credentials: 'same-origin' }))
      .then(res => {
        clearTimeout(timer);
        if (settled) return;
        // Only cache real successes, or a 404 page overwrites working JS.
        if (res.ok && res.type !== 'opaque') {
          caches.open(CACHE).then(c => c.put(request, res.clone())).catch(() => {});
          settled = true;
          resolve(res);
          return;
        }
        fallback();                       // prefer last known good over an error page
      }).catch(() => { clearTimeout(timer); fallback(); });
  });
}
```

Rationale: with no build step, nothing automatically changes `CACHE_VERSION` on deploy. A cache-first worker would keep serving old JavaScript indefinitely, with no error and no expiry, because the browser only re-installs the worker when `sw.js` itself changes byte for byte. Network first removes the manual step entirely. Online you always run current code, offline you fall back to cache and the app still works.

**The shell is in the network-first set, not the cache-first set.** `index.html` is the file that lists every module entry point. Serving it from cache pins the module graph, so adding a view or changing a script tag would never reach the device however fresh the individual JS files were, and checklist item 2 would fail for any change touching the shell.

**The 2.5s timeout is not optional.** On a weak mobile connection `fetch` can hang for 30 seconds or more without resolving or rejecting, and the default behaviour is a blank screen with a perfectly good cache sitting unused. The timeout resolves from cache and moves on; a late network response is discarded rather than racing the render.

Call `self.skipWaiting()` in `install` and `clients.claim()` in `activate`, otherwise a new worker waits for every window to close, which on a home screen PWA can take days.

**Show the app version in Settings** in both modes, so a stale install can be diagnosed over the phone.

### 2.2 Files

```
index.html                 single shell, all views mounted into it
manifest.webmanifest
sw.js                      network-first JS/CSS, cache-first shell
css/app.css
js/main.js                 boot: open db, ensure settings, route
js/db.js                   IndexedDB promise wrapper, schema, upgrade
js/store.js                typed CRUD per store, only module touching db.js
js/date.js                 local YYYY-MM-DD maths, no UTC, no Date arithmetic on timestamps
js/schedule.js             due-on computation, snapshot read/write
js/merge.js                import merge and conflict counting, pure function
js/photos.js               capture, canvas compress, objectURL lifecycle
js/backup.js               export and import file handling
js/router.js               hash router plus per-mode route guard
js/strings.js              every user-visible string
js/ui.js                   DOM helpers, sheet, dialog, toast
js/views/onboarding.js
js/views/today.js
js/views/calendar.js       simple mode only
js/views/medicines.js      supporter: list and archive
js/views/medicine-form.js  supporter: medicine plus schedule in ONE form
js/views/settings.js       both modes, different contents
icons/icon-192.png  icon-512.png  apple-touch-icon.png
README.md                  deploy steps, setup guide, known limits
```

Icons generated once by a throwaway Python script using stdlib `zlib` and `struct`, a flat rounded square with a pill glyph. iOS ignores manifest icons for home screen install, so `apple-touch-icon.png` is also declared in `index.html`.

---

## 3. Data model

Six object stores.

### `medicines`
```js
{ id, name, strength, dosage, form, notes, archived, createdAt }
```
`form`: tablet, capsule, liquid, drops, injection, inhaler, other. Never hard deleted, only archived.

### `photos`
```js
{ medicineId, blob }   // keyPath: medicineId
```
Optional. A medicine may have no row here.

### `schedules`
```js
{
  id, medicineId,
  slotId,                    // references settings.slots[].id
  time: "08:00" | null,      // null inherits the slot's default time
  frequency: {
    type: "daily" | "everyNDays" | "weekly",
    interval,                // everyNDays
    daysOfWeek: [0..6],      // weekly, 0 = Sunday
    anchorDate: "2026-09-01" // MANDATORY for everyNDays
  },
  active, createdAt
}
```
One row per medicine and slot pairing. Morning plus night is two rows. A medicine cannot be saved with zero schedules.

### `doseLog`
```js
{ id, medicineId, slotId, date: "2026-08-29", takenAt, status: "taken" }
```

**Append only with respect to schedule edits.** Editing, archiving or deleting a medicine or schedule must never touch an existing row. History records what happened, not what the current routine says should have happened.

**One deliberate exception:** an explicit Undo deletes the rows for that `(date, slotId)`, including rows created in an earlier session. That is a correction of a mis-tap, not a rewrite of history. Nothing else ever deletes from this store. Put this in a comment at the top of the store module, because it is the easiest thing in the build to get wrong.

### `daySnapshots`
```js
{
  date: "2026-08-29",        // keyPath
  slots: [ { slotId, label, time, medicines: [ { medicineId, name, strength, dosage } ] } ]
}
```

Written **only during import**, and only on the elder's device. See §5. Freezes what was expected on days whose schedule is about to change, so an updated routine does not rewrite last month's calendar rings. Included in export so a restore keeps the frozen history, but never merged in from a supporter file, since a supporter device has no snapshots to send.

### `settings` (single row, key `"app"`)
```js
{
  key: "app",
  role: "simple" | "supporter" | null,
  slots: [ { id, label, time: "08:00", order, builtIn } ],
  lockedThrough: "2026-08-28" | null,   // last date frozen by an import
  lastImportAt,
  storagePersisted,
  createdAt
}
```
`role` is local to the device and is **never** overwritten by an import.

---

## 4. Screens

### 4.1 Simple mode

Bottom nav, three items, each at least 56px: **Today · Calendar · Settings**.

**Today** (default route `#/today`)
- The whole day, grouped by slot, in fixed chronological order: morning at the top, night at the bottom, all day long. Nothing is **ever** hidden - hiding a passed slot makes a missed dose unrecoverable.
- **Nothing reacts to the clock.** No slot promotes itself at its own hour, nothing dims once its time has passed, nothing reorders. A screen that rearranges itself through the day is disorienting for the person who has to trust it; the only state worth showing is what they marked themselves.
- Medicine rows are **compact**: a 56px row with a 48px thumbnail, name and strength on one line, dosage and notes on the next, both truncated rather than wrapped. A slot commonly holds five or six medicines, and a taller card pushes the Done button - the one control that matters - below the fold. The full text is on the photo screen, one tap away.
- One large **Done** button per slot. Once complete it becomes **Undo** and the slot shows a tick. Marking a slot updates **only that slot**: no full re-render, so the scroll position holds and no photo reloads.
- Tapping a card opens the photo full screen with name and strength overlaid. Tap anywhere or press back to close. This is the pill identification feature and the reason the app exists, so the photo gets the entire viewport.

**Calendar** (`#/calendar`)
- Month grid. Chevrons for previous and next month. Tapping the month title opens a month and year picker so navigating a year back is not 24 taps.
- Each day cell shows a ring: full when every expected dose is logged, a partial arc proportional to logged over expected, hollow when nothing is logged, and nothing at all for days with no expected doses. Today is outlined.
- Tapping a day opens a sheet listing that day's slots and medicines with the same Done and Undo controls as Today.
- Days on or before `lockedThrough` open read only with a plain note. Future days open read only with "Not yet".
- No percentages, no streaks, no scores anywhere. This is a memory aid and must never read as medical judgement.

**Settings** (`#/settings`), deliberately short
- **Get my medicines from my helper**, file picker, merge, see §5
- **Save a copy of my information** (export), the elder's own safety net
- Change mode
- App version

### 4.2 Supporter mode

Top tabs: **Medicines · Settings**. Normal density, 16px and up, forms are fine here.

There is no Today or Calendar in supporter mode. Data flows one way, so the supporter's device has no dose history to display.

**Medicines**, list showing name, strength, and the slots each is scheduled in. Add, edit, archive, show-archived toggle.

**Add or edit medicine**, one form, one save. Name, strength, dosage, form, notes, photo (optional), **and the schedules**: one or more rows of slot, optional time override, and frequency. Save is blocked with a clear message if there are zero schedules. A medicine that exists but is scheduled nowhere is a dead state the supporter will never notice.

**Settings**
- **Slot times**, edit the four built-in times, add, rename, retime and remove custom slots. Removing a slot that has schedules warns and deactivates those schedules rather than deleting log rows.
- **Send medicines to the person I help** (export). This is the hand-off file.
- Import, for restoring the supporter's own device from a backup.
- Change mode
- App version

### 4.3 Design targets

Simple mode: body text at least 20px, tap targets at least 56px, contrast at least 7:1, no thin weights, no grey on grey, no icon-only controls without labels. Supporter mode: at least 16px, at least 44px. Both honour `prefers-reduced-motion` and scale with OS text size, so rem-based sizing and never `px` font sizes on text.

---

## 5. Schedule, snapshots and locking

### 5.1 Computation (`js/schedule.js`)

```js
isDueOn(schedule, dateStr)                     // frequency evaluation
dueOn(dateStr, medicines, schedules, slots)    // -> [{slotId, label, time, medicines:[...]}] sorted by time
expectedFor(dateStr)                           // snapshot if one exists, else dueOn(...)
completionFor(dateStr)                         // { expected, taken } for calendar rings
```

Rules:
- All date maths on local `YYYY-MM-DD` strings via `js/date.js`. Never UTC timestamps, never `new Date(str)` on a bare date string, or you get off-by-one-day bugs.
- `daily` is always due.
- `everyNDays` is due when `daysBetween(anchorDate, date) % interval === 0`, and only on or after `anchorDate`.
- `weekly` is due when `daysOfWeek.includes(dayOfWeek(date))`.
- Archived medicines and inactive schedules are excluded from `dueOn` but remain resolvable by id, so old snapshots and log rows still render a name.

### 5.2 Locking on import

This replaces v2's per-open snapshot writing and is much smaller. On the elder's device, when an import is confirmed and **before** anything is merged:

1. If `lockedThrough` is null and there is no dose history, skip to step 4. There is nothing worth freezing on a first import.
2. For every date from `lockedThrough + 1` (or the earliest dose log date, whichever is later) up to **yesterday**, compute `dueOn(date)` using the **current, pre-import** schedules and write it to `daySnapshots`.
3. Set `lockedThrough` to yesterday.
4. Perform the merge. Set `lastImportAt`.

Consequences, both intended:
- Days on or before `lockedThrough` are read only and their calendar rings are frozen against what was actually expected at the time.
- Past-day editing works only back to the last import. Anything older cannot be corrected.
- If the elder never imports again, no days are ever locked and the calendar computes from the current schedule. That is correct, because nothing changed.

### 5.3 Snapshots and the elder's own backup

Snapshots and `lockedThrough` are written only by the elder's device, but they **are** included in export, because §4.1 offers the elder's export as their safety net and §7 makes it the mitigation for iOS evicting IndexedDB. Excluding them would mean a restore brings back every dose row while silently recomputing every frozen day against the current schedule, and a null `lockedThrough` would reopen months of locked days for editing. The backup would appear to work and quietly lose the thing snapshots exist to protect.

On import, `daySnapshots` merge by date with **local winning** any conflict, because a local snapshot reflects the day as that device actually saw it. `lockedThrough` takes the later of the local and file values, then §5.2 advances it to yesterday as usual. A supporter file carries neither field, so nothing changes in the normal hand-off path.

---

## 6. Export and import

### Export

One button, one file:

- Supporter mode writes `medtrack-medicines-YYYY-MM-DD.json`. This is the hand-off file.
- Simple mode writes `medtrack-mycopy-YYYY-MM-DD.json`. This is the elder's own backup.

**The two names must differ.** On any day the elder exports their own copy and also receives one from their helper, a single shared name leaves two indistinguishable files in the iOS Files app and a 50/50 chance of importing the wrong one.

```js
{
  schemaVersion: 4,
  exportedAt,
  slots: [...],
  medicines: [...],
  schedules: [...],
  doseLog: [...],         // empty from supporter mode
  daySnapshots: [...],    // empty from supporter mode, see §5.3
  lockedThrough: null,    // null from supporter mode
  photos: [ { medicineId, dataUrl: "data:image/jpeg;base64,..." } ]
}
```

Roughly 1 to 2 MB with 15 photos, which sends fine over WhatsApp or email. Warn above 8 MB. `role` is never exported.

One shape serves both directions. A supporter export simply has an empty `doseLog`, empty `daySnapshots` and a null `lockedThrough`.

### Import: merge, never replace

The supporter is the source of truth for the routine. The elder's device is the source of truth for what was actually taken.

| Store | Rule |
|---|---|
| `medicines` | By `id`. New adds. Same id with changed fields takes the file's version. Archived in the file archives locally |
| `photos` | Follow the medicine. A photo in the file replaces the local one. A medicine with no photo in the file keeps its local photo |
| `schedules` | By `id`, file wins. Local-only schedules, meaning the supporter deleted them, are set `active: false` and never deleted |
| `doseLog` | **Union by id. Never overwritten, never deleted.** This is what makes merge safe |
| `slots` | Replaced from the file |
| `daySnapshots` | Union by date, **local wins** any conflict. Empty from a supporter file, so normally untouched. See §5.3 |
| `role` | Never touched |
| `lockedThrough` | The later of local and file, then set to yesterday as part of §5.2 |

### Validation, before the dialog

Three checks, each with its own readable message and none of them a console error:

1. **Shape.** Malformed JSON or a missing required key is rejected as "This file does not look like a medicine list."
2. **Version too new.** A `schemaVersion` higher than the app's means this install is stale, not that the file is bad. Say so and say what fixes it: *"Your app needs updating. Open it while connected to the internet, then try again."* With a network-first service worker that is literally the fix.
3. **Slot references.** Every imported schedule's `slotId` must exist in the file's `slots`. `slots` is replaced wholesale, so an orphan schedule is scheduled into a slot that does not exist: it renders on no screen, appears in no calendar day, and neither user has any way to see that a medicine has gone missing. Reject the file rather than import a silently broken routine.

Before anything is written, a confirmation dialog states the effect in plain language, sized for simple mode:

> **New medicine list from your helper**
> 3 new medicines · 1 changed · 1 removed
> Your record of what you have taken will be kept.
> [ Use the new list ] [ Keep what I have ]

Written in a single transaction so a half-merged database is impossible.

The file picker uses `accept=".json,application/json"`. **The extension must be listed explicitly** — iOS Safari greys out `.json` files, leaving the elder staring at an unselectable filename, when only the MIME type is given.

`js/merge.js` is a pure function over plain arrays with no database access, so the table above can be reasoned about and exercised directly from the browser console.

---

## 7. Photos

1. Capture with `<input type="file" accept="image/*" capture="environment">`.
2. **Compress before storing.** Draw to canvas, longest edge 800px, JPEG quality 0.7, roughly 60 to 120 KB.
3. Store the `Blob`. **Never localStorage.** It is about 5MB, holds strings only, adds 33 percent base64 overhead, and fails as a thrown quota exception mid-save.
4. Render with `URL.createObjectURL`, revoke on unmount. A single helper in `js/photos.js` owns every URL so nothing leaks.
5. Call `navigator.storage.persist()` on first run.

**iOS caveat for the README.** Safari does not grant persistent storage the way Chrome does and can evict IndexedDB for a web app that goes unused for an extended period. The mitigation is not technical, it is the export file. Tell the supporter to keep the last backup, and have Settings suggest exporting after any change.

---

## 8. Setup and hand-off

Remote, no in-person step required, and written out as a numbered guide the supporter can read aloud over the phone. **The guide itself lives in [flow.md](flow.md)** — this section is only the constraints it has to satisfy.

- **Say plainly, at the top:** v1 solves pill identification and record keeping. It does **not** remind anybody of anything. There are no notifications, and nothing happens on the phone unless someone opens the app. The person taking the medicines needs an existing habit, or an alarm in the phone's own Clock app.
- **iOS has no install prompt**, so Add to Home Screen must be walked through explicitly, with the exact menu names, for both phones.
- **Name the file in the instructions.** The supporter sends `medtrack-medicines-<date>.json`; the other phone's own backup is `medtrack-mycopy-<date>.json`. The two must be distinguishable on a day both exist.
- **Cover the error messages**, not just the happy path. A file that cannot be selected in the iOS picker, or a "your app needs updating" message, is where a remote setup actually stalls.

---

## 9. Out of scope for v1

Accounts, login, cloud sync. Reminders and notifications, see §11. Multiple patients per install. Skip and partial-dose logging. Refill and stock tracking. Drug interaction or any clinical logic. Adherence scores, streaks, gamification. PRN and as-needed medicines. Multi-language UI, strings file only. Editing a logged dose's timestamp. Two-way sync from elder back to supporter. Supporter-side history. Automated tests.

---

## 10. Build order and verification

### Build order

1. `index.html`, manifest, service worker, icons, hash router, relative paths. **Verify install and offline reload before anything else.**
2. `js/db.js`, `js/store.js`, `js/date.js`. Schema and upgrade path.
3. `js/schedule.js`. Verify the date cases in the checklist below before building any UI on top of it.
4. Onboarding, then the supporter medicine and schedule form with photo capture and compression.
5. Slot times settings.
6. Today screen, dose logging, Done and Undo, photo full screen.
7. Export, import, merge, and the §5.2 locking step.
8. Calendar month view and day sheet.
9. Simple-mode polish: type scale, contrast, target sizes, responsive desktop column.

### Local run

```bash
python3 -m http.server 8000
```

Then `http://localhost:8000/`. Service worker and IndexedDB both work on `localhost` without HTTPS.

### Manual checklist

The build is done when all of these pass.

**Shell**
1. Installed to a home screen from `umerbutt.github.io/Medicine-Tracker/`, the app opens standalone and the service worker registers.
2. Change one line in a JS file, push, reopen the app on the phone. The change is live without clearing anything.
3. Turn networking off entirely. The app opens, loads, and logs a dose with nothing thrown to the console.
4. Settings shows an app version in both modes.

**Data**
5. Add a medicine with a photo, fully close the browser, reopen. Medicine and photo intact.
6. Fifteen medicines with photos stored with no quota error.
7. A medicine with no photo saves and renders a placeholder.

**Schedule maths.** These replace the unit tests, so click through each one.
8. `everyNDays` interval 2, anchored today: appears today, not tomorrow, appears in two days.
9. `everyNDays` anchored on the 30th of a month, interval 3: correct across the month boundary into a 31-day and a 28-day month.
10. `everyNDays` anchored in late December: correct across the year boundary.
11. `weekly` on Saturday and Sunday: renders on both, across the week wrap.
12. A date before `anchorDate` shows nothing.
13. An archived medicine disappears from Today but its name still renders in past calendar days.

**Logging**
14. A slot whose time has passed is still visible on Today and can still be marked Done.
15. Tap Done, then Undo. The slot returns to incomplete and its rows are gone. Rows for other slots and other days are untouched.
16. Close the app, reopen, tap Undo on a slot completed yesterday within the editable window. Rows from the earlier session are removed.
17. Archive a medicine and delete a schedule. Every pre-existing `doseLog` row is byte identical.

**Calendar**
18. Navigate back a year and forward again. Tap a past day inside the editable window, mark a dose, see the ring update.
19. A future day is read only.
20. A day on or before `lockedThrough` is read only and shows the frozen note.

**Hand-off**
21. Export in supporter mode, import in simple mode on a second device. Medicines, photos, schedules and slots all arrive. The elder's existing dose history is still there. The confirmation dialog stated the counts correctly.
22. Import the same file twice. No duplicates.
23. Change a schedule in supporter mode, export, import on the elder's device. Calendar rings for days before the import are unchanged. Days after reflect the new schedule.

24. Import a file whose `slotId` values do not match its `slots`, and one with `schemaVersion: 99`. Both are refused with their own readable message and nothing is written.
25. Elder exports, then imports that file onto a fresh install. Dose history, frozen calendar rings and the read-only window are all preserved.
26. The two modes produce differently named files on the same day.

**Interface**
27. Every tap target in simple mode is at least 56px and every text element at least 20px, verified at 375px, 768px and 1280px widths.

**Shell, amended**
28. Change a line in `index.html`, redeploy, reopen on the phone. The change is live without clearing anything.
29. Set DevTools to a throttled or offline profile mid-load. The app falls back to cache within about three seconds rather than hanging on a blank screen.

---

## 11. Future steps

Ordered roughly by value.

### 11.1 Reminders

Deferred because there was no delivery path. **ntfy has no way to reach a phone without the ntfy app installed on that phone.** On iOS it reaches the device only through the ntfy iOS app via APNS. Posting to a topic with an `X-At` header is visible in ntfy's web UI and reaches nobody otherwise. Any future work has to start by choosing one of:

- The elder installs the ntfy app during setup, and the supporter walks them through subscribing. Keeps the rest of the architecture.
- Web push with VAPID keys, which requires a server to hold the private key and a scheduler such as a GitHub Actions cron or a Cloudflare Worker cron. Both are free. **iOS 16.4 and later supports web push for a PWA installed to the home screen**, which this app already is, so this route needs no extra app on the phone at all. It is probably the best option and the reason to keep the install step in §8 mandatory rather than optional.
- SMS or WhatsApp via a paid API and a server.

If ntfy is chosen, three bugs were already identified and should be built in from the start rather than rediscovered:

1. **Only `simple` mode may top up the queue.** The topic is shared and dedup sets are device local, so a supporter opening their app would post duplicates of what the elder's device already posted.
2. **The dedup key must be `date|slotId|time`, not `date|slotId`.** Otherwise changing a slot time is deduped away, no new reminder is posted, and the old one still fires at the old time.
3. **Queue 24 to 36 hours, not the 72 that ntfy allows.** There is no ntfy API to cancel a scheduled message, so queue depth is exactly how long a stale reminder outlives a schedule edit.

Other constraints to carry forward: max scheduled delay 3 days, minimum 10 seconds. Never put medicine names in the notification body, because ntfy.sh topics are unauthenticated and anyone who knows the topic can read it. If the app is not opened for 36 hours the queue runs dry and reminders stop until it is reopened.

A pairing code, dropped from v1 as `refCode`, would return here to derive the topic.

### 11.2 Two-way sync

Elder exports back to the supporter so the supporter can see adherence. This is what made snapshots complicated in v2 and should be designed carefully:

- Snapshots are device-local truth but `doseLog` would be merged across devices. Pairing the supporter's snapshots with the elder's dose rows produces wrong ratios, for example 2 of 5 when the elder's device correctly recorded 3 of 3.
- Simplest fix: only the elder's device ever writes snapshots, and a reverse import brings the snapshots along with the log so the supporter renders the elder's expectations rather than its own.

### 11.3 Everything else

- Skip and partial-dose logging, with `status: "skipped"` and a per-medicine control on Today.
- Urdu, using the existing `js/strings.js`.
- PRN and as-needed medicines with no fixed schedule.
- A searchable list of Pakistani brand names for autocomplete, scraped from the DRAP registered drugs list into a static JSON file. This is the thing that would make the app meaningfully local rather than generic.
- Refill and stock tracking.
- Multiple patients per supporter install.
- Editing a logged dose's timestamp.
- Automated tests, browser-based rather than Node, if the schedule logic grows.
