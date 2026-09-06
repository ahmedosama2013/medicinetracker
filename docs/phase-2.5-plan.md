# Phase 2.5 — Stability

> **Done.** All nineteen items shipped, in the seven commits listed under
> [Order of work](#order-of-work). What the plan got wrong, and what the work
> turned up that the review had missed, is recorded in
> [What actually happened](#what-actually-happened) at the end.

Unplanned. It sits between Phase 2 and Phase 3 in [v3-plan.md](v3-plan.md), and
it exists because the September review ([review-2026-09.md](review-2026-09.md))
found that the app can render the same screen twice, can lose a dose write to a
race, and can spend the morning showing yesterday.

Items are numbered `S1`–`S19` rather than continuing `18…`, because Phase 3
already owns those numbers.

## Why before Phase 3

Organiser mode is the most stateful screen in the product: a week of medicines,
a wake lock, a tray being filled over several minutes with the app in the
foreground the whole time. Building it on a router that can render twice, and on
an outbox where two flushes can land out of order, means every organiser bug
arrives entangled with an infrastructure bug. Phase 2.5 is the cheapest it will
ever be to fix these — there are two screens using the day renderer today, and
Phase 3 adds a third that never leaves the foreground.

The one thing this phase must not do is grow. Everything here is a fix to
something already built. No new features, no new tables, no new screens.

---

## S1–S3: the render pipeline

The core bug and the two things that make it fire.

### S1. Render tokens in `js/router.js` — done

`renderRoute()` is async, has no guard, and every view is shaped
`clear(app)` → `await` → `appendChild`. Two overlapping renders append two
copies of the same screen.

Add a module-level generation counter. `renderRoute` increments it on entry and
captures the value; a superseded render is abandoned before it touches the DOM.
Abandoned, not queued — the newer render is by definition rendering newer data,
so finishing the older one is pure waste.

Views also need this available to them, because the damage happens *inside* a
view (`todayView` clears, awaits, appends). Two options:

- **(a)** Views build into a detached fragment and the router swaps it in. Clean,
  and makes the whole class of bug unrepresentable — but it is a rewrite of every
  view's structure, and `today.js` and `calendar.js` both re-`draw()` themselves
  in place from event handlers, which the fragment model has to keep working.
- **(b)** The router passes a `isCurrent()` predicate into the view, and each
  view checks it after every await before appending.

**Take (b).** It is smaller, it does not touch the in-place redraw paths that
`day.js` and `calendar.js` deliberately rely on, and it can be applied one view
at a time. (a) is the better long-term shape and should be revisited if a fourth
screen appears; note it in `architecture.md` rather than doing it now.

*Shipped as (b), plus a cheap half of (a) where it cost nothing:* Today and the
calendar now build their content detached and clear only once they have all of
it. That is not the full fragment model — the views still own their own DOM —
but it removes the window rather than only guarding it, and it means the person
never sees a bare heading with the day missing underneath.

Also: wrap `route.view()` in a try/catch. Right now a view that throws — see
`slotsView` in S11 — rejects into nothing and leaves the person on the previous
screen with no explanation.

### S2. Stop realtime from re-rendering what the screen already did — done

`js/views/day.js` swaps exactly one slot node on a dose change and its comment
says why: a full re-render "re-reads the database, reloads every photo and jumps
the scroll position". Then `js/sync.js` subscribes to `dose_log` and calls
`refresh()` on every change — including the echo of the write just made on this
device. The careful update is undone by the thing it exists to avoid, and five
Done-button rows produce five refreshes.

The mirror still has to run — the local cache must absorb the row. What stops is
the `refresh()`.

Suppress by row id: `handleDoseChange` skips the `refresh()` when the changed row
is one this device just wrote. The outbox already holds those ids, but it deletes
them on flush, so keep a small `Set` of recently-written ids in `sync.js` with a
short expiry (a few seconds is enough; the echo arrives in tens of milliseconds).

Then coalesce what is left. Several refetch triggers arriving together — a
supporter saving a medicine fires `medicines`, `schedules` and `slots` — should
produce one refetch and one refresh. A trailing debounce of ~150ms on both
`refetchRoutine` and `refresh` is enough, and is a smaller change than making
each handler smart.

*Risk:* over-suppressing, so a genuine change from the other device is dropped.
Guard against it by keying strictly on row id and expiring aggressively — a
missed refresh costs one stale screen until the next event; a missed *mirror*
would cost data, and the mirror is not being touched.

### S3. `db.replaceAll()` — one transaction — done

`store.replaceMedicinesCache()` is `db.clear()` then `db.putMany()`, two separate
IndexedDB transactions. A read between them sees zero medicines, and on the
elder's Today "zero medicines" is not an empty list — it is the cold-start screen
with their share code on it.

Add `db.replaceAll(store, values)` doing both in one `readwrite` transaction, and
point `replaceMedicinesCache` and `replaceSchedulesCache` at it.

This is worth doing even after S1 and S2 reduce how often refetches overlap with
renders: the window is real regardless of concurrency, because a render triggered
by anything at all can land in it.

---

## S4–S5: writes

### S4. `flushOutbox()` re-entrancy guard — done

Every `setDose` / `logSlot` / `undoSlot` calls `flushOutbox()` without awaiting.
Three fast taps start three flushes, each holding a different snapshot of the
payload, racing to the network. Whichever request lands last wins, which is not
necessarily the one the person tapped last.

The queue itself is already correct — one item per
`dose:date:slot:medicine`, holding the final state (migration `0005`'s header
explains why). The bug is entirely in there being more than one flusher.

A module-level `flushing` promise plus a `dirty` flag: if a flush is in progress,
set `dirty` and return; when it finishes, re-run once if `dirty`. Serial by
construction, and it collapses a burst of taps into one flush that reads the
already-coalesced final state.

### S5. Optimistic state in `cycleDose` — done

`cycleDose()` computes the next state from `stateByKey`, which is only updated
after the write resolves. A second tap arriving first reads the stale state and
computes the same "next", so the tap is silently swallowed. The button is never
disabled and shows nothing while in flight.

Write to `stateByKey` and redraw *before* awaiting, then roll back and toast on
failure. This fixes the swallowed tap and removes the perceptible lag on a slow
connection at the same time — which matters more on the supporter's side, where
`doses.setDose` goes straight out over the network with no outbox behind it.

The rollback path is the part to get right. It has to restore the previous state,
redraw, *and* recompute the collapse decision, because a failed write may have
been the one that resolved the slot.

*Note:* the whole-slot Done button already disables itself and already reverts on
failure. Do not make the per-medicine target work differently for no reason —
match its error behaviour.

---

## S6–S7: time and connection

### S6. Midnight rollover — done

`todayView` computes `const date = todayStr()` once at mount. Nothing re-runs it.
An installed PWA left on Today overnight shows yesterday in the morning, and
every dose marked writes to yesterday's `local_date`.

The consequence is worse than a wrong heading. If the nightly freeze has advanced
`locked_through` past that date, `dose_insert` rejects the write, the outbox's
catch treats a rejection identically to being offline, and it retries forever.
The person sees a tick that never syncs and has no way to find out why.

Two pieces:

1. **A rollover trigger.** A timer to the next local midnight plus a
   `visibilitychange` / `focus` handler, in `js/main.js` so both roles get it.
   On fire, if `todayStr()` has changed, re-render.
2. **`calendar.js` recomputes `today` and `locked` on draw**, not once per mount.
   `dayState()` closes over both, so a calendar left open overnight will also let
   someone edit a day that is no longer today.

While here: `day.js`'s `nowSlotId` is computed once per render too. It does not
need a timer of its own — the rollover trigger and ordinary navigation are
frequent enough for a passive badge — but the reason should be written down so
nobody adds one later.

*Also consider:* the outbox should distinguish "rejected" from "offline" rather
than retrying a permanent failure forever. That is a bigger change than this
phase wants, so the minimum here is: don't generate the bad write. Log the
rejection distinctly and open it as its own item if it shows up in practice.

### S7. Backfill on reconnect — done

`refetchHistory()` runs once, at boot. The Supabase client reconnects the
websocket on its own, but events missed while the phone slept are never replayed,
and `.subscribe()` is called with no status callback, so a channel that fails to
rejoin is invisible.

Refetch on the `SUBSCRIBED` status callback and on becoming visible. The elder's
device should also carry the freshness line the supporter's Today already has —
the reasoning in `js/views/today.js` about polled data that presents itself as
live applies just as well to a socket that quietly died.

---

## S8–S13: feedback

Every one of these is the same shape: something takes a second or more over a
network and the screen does not say so. Phase 2 fixed three of these; these are
the ones it missed.

### S8. Medicine-form Save — done

The worst one, on the screen where it costs the most. Save is never disabled,
shows no spinner, and does up to three sequential round trips
(`upsert_medicine`, `replace_schedules`, then a photo upload through an edge
function that can cold start).

Two taps in that window run `save()` twice with `draft.id` still `null` on the
second — **two medicines with the same name, both on Today**, and the person has
to work out which to delete.

Disable the button, swap its label for a spinner, and guard with
`if (saving) return`. Re-enable on the failure paths only; on success the view
navigates away.

### S9. Partial re-render of the medicine form — done

`draw()` is `clear(app)` plus a full rebuild, called on every slot-select change,
frequency change, weekday chip toggle, schedule add/remove and photo pick. Values
survive (they live in `draft`), but focus does not and a long form jumps. This is
the "page reloads while I'm adding a medicine" complaint, and it is the one item
here that is felt rather than merely risked.

The form already has the seam: `scheduleCard(entry, index)`. Give it the same
`replaceWith` treatment `day.js` gives a slot, and keep the full `draw()` only
for structural changes (adding or removing a card).

*Risk:* `day.js` shows exactly how this goes wrong — the first version of
`redrawSlot` read the node it was replacing *after* rebuilding it and became a
silent no-op. Read before build.

### S10. Supporter's own save doesn't reach their own Today — done

`medicine-form.js` writes through `supporter.js` and navigates to `#/medicines`,
which reads live so the list is correct. But **Today**, and the list's *photos*,
read the local cache that `supporter-sync.js` fills — and nothing invalidates it
on save. A medicine the supporter just added is missing from their own Today, and
its freshly uploaded photo shows the fallback tile, for up to 60 seconds.

`await supporterSync.refresh(code)` after a successful save, before navigating.
It costs a round trip on a screen that has just done three, but the alternative
is a supporter who cannot see their own work.

### S11. `slotsView` — done

No loading state, no try/catch:

```js
const routine = await supporter.loadRoutine(code);
```

The previous screen stays put for the whole round trip, and a failure rejects the
view function into nothing. Every other supporter screen got a `loadingState()`
in Phase 2; this one was missed. Saving a slot label or time has no feedback
either.

Add the loading state, a try/catch with the same treatment `medicinesView` uses,
and a brief saved/failed signal on persist. S1's router-level catch is the
backstop, not the fix.

### S12. Elder Settings can hang forever — done

`settingsView` clears the screen, appends the title, then awaits
`auth.getSession()` and `pushLib.isSubscribed()`. `isSubscribed()` awaits
`navigator.serviceWorker.ready`, **which never resolves if no worker activates** —
a failed `sw.js` fetch, a hard-reloaded tab. The screen stays as a lone
"Settings" heading with no timeout and no error.

A loading state, and a race against a timeout on `serviceWorker.ready`. On
timeout, report reminders as being in an unknown state rather than as off:
claiming "off" is how the last round of push bugs stayed invisible.

### S13. `toggleNotifications` busy state — done

It awaits a permission prompt, a browser subscribe and a database upsert with the
button live throughout. Disable it for the duration.

---

## S14–S16: things we currently tell people that are not true

### S14. A nudge that reached nobody says "Reminder sent" — done

The edge function is careful here and returns
`{ sent: 0, reason: 'send-failed', detail: [...] }` when every push fails. The
client checks `retryInMinutes` and `no-subscriptions`, then falls through to
`toast(S.nudgeSent)` for everything else — including that. The supporter is told
the nudge landed when it did not, which is exactly the failure this feature was
built to remove.

Treat `sent === 0` as not sent. Needs one new string; the existing
`nudgeNoSubscription` says something specific and different.

### S15. `push.unsubscribe()` discards its delete error — done

```js
await supabase().from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
await sub.unsubscribe();
```

If the delete fails, the browser still unsubscribes: the UI reports reminders off
while the row survives and the cron job keeps pushing to a dead endpoint. This is
the mirror image of the bug already fixed in `subscribe()`, and the fifth
occurrence of the same discarded-`error` pattern in this codebase.

Check the error, don't unsubscribe if it failed, and say so. Worth a grep for
`from(` calls whose `error` is never read while in here.

### S16. Sign-out and disconnect leave the previous household on the device — done

`signOut()` writes `{ role: null, householdId: null, shareCode: null }` and
reloads; `disconnect()` does the equivalent. Neither clears `medicines`,
`schedules`, `doseLog`, `daySnapshots` or `photos`.

`replaceMedicinesCache` overwrites medicines on the next sync, but `doseLog`,
`daySnapshots` and `photos` are only ever added to. Sign in as a different
account, or pair to a different household, and the previous household's dose
history and pill photos are still there and still render on the calendar.

Clear every store except `settings` on both paths. This is a privacy fix, so it
should be the explicit, ordered kind: wipe first, *then* write the new settings,
so an interrupted sign-out leaves a device with no role and no data rather than a
new role and old data.

---

## S17–S19: small

### S17. Calendar sheet closed mid-render — done

```js
let rendered;
const sheet = openSheet({ …, onClose: () => { rendered?.cleanup(); … } });
rendered = await renderDay({ … });
sheet.setContent(rendered.node);
```

Close the sheet during that await — easy, it is on screen showing "Loading" —
and `rendered` is still `undefined`, so `cleanup()` never runs and every object
URL for that day leaks. `setContent` then writes into a detached node. Tapping
two days quickly opens two sheets.

Track whether the sheet is still open; clean up unconditionally when a render
finishes late, and ignore a second tap while one is loading.

### S18. Focus trap in `mountOverlay` — done

Overlays set `aria-modal="true"` and focus their first control, but Tab walks
straight out into the page behind and focus is never restored to the trigger on
close. On the photo viewer and the medicine sheet this is the difference between
usable and not for keyboard and switch users — and this app's users are the ones
most likely to be using one.

Trap Tab within the layer, remember `document.activeElement` on mount, restore it
on close. `mountOverlay` is the single place all four overlay types go through,
so this is one change for all of them.

### S19. Repo hygiene — done

- **`toast()` hide-timer race.** `hide()` schedules `node.hidden = true` 250ms
  out; a toast raised inside that window is shown and then hidden by the previous
  toast's timer. Reachable by cycling two doses quickly. Clear the pending timer
  when a new toast mounts.
- **Move `custom.txt` out of the repository.** It holds a live Google OAuth
  client secret. Untracked, absent from history (verified), and gitignored — but
  it sits beside files that do get committed.
- **Drop `js/config.js` from `.gitignore`.** It is tracked now, so the line has
  no effect and says the opposite of what the repo does — while `docs/setup.md`
  tells people to edit that file.
- **Finish the migration list in `repo-structure.md`**, which stops at `0007`.
  `0009_reminder_rpc_wrappers.sql` is the one someone setting up a fresh project
  will not think to look for.

---

## Order of work

Six commits, in this order, each independently verifiable:

| # | Contents | Why here |
|---|---|---|
| 1 | S1, S3 | The router guard first, because it is the backstop for everything else, and `replaceAll` because it removes a window the guard cannot close |
| 2 | S2 | Needs S1 in place, or suppressing a refresh just hides the duplication instead of fixing it |
| 3 | S4, S5 | The write path, together — S5's rollback is only trustworthy with S4's serialisation underneath |
| 4 | S6, S7 | Time and connection, one commit; both are "re-render on an external trigger" |
| 5 | S8–S13 | Feedback. Mechanical, independent, and safe to land in one go |
| 6 | S14, S16–S19 | Correctness of what we say, plus the small items |
| 7 | S9 | The form refactor, deferred to last as planned |

S15 landed early, in commit 5, because it is three lines inside the `push.js`
rewrite S12 already required and splitting it would have been ceremony.

S9 (partial form re-render) is the one item that could slip to its own commit if
it turns out to be more than a `replaceWith` — it is a real refactor of a
429-line file, and it is the least dangerous thing in this list to defer. *It
did get its own commit, last, and it was more than a `replaceWith` — see below.*

## How we will know

This phase has an unusually bad ratio of "reads correctly" to "works", so
verification is part of the work rather than after it. Three of the bugs it fixes
were invisible from reading the code, and two of them were mine.

The duplication bug in particular has to be reproduced *before* the fix, or there
is no way to know S1 addressed it rather than merely making it less likely:

- **S1/S2** — mark a five-medicine slot with Done on the elder's device and count
  the slot nodes in the DOM, not the rows in the store. Then the same with the
  supporter's poll firing mid-render. This is the reported bug; it needs to be
  seen failing.
- **S3** — refetch the routine while Today is rendering and confirm the
  cold-start screen never appears.
- **S4/S5** — cycle one dose four times as fast as the screen allows, with the
  network throttled, and check the server's final `status` matches the last tap.
- **S6** — set the device clock forward past midnight with the app in the
  foreground. Confirm the date changes and that a dose lands on the new date.
- **S16** — sign out, sign in with a second Google account, and confirm the
  calendar is empty. This one is a privacy claim and should be checked on the
  device, not reasoned about.
- **S8** — double-tap Save on a throttled connection and confirm one medicine.

## Deliberately not in this phase

- **Detached-fragment rendering for all views** (S1 option (a)). Better shape,
  bigger change; revisit if a fourth screen wants it.
- **Teaching the outbox to distinguish rejection from being offline.** Real gap,
  surfaced by S6, but it touches retry policy and error reporting together.
  Open it as its own item if a permanent rejection is ever actually observed.
- **`db.js` `upgrade()` cannot add an index to an existing store.** Still true,
  still nothing needs one. The first feature that does needs a migration path
  designed first.
- **Guided photo capture.** A real gap — `object-fit: contain` made wide photos
  legible, not well framed — but it is a feature, and this phase is not.

---

# What actually happened

## The duplication bug was reproduced before it was fixed

Five concurrent `refresh()` calls left **five day-heads and ten slot nodes** on
screen. After S1: one and two. That is the bug as reported from the phone, and
it needed to be seen failing — otherwise there is no way to tell "S1 fixed it"
from "S1 made it rarer".

## Two things the review missed, found by using the app

**A supporter marking a dose wrote correctly and showed nothing.** Not a new
bug and not one the review predicted: the confirm dialog sits open for a few
seconds, the sixty-second poll re-rendered the day underneath it, and
`redrawSlot`'s `replaceWith` then landed in a detached tree and silently did
nothing. The store was right and only the screen was wrong, which is the worst
shape this kind of bug can take — it reads exactly like the tap being ignored.

Two changes came out of it, both folded into S2:

- The supporter's poll compares a signature of the routine and the dose rows
  against the last sync and only calls back when something actually moved. Most
  polls change nothing, and re-rendering every sixty seconds regardless was
  throwing away scroll position and reloading every photo for no reason.
- `redrawSlot` notices when its node has been detached and tells the caller,
  which re-renders from the store. A silent no-op was the failure mode; now it
  is self-healing.

**The slot-removal warning counted archived medicines.** Archiving hides a
medicine, it does not deactivate its schedules, so "3 medicine times use this"
included medicines that stopped appearing months ago — in a confirmation
dialog, which is exactly where a wrong number does damage. Fixed alongside S11.

## Two ordering traps, both of which fake success

Worth writing down because they have now cost time twice in this codebase, and
both fail by *appearing* to work:

1. **Read the node you are replacing before you build its replacement.** The
   builder registers what it creates, so asking afterwards hands back the new
   detached node and `replaceWith` quietly does nothing. This is the Phase 1
   `redrawSlot` bug; S9 would have repeated it exactly.
2. **Read `document.activeElement` before the swap, not after.** Removing a
   focused element resets it to `<body>` immediately, so a focus-restore that
   reads it afterwards always comes back empty. The first version of S9's
   `refocus` did this and looked fine until it was actually measured.

## Decisions taken during the work

**No freshness line on the elder's Today.** The plan suggested carrying over
the supporter's "Updated N minutes ago". The supporter's copy is polled and has
to say so; the elder's is live, and a freshness line on a screen that is
correct adds doubt rather than removing it. The backfill in S7 happens either
way.

**The outbox is cleared on sign-out.** Anything left in it belongs to a
household the device is no longer part of, and RLS would reject the writes. The
alternative — keeping them — trades a real privacy leak for a hypothetical
saved dose.

**`isSubscribed()` is three-valued.** `true`, `false`, and `null` for "the
check itself failed". Reporting "off" for a check that could not run is how a
household ran for weeks believing reminders were on.

## Verified on the device, and not

Against the live test household (`AMZV3Z`, supporter side), on the mobile
viewport:

| | |
|---|---|
| S1 | five concurrent refreshes, and a four-tab navigation storm → one screen |
| S2 | marking a dose updates in place, and the poll no longer re-renders on a tick that changed nothing |
| S4/S5 | four taps as fast as the DOM allows walk taken → skipped → unmarked → taken → skipped, and the server agrees with the screen |
| S6 | clock shifted past midnight, `focus` fired → "Sunday 6 September" became "Monday 7 September" |
| S8 | three Save taps → exactly one medicine |
| S10 | a medicine saved on the supporter's phone is on their own Today immediately |
| S11 | loading state, and the error path renders instead of throwing |
| S17 | closing the day sheet mid-load leaves no layers and no leak; two taps open one sheet |
| S18 | Tab wraps inside the sheet; Escape closes it; focus returns to the row that opened it |
| S9 | changing the frequency leaves the name and notes inputs as the same DOM nodes, values intact, focus on the select |

**Not verified on a device:** S3, S7, S12, S13, S14, S15, S16. All of them are
elder-side or need a failure to be induced (a dead socket, a rejected delete, a
service worker that never activates), and the browser here is paired as a
supporter. They are reasoned from the code, which is exactly the standard that
let four push bugs through — so they are the first thing to check on a real
elder device.

## A testing note

The dev server plus the service worker will hand you **stale modules** across a
`location.reload()`, with fresh bytes sitting in both the SW cache and the
network response. Everything looks correct and you are testing last version's
code. Load the page with a changed query string (`?v=2`) to force a new module
map. Two of the verifications above initially "failed" for this reason and
nothing was wrong.
