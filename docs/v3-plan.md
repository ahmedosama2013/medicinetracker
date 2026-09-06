# v3 plan — visual overhaul and supporter parity

> Unrelated to [medicine-tracker-plan-v3.md](medicine-tracker-plan-v3.md),
> which is the third revision of the original build spec and long superseded.
> The shared "v3" is a coincidence of numbering.

The plan for the redesign discussed in September 2026, and the running record of
what each phase actually did — including where it departed from the plan and why.

**This is not a description of the app.** [ui.md](ui.md) describes what the
screens are and the rules they obey; [architecture.md](architecture.md)
describes how the two devices work; [flow.md](flow.md) describes what the two
people do. This file is the reasoning and the remaining work. Phases 0–2 are
done and folded into those three; Phases 3–4 are still ahead.

This file exists because the interesting part of this work is not the CSS. It is
that four of the wanted features are blocked on the same architectural fact —
**a supporter device has no session** — and that fact is invisible from the
feature list. Phasing is arranged around it.

---

## What we decided

**In.** Photo-first medicine identity, three-state dose logging on a cycling
target, one bottom nav for both roles, full supporter parity (Today, Calendar,
Medicines, Settings), dark mode, a warmer palette on the existing brand blue,
a weight cap of 600, a second photo per medicine (the packet), a nudge button,
a code-first cold start for the elder, a plain-language purpose line, reminder
escalation to the supporter, refill surfaced to the elder, and organiser mode.

**Out, deliberately.** Read-aloud (`SpeechSynthesis` mispronounces drug names —
too much error potential for too little gain), QR pairing (the pair is usually
remote), multi-patient support, and any aggregate adherence number.

**Rules that survive from v1/v2.** No webfont. No clinical logic. No streaks or
scores. The whole day is always shown. A tap changes only the slot tapped.
`prefers-reduced-motion` removes everything.

**Rules being relaxed, on purpose.** A today-only progress rail and a passive
`Now` badge are allowed. Neither reorders, hides or dims anything; the "nothing
reacts to the clock" rule now means "nothing *moves* because of the clock".

**One new rule.** *Skipped is not failure.* Amber, never red. The word is
"Skipped", never "Missed". Organiser mode never writes to the dose log —
filling a tray is not taking a medicine, and conflating them falsifies the
calendar.

---

## What the code says

Findings from reading the current implementation that change the plan.

### The supporter has no session, and four features need one

`js/supporter.js` is code-gated: every call passes `p_code` to a
`security definer` RPC that resolves the household itself. There is no
`auth.uid()` on a supporter device. Consequences:

| Wanted | Blocked because | Needs |
|---|---|---|
| Supporter Today / Calendar | RLS on `dose_log` and `day_snapshots` is owner-scoped via `app.my_household()` | New `security definer` read RPCs taking `p_code` |
| Mark on behalf | `dose_insert` / `dose_delete` policies are owner-only; there is no UPDATE policy at all | New `log_dose` / `unlog_dose` RPCs taking `p_code` |
| Supporter self-reminder, escalation to supporter | `push_subscriptions.user_id` is `not null` and FKs `auth.users` | `user_id` nullable, plus a `device_id` and `role`, registered through a service-role edge function like `supporter-photo` |
| Live updates on supporter Today | Realtime respects RLS; an anon supporter sees no rows | Refresh on view + poll. Accept it and say so in the UI |

Only the **nudge** (supporter → elder) is easy: the supporter's device asks a
new edge function to push to the elder's existing subscription. No supporter
identity required.

### Skip is nearly free server-side, and awkward client-side

`dose_log.status` already exists — `not null default 'taken'` with
`check (status in ('taken'))`. Widening the check to `('taken','skipped')` is
one line. The awkward part is that there is **no UPDATE policy on `dose_log`**,
so a cycling target that goes taken → skipped is a delete followed by an
insert, not an update. Either add an UPDATE policy or make the RPC do both
inside one transaction. The unique constraint
`(household_id, local_date, slot_id, medicine_id)` already prevents duplicates.

### IndexedDB cannot currently migrate anything

`js/db.js` is at `DB_VERSION = 2` and `upgrade(db)` is version-agnostic — it
only ever does `if (!contains(name)) createObjectStore(...)`. It cannot add an
index to an existing store and cannot rewrite records. So:

