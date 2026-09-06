# Phase 3 — Organiser mode

The screen the photos have always been for. A supporter or an elder sits down
with a week's worth of boxes and a plastic tray and fills it, and the app walks
them through it one medicine at a time so each box is opened exactly once.

Items keep the numbers they have in [v3-plan.md](v3-plan.md) — 18 to 22, plus
23 pulled forward from Phase 4 — with letters where one item turned out to be
two. Item 23 goes **first**, because v3-plan already names building the step
screen before the packet photo exists as the phase's worst sequencing mistake.

Phase 2.5 went ahead of this deliberately: organiser mode is the most stateful
screen in the product, and it should not be built on a router that can render
the same screen twice.

---

## What this phase is modelling

Not a feature list — one sitting, perhaps fifteen minutes, at a kitchen table.

Everything the person needs is on the table: the tray, the boxes, and their
phone propped against something. Their hands are full. They open one box, take
out a week's worth, distribute it across seven days, and put the box back. Then
the next one. At the end they check what they've done by counting, because that
is how a filled tray is actually verified.

Three things follow from that and they are what shapes every screen below:

- **One medicine at a time, not one day at a time.** Filling day-by-day means
  opening every box seven times.
- **The screen must not go dark.** Hence the wake lock. Hence also that nothing
  must require typing.
- **The moment they find they are short is the only moment that information
  exists.** Nobody counts pills as a separate activity. That is item 22, and it
  is why refill enters the product here rather than as stock tracking.

## Decisions taken before starting

Recorded because several of them close questions v3-plan left open.

**Both roles get it.** flow.md Flow 4 assigns filling the organiser to the
supporter; next-steps.md §6 says supporters are often abroad. Both are true, so
the screen belongs to whoever is holding the tray. It costs almost nothing: the
plan is computed from the same cache both devices already have.

**`dosage` becomes a number.** It is free text today (`'1 tablet'`), and the
step and check screens both need to count. The column is *replaced*, not
supplemented — "How much to take" is a quantity, and it was only ever text
because v1 never had to add it up. The unit comes from `form` through
`strings.js`, so "2" plus `tablet` renders "2 tablets" and stays translatable.
Fractions are real (`numeric(4,2)`), so half and quarter tablets work and the
grid can show `½`.

**Which slots go in the box is a setting, not a compartment count.** A count has
a hole in it: if the tray is 7×2 and the household has four times of day, the
afternoon and evening medicines have nowhere to go, and merging them into an
AM/PM compartment means someone takes their afternoon dose at breakfast. That is
the one place this app could actively mislead. So the setting asks which times
of day go in the box; tick two and you get a 7×2 grid, tick four and you get
7×4. Anything unticked joins the out-of-box strip. Defaults to morning and
night.

**Only tablets and capsules go in the box.** `form` already carries exactly the
distinction — ui.md says the droplet glyph exists precisely because "liquids and
drops are the things that must *not* go in a weekly organiser". `other` goes in
the box; it is still a discrete thing.

**The buy list is shared, but nothing is pushed.** Notifying a supporter needs
item 24 (`push_subscriptions.user_id` is `not null` and FKs `auth.users`), and
24–26 are one thread that should be done together or not at all. So a shortage
appears on both Today screens and the supporter finds it next time they open the
app. That is honest; a card that claims to have notified someone would not be.

**The plan is frozen for the sitting.** Computed once when the session starts
and stored. A supporter editing a medicine while someone else is halfway through
the tray must not change the grid under their hands. Same reasoning as
`day_snapshots`, different lifetime.

**Nothing here writes to the dose log.** Already a rule in ui.md. Filling a tray
is not taking a medicine, and conflating them would quietly falsify the
calendar.

**A step counter is not an adherence number.** "3 of 9 medicines" is orientation
inside a task that has an end, like the progress rail on Today. It resets, it is
never stored, and there is no historical counterpart. What must not appear is
anything summing across sittings — "you filled the tray 3 weeks running" is a
streak, and this app does not issue them.

---

