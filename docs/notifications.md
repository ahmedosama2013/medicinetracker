# Notifications

Every push the app sends: when it fires, what it says, and why it says it that
way. For backend setup (VAPID keys, deploying the function, the cron entry) see
[setup.md](setup.md). For the data model underneath, see
[architecture.md](architecture.md).

Everything here is **Web Push (VAPID)**. There is no SMS, no email, no in-app
banner, and no client-side timer — a phone with the app closed is reached by
the push service or not at all.

## The ladder

All three rungs go to the elder's own devices, and only if reminders are on
(Settings, elder mode).

| Rung | Fires | Condition | Names a slot? |
|---|---|---|---|
| **Stage 1** | the slot's own time | any medicine in the slot is unmarked | yes, in the title |
| **Stage 2** | slot time **+ `followup_after`** (1 h default) | still unmarked, and the fire moment is before `nightly_summary_time` | yes, in the title |
| **Nightly** | **`nightly_summary_time`** (23:50 default) | any medicine in any of the day's due slots is unmarked | no |

**"Marked" means a `dose_log` row exists — `taken` and `skipped` both count.**
Deciding not to take something is an answer, and chasing it would be the app
arguing with a decision already made.

**Any one medicine outstanding fires the whole slot.** A slot with two
medicines where one is marked still reminds. Slot-level is the only
granularity; there is no per-medicine reminder.

### Worked examples

E1 — Morning 09:00 (2 medicines), Night 21:00 (3 medicines), nothing marked:

```
09:00  stage 1   "Morning medicines"
10:00  stage 2   "Morning medicines"
21:00  stage 1   "Night medicines"
22:00  stage 2   "Night medicines"
23:50  nightly   "Before the day ends"      <- one per day, not per slot
```

E2 — Morning 10:00, Night 22:00, nothing marked:

```
10:00  stage 1
11:00  stage 2
22:00  stage 1
23:00  stage 2
23:50  nightly
```

Marking everything at any point stops every rung after it. Marking the morning
but not the night still produces the nightly message.

### Two deliberate edges

**The nightly message is not suppressed by a recent stage 2.** E2 above gets
three notifications between 22:00 and 23:50. The first two are about one slot;
the last is about the day. Someone who has marked everything gets none of them.

**Stage 2 is dropped if it would land at or after `nightly_summary_time`.** A
23:00 slot would otherwise follow up at midnight — on the next calendar day,
for a dose belonging to yesterday. The nightly message covers that slot
instead. The cutoff applies to stage 2 only: a slot timed 23:55 still gets its
stage 1, because suppressing a reminder at its own due time would be wrong.

## The wording

**All copy lives in one file:
[`supabase/functions/_shared/messages.ts`](../supabase/functions/_shared/messages.ts).**
Nothing else in the backend contains display text.
[`js/strings.js`](../js/strings.js) is the equivalent for the app's own
screens; push bodies are separate because they are built server-side in Deno
and never reach the browser.

Four rules govern that file, stated in full at the top of it:

1. **Never name a medicine.** Every string travels through a third-party push
   service and lands on a lock screen anyone nearby can read. Slot labels are
   fine — "Morning" identifies nothing about a person's health.
2. **Say "marked", never "taken".** The app cannot distinguish a missed dose
   from one taken and not ticked. Wording that assumes the former accuses
   someone of forgetting when they did not.
3. **The slot name goes in the title, never the body.** Labels are stored
   capitalised and are supporter-editable, so `your ${label} medicines` renders
   as "your Morning medicines", and would mangle "After Breakfast" or a
   non-English label later.
4. **Variant choice must be deterministic.** Each rung has three wordings
   picked by a stable hash of the notification's identity, so the words vary
   day to day but a delivery retry re-sends byte-identical text. Random
   wording would make attempt two read as a second, separate reminder.

Titles carry the moment (`Morning medicines`, `Before the day ends`) rather
than the constant `Medicine Tracker`, so a lock screen reads without
expanding. The app name is already in the icon and the notification's app
attribution.

## Timing configuration

Two columns on `households`, added by
[`0013`](../supabase/migrations/0013_notification_timing.sql):

| Column | Default | Meaning |
|---|---|---|
| `followup_after` | `1 hour` | how long after the slot's time stage 2 fires |
| `nightly_summary_time` | `23:50` | the nightly message's local time, **and** the stage-2 cutoff |

**SQL-only by design — there is no UI and no `grant update`.** Same reasoning
as `lock_lag_days`: a knob worth having and not worth a settings screen. The
elder's Settings stays a single on/off switch. To change one:

```sql
update public.households set followup_after = '90 minutes' where id = '...';
```