- **New stores are free.** Organiser state, the buy-list, and any new cache can
  be added without touching existing data.
- **New indexes on existing stores are not.** Anything needing one requires
  real `oldVersion` branching first.
- **The packet photo must avoid a keyPath change.** Store it as a `packetBlob`
  field on the existing `{ medicineId, blob }` record in `photos`. IndexedDB
  records are schemaless, so this costs nothing.

### New medicine columns must be threaded through five places

`mapMedicine` in `js/sync.js` enumerates columns explicitly — a new server
column is silently dropped. Adding `purpose` and `packet_photo_path` means
touching: the migration, `public.get_routine`, `public.upsert_medicine`,
`mapMedicine`, and the form. `upsert_medicine`'s returning object already omits
`photo_path`; fix that while we are in there.

### Two things are already done

The share code charset is `[2-9ABCDEFGHJKMNPQRSTVWXYZ]` — ambiguous characters
are already excluded, so the "make the code easier to read out" idea needs only
presentation work. And the second reminder shipped in migration `0004` as a
`stage` column on `app.notification_sends`; escalation to the supporter is a
third stage on the same mechanism, not a new one.

---

## Phase 0 — Foundations

Nothing user-visible ships alone. Everything after depends on this.

1. **Rewrite the token layer in `css/app.css`.** Warm canvas (`#F3F1EA`), white
   surfaces, the existing brand blue `#1A56A0` kept so `icons/make-icons.py` and
   `theme-color` stay valid. Semantic teal for taken, amber for skipped, coral
   for attention, red for destructive. Radius collapses to three steps plus pill.
2. **Dark mode.** `color-scheme: light dark`, a `[data-theme]` override in
   Settings, and every token doubled. Elevation in dark comes from the surface
   ladder (`#171613` → `#201F1B` → `#2A2823`) plus hairlines, because shadows
   carry no information on a dark canvas. The completed-slot tint must read as
   positive, not disabled: deep teal fill, light teal text.
3. **Cap font weight at 600.** Thirteen uses of `800` become `600`; most `700`
   becomes `500`. Add `-0.015em` tracking on headings and `tabular-nums` on
   times, doses and the share code.
4. **Converge the type scale.** Simple mode keeps its 46px targets and loses its
   oversized type; the two densities now differ on touch, not text.
5. **The pill identity component.** A 44px rounded-square tile in six states —
   own photo, community photo, generated fallback, taken, skipped, archived.
   Deterministic colour and form glyph from the medicine when no photo exists.
   New helper in `js/ui.js`.
6. **One bottom bar.** Delete the top-tabs branch in `drawNav` (`js/main.js`),
   the `.topbar-*` / `.tabs` rules, and the `<header id="topbar">` element.

*Risk:* touching `drawNav` and the route table at the same time as the
stylesheet. Land the CSS first, nav second, so a regression has one cause.

### Done, with one change

Phase 0 shipped as written except for the supporter's tab set. The plan had
`NAV.supporter` gaining Today and Calendar here and `router.HOME.supporter`
moving to `#/today`. Both are deferred to Phase 2, because a supporter device
has no local dose log at all — `js/sync.js` is never imported there — so those
tabs would have led to slot cards whose Done buttons cannot write. The bar is
unified now; the supporter's tabs arrive with the RPCs in items 12–14.

Two other things surfaced while building it:

- **`js/views/calendar.js` inlines CSS variables** (`var(--ok)`, `var(--surface-2)`)
  in `style` attributes, so renaming tokens silently blanked the completion
  rings — a rename the stylesheet cannot catch. Now `var(--taken-line)` /
  `var(--sunken)`, and the old `opacity: .22` trick is gone: opacity only works
  against a known background and there are two of them now. Worth grepping
  `var\(--` across `js/` before any future token rename.
- **`--taken-tint` needed splitting into `tint` and `wash`.** The same value
  behind an 18px badge and behind a whole card reads completely differently in
  dark mode — as a whisper and as a shout. Small fills use `tint`, whole
  surfaces use `wash`; identical in light, far apart in dark.

## Phase 1 — Elder screens