## 23 — Medicine details: purpose, packet photo, dose as a number

One migration, because these three changes share the same five threading points
and threading them twice is exactly how a column gets silently dropped —
`mapMedicine` in [js/sync.js](../js/sync.js) enumerates columns explicitly, so a
new server column that is not added there simply never arrives.

The five: the migration, `public.get_routine`, `public.upsert_medicine`,
`mapMedicine`, and [medicine-form.js](../js/views/medicine-form.js). Plus
`app.compute_day`, which writes snapshots, and the `upsert_medicine` returning
object, which already omits `photo_path` — v3-plan says fix that while we are in
there.

### 23a. `0011_medicine_details.sql`

```sql
alter table public.medicines
  add column purpose text not null default '' check (length(purpose) <= 120),
  add column packet_photo_path text,
  add column dose_qty numeric(4,2) not null default 1
    check (dose_qty > 0 and dose_qty <= 99);
```

Then the conversion, and this is the only destructive change in the phase:

```sql
update public.medicines set dose_qty = ...   -- leading number out of dosage
alter table public.medicines drop column dosage;
```

**Run `select id, name, dosage from public.medicines` first and read it.** At a
handful of households that is a screenful, and eyeballing it is worth more than
trusting a regex. `'2 tablets'` → 2, `'½ tablet'` and `'1/2 tablet'` → 0.5,
anything unparseable → 1.

The one thing the conversion loses is a row where someone typed frequency into
the dosage field (`'1 tablet twice a day'`). That data was already in the wrong
place — frequency lives in `schedules` — so let it go, but note any such row
during the pre-flight rather than discovering it afterwards.

**Frozen snapshots keep the old shape.** `day_snapshots` rows written before
this carry `dosage` as text; rows after carry `doseQty` as a number. The
renderer handles both, exactly as `js/schedule.js` already falls back when a
snapshot has no `slotTime` (migration 0010). Rewriting past snapshots is the one
thing freezing them exists to prevent.

### 23b. Threading

`get_routine` emits `purpose`, `packetPhotoPath`, `doseQty`. `upsert_medicine`
accepts and returns all three, plus the `photoPath` it currently forgets.
`compute_day` carries `purpose` and `doseQty` into snapshots, matching what it
already does for name and strength. `mapMedicine` picks up the three new fields.

### 23c. The packet photo

Stored as a `packetBlob` field on the existing `{ medicineId, blob }` record in
the `photos` store. IndexedDB records are schemaless and the keyPath does not
change, so this costs nothing — which is the whole reason v3-plan chose it over
a second store.

`supporter-photo` gains a `kind: 'pill' | 'packet'` parameter selecting which
column it writes. Everything else about that function is unchanged.

### 23d. Where the two new fields show

`purpose` goes under the name in the medicine detail sheet, and on the step
screen — "what is this one for?" is the question a person filling a tray asks
about a box they did not buy. It is deliberately short (120 chars): a sentence,
not a paragraph, and never clinical advice.

The packet photo appears in the sheet and, full width, on the step screen. It is
**not** a `pillTile` — the tile answers "which pill is this?" at 44px, and the
packet answers "which box do I reach for?" at whatever size the screen allows.
Different question, different component.

### 23 done

Shipped as migration `0011_medicine_details.sql` plus the client threading.
Three things the plan had not accounted for:

**There are seven threading points, not six.** `0002_service_role_photo_grants.sql`
grants the photo edge function `update (photo_path)` — a *column-level* grant,
deliberately, so that function can write nothing else on the table. That
precision makes it a place every new column the function touches has to be
added. `service_role` bypasses RLS but not column privileges, so the packet
upload would have failed with "permission denied for column
packet_photo_path", surfaced through an edge function whose only error path is
a bare 400. Found by grepping the migrations for `photo_path` rather than by
running it.

**`buildDay` had to carry the legacy `dosage` too, not just `toSnapshot`.**
The plan reasoned about frozen snapshots, which is where old-shaped data was
expected to live. But a device that has not synced since the app updated still
holds *pre-migration medicine records* in its IndexedDB cache, and Today
renders those before the first refetch lands. Dropping the field in `buildDay`
blanked the dose line for however long that took. Caught by seeding a
legacy-shaped record and looking at the screen, not by reading the code.