Three fire windows remain function arguments in `app.claim_due_notifications`
and `app.claim_daily_summary`, because they are properties of the job rather
than of a household: `p_grace` (30 min, how long stage 1 stays eligible),
`p_followup_grace` (20 min), `p_window` (20 min, the nightly message's), and
`p_retry` (4 min delivery backoff).

**Invariant Postgres cannot check: `p_grace` must stay well below
`followup_after`.** With a 45-minute grace and a 60-minute follow-up, a stage 1
firing late at 09:44 is chased by stage 2 at 10:00 — two buzzes sixteen minutes
apart. Raise one, raise the other.

## Why stage 2 does not depend on stage 1

[`0004`](../supabase/migrations/0004_second_reminder.sql) originally required
stage 1 to have an actual `sent_at` before stage 2 could fire: no first
message, nothing to follow up on.
[`0014`](../supabase/migrations/0014_followup_from_slot_time.sql) removed that.

The case it got wrong is the common one. Someone installs the app, taps through
Settings and turns reminders on at 09:05. Their 09:00 slot has already passed
its grace window, so stage 1 never fires — and under the old rule stage 2 never
fired either, so their first day produced no reminder at all for a dose sitting
unmarked. **If you are tempted to restore the dependency as a bug fix: that is
the bug.**

`0014` also moved the anchor from stage 1's delivery time to the slot's own
time, so the follow-up no longer inherits stage 1's lateness.

## Machinery

```
pg_cron  medtrack-push, every 5 minutes
   │
   └── net.http_post -> supabase/functions/send-reminders
          │
          ├── rpc claim_due_notifications   -> stage 1 + stage 2 rows
          │     └── rpc mark_notification_sent      per delivered row
          ├── rpc claim_daily_summary       -> nightly rows
          │     └── rpc mark_daily_summary_sent     per delivered row
          └── rpc disable_push_subscription  on a 404/410 from the push service
```

Both claims are **claim-then-send**: the row is inserted (or its `attempts`
bumped) inside the claim, so two overlapping cron runs cannot double-send. A
send that fails leaves `sent_at` null and the row is reclaimed by a later run,
up to 3 attempts with a 4-minute backoff.

The two claims are independent — one failing does not skip the other, and both
errors are reported together in the function's response.

Dedup keys:

- slot reminders — `app.notification_sends (household, local_date, slot_id, slot_time, stage)`.
  `slot_time` is in the key so **editing a slot's time re-arms that day's
  reminders**; a supporter moving Morning from 09:00 to 10:00 at 09:30 can
  produce two stage 1s.
- nightly — `app.daily_summary_sends (household, local_date)`. Its own table,
  not a synthetic slot in `notification_sends`, so it can never satisfy a stage
  lookup by accident.

The "is anything unmarked" test is one function,
`app.unlogged_slots(household, date)`, shared by all three rungs.

## Platform reality

| | Works in a browser tab? | Notes |
|---|---|---|
| **Android** (Chrome, Firefox, Samsung Internet) | yes | Installing to the home screen is still more reliable — survives the browser being swept from recents |
| **iOS/iPadOS 16.4+** | **no** | The app **must** be installed to the home screen. In a Safari tab, push does not exist |
| **Desktop** | yes | — |

Two Android caveats that look like bugs:

- **Android 13+ requires the browser app itself to have OS notification
  permission.** If that was dismissed at install, the site's permission is
  granted at the web layer and notifications still never render. Nothing in the
  app can detect this.
- **Doze can delay delivery** on an idle phone. Combined with the 30-minute
  `p_grace`, a deeply sleeping phone can miss a slot's stage 1 entirely rather
  than getting it late.

**Notifications are per device, not per person.** An elder with a phone and a
tablet, both subscribed, gets every notification twice. `push_subscriptions` is
keyed on endpoint.

## Why isn't a reminder arriving?

Six distinct causes, indistinguishable from the outside. In rough order of
likelihood:

1. **Reminders are off, or the browser subscription and the server row
   disagree.** Settings reports the *server* state deliberately, so a failed
   save shows as "off" rather than a lie. Toggle off and on.
2. **The `medtrack-push` cron does not exist.** `db push` does not create it —
   it needs the service-role key and is a manual step
   ([setup.md §7](setup.md)). Check with `select * from cron.job;`.
3. **VAPID secrets are missing or malformed.** The function answers
   `push not configured: ...` rather than dying — check
   `supabase functions logs send-reminders`.
4. **iOS without the home-screen install**, or **Android 13+ with the browser
   denied OS notification permission**.
5. **The slot is already marked**, including marked `skipped`, or its grace
   window has passed (more than 30 minutes late for stage 1).
6. **The subscription was auto-disabled** after a 404/410 — the endpoint died
   with the old install. `disabled_at` is set; toggle reminders off and on.

Confirm what the database thinks before blaming delivery:

```sql
select * from app.claim_due_notifications();
select * from app.claim_daily_summary();
```

Both are claim-and-return: calling them consumes the row. Fine on a test
household, not on a live one.

## The supporter's nudge

One button on the supporter's Today screen
([`supabase/functions/nudge`](../supabase/functions/nudge/index.ts)), replacing
a phone call. Manual, supporter → elder, rate limited **server-side** to one
per household per 15 minutes via `households.last_nudge_at` — a worried
relative tapping four times must not produce four buzzes, and client-side
limiting is a suggestion rather than a limit.

It reports "sent", "cooling down" (with minutes), "they never turned reminders
on", and "delivery failed" as distinct outcomes, because a silent `sent: 0`
would let the supporter assume the message arrived and was ignored.

## Not built: supporter escalation

An automatic "E1 hasn't marked their morning medicines" to the supporter after
a few hours is **deliberately absent**, and it is not a missing message — it is
structurally impossible today:

- `push_subscriptions.user_id` is `not null references auth.users(id)`
- RLS `push_own` requires `user_id = auth.uid() and household_id = app.my_household()`
- **a supporter device has no Supabase session at all** — that is the whole
  architecture (see [architecture.md](architecture.md))

So every push row in a household belongs to the elder's own account, and both
senders filter on `household_id`. Adding supporter escalation needs a
code-gated `SECURITY DEFINER` registration path (matching how every other
supporter write works), an audience column so a sender can target
elder-only vs supporter-only, and a widened `stage` check — currently
`check (stage in (1, 2))`.

It would also be the first notification body naming a person. Both current
bodies avoid identifying anything at all; a supporter's phone naming the elder
is a different risk from the elder's phone naming a drug, but it breaks a
stated invariant and should be a decision, not a side effect.

Relatedly, the app has **no concept of "my elders"**: a supporter device holds
exactly one `supporterCode`, and pairing with a second household replaces the
first. Elders have unlimited, unidentified, uncounted supporters — anyone
holding the code.