7. **Today.** Slot cards with a time-of-day glyph, per-medicine rows anchored by
   the pill tile, a cycling dose target, the today-only progress rail, the `Now`
   badge, and completed slots collapsing to a stacked-avatar strip with Undo.
   `js/views/day.js` keeps its swap-only-the-tapped-slot behaviour.
8. **Three-state logging.** Widen the `dose_log` check constraint, decide
   delete-then-insert vs. an UPDATE policy, extend `js/sync.js` and the outbox,
   and give the calendar ring a third state. A tap landing on *skipped* raises a
   toast with Undo — the state is loud on purpose, because a cycling target can
   be reached by accident.
> **Item 8 done.** Migration `0005_skipped_doses.sql` widens the check and adds
> the UPDATE policy 0001 deliberately omitted — the reasoning is in the
> migration's header, since it reverses a documented decision. Client side, the
> outbox now keys every per-medicine write on `dose:date:slot:medicine` rather
> than the dose uuid, so cycling a medicine while offline coalesces to one
> pending item holding the final state instead of a replay sequence the outbox
> cannot order; and `undoSlot` purges pending per-medicine writes for that slot
> before queueing its delete, which closes the same hole from the other side.
>
> Two decisions that were open in next-steps.md §3, now settled: **Done never
> overrides a skip** (it marks only what is unmarked), and **Undo on a slot
> does clear skips** — it means "put this slot back to untouched", and leaving
> amber behind would make the button's effect depend on invisible history.
>
> Calendar gets its third state as arc *length* from taken + skipped and arc
> *colour* from whether anything was skipped. A skipped dose fills the arc as a
> taken one does: deciding not to take something is engaging with the day, and
> a shorter arc would read as a mark against the person.

9. **Medicine detail sheet.** Replaces the bare photo viewer. Photo full-bleed,
   then name, strength, dosage, purpose, notes, schedule, and whether the photo
   is the supporter's own or from the community. This is where a skip can also
   be reversed for anyone who finds the cycling target confusing.
10. **Cold start.** The elder's empty Today becomes their share code, large,
    with "Show this to whoever is helping you". Today currently renders
    `todayNothingSimple`, which is a dead end.
11. **Calendar.** Restyled to the new tokens, third ring state, day sheet reusing
    the detail sheet.

### Phase 1 done

Item 11 needed almost nothing of its own: the tokens landed in Phase 0 and the
third ring state in 1b, and the day sheet picked up the new rows for free by
already calling `renderDay`.

Item 9 kept the full-screen photo viewer rather than replacing it. That view
answers "which pill is this?", which is the entire reason the photos exist
(flow.md, Flow 4), so it moved one tap deeper instead of away: the sheet is the
detail, and the photo inside it is the door to the big version. With no photo
the block is a plain div, not a button — a control that opens a full-screen
view of nothing is a dead end, and a square of empty space pushes dosage and
times below the fold.

Two bugs found by verifying rather than assuming, both mine, both invisible
from reading the code:

- `redrawSlot` called `buildSlot` before reading the node it was replacing.
  `buildSlot` registers the node it creates, so `replaceWith` was handed the
  new detached node and quietly became a no-op — every dose change wrote to
  the database correctly and updated nothing on screen.
- **Escape dismissed every open overlay at once.** Each layer adds its own
  `document` keydown listener, so the stack all fired together. Latent since
  v2 and unreachable then; the medicine sheet opening over the calendar's day
  sheet made it reachable, and closing the medicine would have dropped the
  person back to the month grid. `mountOverlay` now ignores Escape unless its
  layer is the host's last child.

## Phase 2 — Supporter parity

12. **Read RPCs.** `get_dose_log(p_code, p_from, p_to)` and snapshot access,
    both `security definer`, both scoped by `app.household_by_code`.
13. **Supporter Today.** Same slot cards; the dose target becomes a read-out
    (taken at 8:12 am / skipped / nothing yet). No realtime — refresh on view,
    poll while visible, and say "updated just now" rather than pretending.
14. **Mark on behalf.** `log_dose` / `unlog_dose` RPCs, behind one confirmation
    dialog, with the row labelled as marked by the supporter. Two people writing
    the same log silently would erode what the calendar means.