**The photo preview token had to become one per kind.** The form held a single
module-level token and released it at the top of `photoField()`. With two
pickers, redrawing either one revoked the other's live preview and its image
went blank with nothing to explain why. Verified after fixing: picking a packet
photo swaps only the packet field, leaves the pill picker's node and object URL
untouched, and does not trigger the full `draw()` that Phase 2.5's S9 exists to
avoid.

Also confirmed against a seeded cache: `2 tablets`, `½ tablet`, `2 puffs`
render from `doseQty` + `form`; the sheet's packet photo object URL is created
on open, revoked on close and recreated fresh on reopen; and Save sends
`doseQty` as a number with one upload per photo kind.

**Not verified against a live database.** The migration has not been run. The
conversion, the dropped column and the new grant are all unexercised — see the
pre-flight `select` in the migration header before running it.

---

## 18a — Which times of day go in the box

`alter table public.slots add column in_box boolean not null default false`,
seeded true for the two built-in slots at `sort_order` 1 and 4 — Morning and
Night as `create_household` seeds them. Labels are editable so they cannot be
matched on; sort order can, and anything wrong is one tap to correct.

Threaded through `get_routine`'s slot objects as `inBox`, and through
`mapSlot` in `js/sync.js`.

**One new function, `public.set_slot_in_box(p_code, p_slot_id, p_in_box)`,
code-gated like the rest.** Both roles already hold the share code — the elder's
device keeps it in `settings.shareCode` — so one function serves both without
opening the full slot editor to the elder. `save_slots` can archive slots; this
cannot do anything but flip one boolean, which is the right amount of power for
a screen about the shape of a plastic tray.

It is household state, not device state: there is one physical box, in one
kitchen. So it syncs, and both phones agree about it.

The UI is a checklist of the household's slots in a new **Pill box** section in
Settings, visible in both roles. Unticking everything is allowed and means "we
do not use a pill box" — the organiser entry card disappears.

### 18a done

Migration `0012_pill_box_slots.sql`: one boolean per slot, seeded true for the
built-ins at `sort_order` 1 and 4, plus `set_slot_in_box` and `inBox` on
`get_routine`'s slots. The **Pill box** section sits in Settings in both roles,
between each role's own sections and Appearance.

Two things worth recording:

**`save_slots` did not need changing, and that is load-bearing.** It upserts
label, time, sort order and archived, and never mentions `in_box` — so editing
slot times leaves the box alone, and a newly added time of day starts outside
it. Both are the behaviour we want, and both come free from not touching it.

**The shape line is the point of the section.** The chips alone are an abstract
choice; "That is a 7 × 2 box — seven days, 2 compartments a day" is the tray on
the table. It updates on every tap and turns into "Nothing goes in a box, so
filling one is not offered" at zero, which is how the organiser's absence gets
explained where the decision was made rather than by the entry card silently
not being there.

Verified against a seeded cache: ticking a slot fires exactly one RPC with the
right arguments, persists, and moves the shape line; unticking everything
reaches the no-box state; and a failing write rolls the chip back, says so,
re-enables itself, and succeeds on retry. The chip moves on the tap rather than
on the round trip — same reasoning as the dose target in Phase 2.5's S5.

---

## 18b — The week plan

New module `js/organiser.js`, pure functions at the top like
[js/schedule.js](../js/schedule.js), so it can be exercised from the console.

```
planWeek(startDate, { medicines, schedules, slots })
```

Seven days forward from `startDate`, per medicine, from `schedule.isDueOn` —
**not** from snapshots, which only exist for past days and are the wrong source
for a forward-looking screen.

Returns three things:

- `steps` — one per medicine that goes in the box: the medicine, its cells
  (`{ date, slotId, qty }`), and the week's total.
- `compartments` — the same data pivoted: one per (date, in-box slot), holding
  what belongs in it and how much. The check screen reads this.
- `outOfBox` — everything due this week that is not going in the tray, each with
  **its own reason**, because there are two and they are not the same thing:
  a liquid or an inhaler is taken from the packet, whereas a tablet whose slot
  is unticked is out because of how this household's box is shaped. One strip,
  two sentences.

A cell that is not due renders as a muted dash, distinct from a due cell that
has not been filled yet, which renders empty. Without that a weekly medicine's
five blank days read as work outstanding.

`startDate` defaults to today, with a date picker. People fill on the day they
happen to have time, not on a fixed weekday.

---

## 19 — The step screen

Route `#/organiser`, with the step in the query string — `?step=3` — because
`router.currentQuery()` already exists and putting it there gets the back button
for free.

**Step state must not live in a `let` inside the view.** Realtime, the midnight
check and the supporter's poll all call `router.refresh()`; a step index in a
local variable would send someone back to medicine one with both hands full.
The step is in the hash and everything else is in the store, so a re-render
rebuilds exactly where the person was.

Step 0 is the start: which week, the wake lock, the out-of-box strip, and how
many medicines this will be. Steps 1..N are one medicine each — packet photo,
name and strength, purpose line, the total to take out, and the day × slot grid.
Step N+1 is the check screen.

Each step also carries **"I don't have enough"** (item 22), next to the total,
because that is the second the person discovers it.

Session state — the frozen plan, the week start, and which steps are done —
lives in a new IndexedDB store `organiser`, keyed by the week-start date.
`DB_VERSION` goes 2 → 3; `upgrade()` is version-agnostic and only ever creates
missing stores, which is fine for adding one and is why v3-plan called new
stores free.

The store is local and never syncs. A half-filled tray is a fact about one
sitting on one device, and two people filling the same tray from two phones is
not a thing that happens.

---

## 20 — The check screen

The same grid, **with counts instead of dots**. Counting is how a filled tray is
actually verified, and pill colour is unknowable from a photo — ui.md already
says the fallback tile is a stable marker and not a guess at the real colour,
and that "anywhere the real identity would matter — checking a filled organiser
— the UI counts instead of colouring." This is that place.

Tapping a compartment lists what belongs in it at full tile size, so a
discrepancy can be resolved rather than just noticed.

No pass/fail, no tick, no score. The screen shows what should be in each
compartment; the person compares. An app that cannot see the tray must not claim
the tray is correct.

---

## 21 — Wake lock

`navigator.wakeLock.request('screen')` on entering the organiser, released in
the view's cleanup. Re-requested on `visibilitychange` when the page becomes
visible again, because the lock is dropped automatically when the tab hides.

Feature-detected and wrapped: it rejects outright on low battery, and it is
absent entirely on older browsers. A failure is silent — there is nothing useful
to say, and the screen still works, it just dims. iOS has it from 16.4, the same
floor web push already requires, so the setup docs need no new caveat.

---

## 22 — The buy list

`0012_buy_list.sql`:

```sql
create table public.buy_list (
  household_id uuid not null references public.households(id) on delete cascade,
  medicine_id  uuid not null,
  added_at     timestamptz not null default now(),
  added_by     text not null check (added_by in ('patient','supporter')),
  primary key (household_id, medicine_id),
  foreign key (medicine_id, household_id)
    references public.medicines(id, household_id) on delete cascade
);
```

Owner access through ordinary RLS on `app.my_household()`, mirrored by
`js/sync.js` (the table joins the realtime publication in the same migration).
Supporter access through three code-gated functions —
`get_buy_list` / `add_to_buy_list` / `remove_from_buy_list` — polled by
`js/supporter-sync.js` alongside everything else it already fetches. A new
`buyList` IndexedDB store on both sides.

A card above the day on **both** Today screens: "Running low", the medicines, and
a way to clear each. next-steps.md §6 is explicit that this warning belongs to
the elder rather than the supporter, because a supporter abroad cannot buy
medicine locally — but the supporter needs to see it too, so they know to ask.