15. **Nudge.** A `nudge` edge function taking the share code, pushing to the
    elder's subscription. Rate-limit to one per slot per hour, server-side.
16. **Medicines as a visual inventory.** 40px tiles; a missing photo becomes a
    visible, tappable prompt rather than an invisible gap.
17. **Settings split** into Account, Reminders, Times of day, About — for both
    roles. The current single Reminders toggle cannot express what Phase 4 needs.

### Phase 2a done — reads, and the supporter's day

Migration `0006_supporter_parity.sql` adds `logged_by` and four code-gated
functions: `get_dose_log`, `get_history`, `log_dose`, `unlog_slot`. The write
pair exists but nothing calls it yet — item 14 needs the confirmation UI in
front of it, and shipping the capability before the guardrail is the wrong
order.

The architectural decision worth recording: **the supporter now has a local
cache**, filled through those RPCs by `js/supporter-sync.js` into the same
IndexedDB stores the elder uses. That reverses `js/store.js`'s header note
("a supporter device never touches this file for medicines, schedules or
slots"), which was written when the supporter had no screen that rendered a
day. The alternative was parameterising every read path in `schedule.js`,
`day.js` and `calendar.js` by role, which is far more code and two ways for
the same screen to be wrong. The reason behind the old note still holds and
still shapes the file: **the cache is read-only on that side.** Supporter
writes will never go through `sync.js`'s outbox — nothing on that device
flushes it — they go straight out through the RPCs and are followed by a
refresh.

Realtime is not available to a supporter: it respects RLS, and with no session
they match no rows, so no events ever arrive. Hence polling, and hence the
freshness line on their Today. That line is not decoration — polled data
presenting itself as live is a lie the person only discovers when it matters,
and "they haven't marked anything" is precisely the wrong thing to be wrong
about.

History is fetched a range at a time rather than all at once: 75 days on open,
and `ensureRange` pulls a month the first time the calendar pages to it.
Without that, paging back would render hollow rings, which do not read as "not
loaded" — they read as "they took nothing that month".

Also landed, because it fell out of the same work: **read-only days now show
per-medicine state.** The elder's own frozen past days previously showed
nothing per row, so a locked day could tell you the slot was incomplete but
not which medicine went unmarked. And the read-only footer tick is gone — v2
rendered it alongside the head's tag, saying the same thing twice, in the
taken colour regardless of whether anything was skipped.

**Not verified against a live database.** These RPCs have never been called
with a real share code; the UI was exercised against a seeded local cache with
the network failing, which is how the "Could not check for updates" state got
tested but is not the same as knowing the SQL is right.

### Phase 2 done

Items 14–17 landed together. What is worth carrying forward:

**`js/doses.js` is the seam between the two roles.** One facade, two routes:
the elder writes locally then queues through `sync.js`'s outbox; the supporter
writes straight out through the RPCs and mirrors into the cache afterwards. A
supporter write must never enter the outbox, because nothing on that device
flushes it and the write would sit there looking saved. The consequence is
deliberate and verified: a supporter write that cannot reach the server leaves
the dose unmarked and says so, rather than appearing to succeed. Marking a
dose for someone else is not something to silently defer.

**Mark-on-behalf is confirmed once per session, not per tap.** A supporter
sitting with the person marks several in a row, and a dialog on each one is
how you train someone to dismiss dialogs unread. Attribution carries the
weight instead: every such row is `logged_by = 'supporter'`, and the elder's
rows show "Marked by your helper" so a mark they did not make is never a
surprise. That note is absent on the supporter's own screen, where it would
only state the obvious.

**Appearance closed a gap left open in Phase 0.** The dark tokens shipped with
`[data-theme]` support that nothing ever wrote, so dark mode only followed the
OS. Three states rather than a switch, because "match my phone" is the default
and a two-position toggle cannot express it.

**The nudge is rate limited on the server, not in the UI.** A worried relative
tapping four times must not produce four buzzes on an elderly person's phone,
and a client-side limit is a suggestion. It never names a medicine — same
reason `send-reminders` doesn't, since the body passes through a third-party
push service onto a lock screen — and it distinguishes "nobody is subscribed"
from "sent", because silence would otherwise read as being ignored.

`last_nudge_at` is a column rather than a table on purpose. If a log of nudges
is ever wanted it should be designed deliberately: a record of how often
someone needed chasing is exactly the kind of thing this app has decided not
to keep.

**Still unverified against a live database.** `log_dose`, `unlog_slot`,
`get_dose_log` and `get_history` have been exercised only through their
failure paths locally. The nudge function has never run at all.

## Phase 3 — Organiser mode

Its own phase because it is the only part with unresolved design questions.
Entry point is a card on Today, not a tab.

18. **Week computation.** Seven days forward from the chosen start, per medicine,
    from `schedule.dueOn` — not from snapshots, which only exist for past days.
19. **Step screen.** One medicine at a time: packet photo, purpose line, the
    total to take out, and a day × slot grid so an entire box is opened once.
20. **Check screen.** The same grid with counts instead of dots, because counting
    is how a filled tray is actually verified and pill colour is unknowable from
    a photo. Tapping a compartment lists what belongs in it at full tile size.
21. **Wake lock.** `navigator.wakeLock` for the duration. Filling a tray takes
    minutes with both hands full.
22. **"I don't have enough."** Adds the medicine to a buy-list on the elder's
    Today and notifies the supporter. This is how refill enters the product:
    ground truth at the one moment the information exists, with no stock counting.

**Unresolved, to be settled inside this phase:** compartments per day (the tray
may have fewer than the household has slots, and grouping needs a rule); half
tablets; an explicit "nothing today" mark for non-daily schedules; a numeral
inside the dot for doses above one; and excluding syrups, drops, inhalers and
injections from the count with a "these stay out of the box" strip.

## Phase 4 — Roadmap features

Cheapest last, because Phases 0–2 make most of them small.

23. **Purpose line + packet photo.** One migration, five threading points, a
    `packetBlob` field, a `kind` param on `supporter-photo`.
24. **Supporter push identity.** `user_id` nullable, `device_id` and `role`
    added, registration through a service-role edge function.
25. **Reminder escalation.** A third `stage` on `app.notification_sends`:
    still unmarked after stage 2 notifies the supporter. Default on — sharing the
    code is the consent — but listed and switchable in the elder's Settings.
26. **Supporter self-reminder per slot.** A bell toggle in the slot header on
    supporter Today. Needs 24.
27. **DRAP autocomplete.** Static JSON in the repo, loaded on demand, supporter
    only. The medicine form is rebuilt search-first around it rather than having
    a typeahead bolted on.
28. **Crowdsourced photos.** DRAP-matched entries get a shared photo; the tile
    grows a community badge and the detail sheet says where the photo came from.
29. **Verify push actually works** on a real iOS home-screen install.

## Docs

`ui.md` is rewritten against Phase 1. `flow.md` gains organiser mode and the
supporter's Today. `next-steps.md` has §3 (skip), §4 (DRAP) and the refill and
PRN items struck or rewritten. The three surviving rules — skipped is not
failure, organiser never logs doses, no aggregate adherence anywhere — go in
`ui.md` where someone will find them before building a chart.

---

## Order of operations

Phase 0 → 1 → 2 → **2.5** → 3, with Phase 4 items pulled forward
opportunistically: item
23 is cheap enough to land during Phase 3, since organiser mode wants the packet
photo and the purpose line anyway. Items 24–26 are one thread and should be done
together or not at all.

The riskiest single change is item 8, because it touches the outbox, the sync
merge, and the calendar's counting at once. The riskiest sequencing mistake
would be building organiser mode before item 23, which would mean building its
step screen twice.

**Phase 2.5 — Stability** was added after Phase 2 shipped and is not in the
numbered list above; see [phase-2.5-plan.md](phase-2.5-plan.md). It is entirely
fixes to what Phases 0-2 built, and it went before Phase 3 because organiser
mode is the most stateful screen in the product and should not be built on a
router that can render the same screen twice.

**Done.** Nineteen items across seven commits, the largest being: renders are
numbered so two can no longer append to the same screen; a screen is no longer
redrawn for a change it has already made itself; the outbox flushes one at a
time; the dose target moves on the tap; and the date is re-checked at midnight
instead of being captured when a screen was first drawn. Phase 3 starts from
here.