Either role can clear an entry. Whoever bought it clears it, and which of them
that was is not information worth keeping.

No push, per the decision above. The card is the delivery mechanism.

---

## Order of work

Each is a commit.

1. **23 — medicine details.** Migration, the six threading points, the form
   field, the packet photo, `kind` on `supporter-photo`, the sheet. Nothing
   organiser-shaped exists yet; this is the foundation it needs.
2. **18a — the box setting.** Column, `set_slot_in_box`, the Settings section in
   both roles.
3. **18b — `js/organiser.js`.** Pure, no UI, testable from the console.
4. **19 + 21 — the step screen and the wake lock.** Together because the wake
   lock is six lines and belongs to the same view's lifecycle.
5. **20 — the check screen.**
6. **22 — the buy list.** Migration, both access paths, the card, the button on
   the step screen.
7. **Docs.** Every file listed under [Docs to update](#docs-to-update) below,
   in one pass, plus this file's own record of what departed from the plan.

Steps 1 and 2 are backend-and-plumbing with small visible surfaces; 3 to 6 are
where the phase actually is.

**Why the docs are their own commit and not folded into the six.** Half of
what needs writing is not knowable until the screens exist — Flow 4 cannot be
rewritten from a plan, only from a tray that has actually been filled, and the
interesting content of these files has always been what the work turned up
rather than what was intended. Phases 0–2 are the evidence: every "found while
building it" note in [v3-plan.md](v3-plan.md) would have been lost if the docs
had been written commit by commit.

The risk is the obvious one — a docs commit at the end is a docs commit that
gets skipped. Two things against that: it is a numbered item here rather than
an intention, and each of the six commits leaves a note in this file as it
lands, so the last commit is transcription rather than recall.

## Risks

**The `dosage` conversion is irreversible.** It is the only place in this phase
where existing data changes shape. Pre-flight `select`, read the rows, then run
it.

**Two migrations touch `compute_day`.** 0011 adds fields to it. Nothing in 0012
does, but a third change to that function during the phase would be a signal to
stop and look at why.

**`isCurrent()` applies here more than anywhere.** The organiser is a long-lived
screen with awaits in it, on a device that is being refreshed by realtime, a
poll, and a midnight timer. Every await in every organiser view checks it before
touching the DOM — see architecture.md, "Rendering: one screen at a time".

**The check screen must not become a verdict.** The temptation to add a "looks
right" tick will be strong the moment it is on a real phone. The app cannot see
the tray.

**Nothing here may reach the dose log.** Worth grepping `js/doses.js` callers at
the end of the phase to confirm the organiser is not among them.

## Docs to update

Commit 7. Listed here rather than in the order of work because the list is
long and the ordering is not interesting.

- **flow.md** — Flow 4 currently says a screen for this "is planned" and points
  at v3-plan. It becomes a real flow. Flow 2 gains the pill box setting; the
  "what can go wrong" table gains the buy-list card.
- **ui.md** — the organiser screens, the step-counter-is-not-adherence rule, and
  the packet photo's place next to the pill tile.
- **architecture.md** — `dose_qty` replacing `dosage`, the two new stores, the
  frozen-plan rule, and the buy list's two access paths.
- **repo-structure.md** — `js/organiser.js`, `js/views/organiser.js`, the new
  migrations.
- **next-steps.md** — §6's refill item is answered; strike it.
- **v3-plan.md** — Phase 3 marked done, with what departed from the plan.

## Explicitly out of this phase

- **Notifying the supporter of a shortage.** Item 24, Phase 4, one thread with
  25 and 26.
- **Stock or pill counting of any kind.** The buy list records "I am short of
  this", not how many are left. next-steps.md §6 already rejected counting down
  doses as the wrong model.
- **Any record of past sittings.** The organiser store holds the current week and
  is overwritten. A history of when the tray was filled is one step from a
  streak.
- **Configuring the tray beyond which slots go in it.** No compartment counts,
  no custom layouts, no half-width Sunday. If a real box does not fit, that is
  worth learning from use rather than guessing at now.
