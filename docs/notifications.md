# Notifications

Every push the app sends: when it fires, what it says, and why it says it that
way. For backend setup (VAPID keys, deploying the function, the cron entry) see
[setup.md](setup.md). For the data model underneath, see
[architecture.md](architecture.md).

Everything here is **Web Push (VAPID)**. There is no SMS, no email, no in-app
banner, and no client-side timer — a phone with the app closed is reached by
the push service or not at all.

Two audiences, each opted in separately: **the elder**, from their own
Settings, and **any supporter**, from theirs — a supporter's device holds no
login of any kind, so their opt-in works through the same share-code-gated
mechanism as every other supporter write.

## The elder's ladder

All three rungs go to the elder's own devices, and only if reminders are on
(Settings, elder mode). **None of these three ever reach a supporter's
subscription**, even though both kinds of subscription now live in the same
table — see "One table, two audiences" below for why that isn't automatic.

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

## The supporter's own notifications

A supporter opts in separately, on their own device's Settings screen —
turning the elder's reminders on does not turn a supporter's on, and vice
versa. Two things a supporter can receive, both independent of whether the
elder has push turned on at all (they only read `slot_time` and
`households.followup_after`, both plain schedule data):

| Rung | Fires | Condition | Title |
|---|---|---|---|
| **Escalation** | slot time + `followup_after` (1 h) + **`escalation_after`** (per subscription: 30 m / 1 h / 2 h / 3 h, default 1 h) | still unmarked | `<elder name> — <slot label> medicines` |
| **Nightly** | same `nightly_summary_time` as the elder's | any medicine in any of the day's due slots is unmarked | `<elder name> — today's medicines` |

**`escalation_after` is per subscription, not per household**, and is the one
timing value in this whole system with a Settings UI (a fixed 4-way picker,
not freeform) rather than being SQL-only. Two people supporting the same elder
can each pick their own patience — one gets pinged after 30 minutes, another
after 3 hours, from the exact same unmarked slot, with no interaction between
them. This is why `app.escalation_sends` is keyed by `subscription_id` rather
than by household: a household-keyed table could only remember one claim per
slot and would starve whichever supporter's window opened second.

**Naming the elder is deliberate, not an oversight.** Every elder-facing
message above avoids identifying anyone — there's no one else it could be
about. A supporter-facing message is different: it's already about a specific
person, `households.display_name`, which the supporter's own Settings screen
shows them today (`Connected to: <name>`), so putting it in the title is not a
new exposure. It sits in the **title** alongside the slot label, never in the
body — same reason the elder's own copy keeps slot names out of the body
(labels are freely edited and capitalised; a title needs no grammatical
agreement).

**Escalation reaches only the household of the share code the supporter is
currently connected to**, and a supporter device holds exactly one code at a
time (see [architecture.md](architecture.md)) — supporting two elders from one
phone means two browsers, each subscribed under a different code. Nothing
here changes that limitation.

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

Plus one exception, stated separately in that file rather than folded into the
four rules above (it only applies to messages that leave the elder's own
devices): a supporter-facing message names the elder in its title, for the
reasons given above.

Titles carry the moment (`Morning medicines`, `Before the day ends`, `Mom —
today's medicines`) rather than the constant `Medicine Tracker`, so a lock
screen reads without expanding. The app name is already in the icon and the
notification's app attribution.

## Timing configuration

Two columns on `households`, added by
[`0013`](../supabase/migrations/0013_notification_timing.sql):

| Column | Default | Meaning |
|---|---|---|
| `followup_after` | `1 hour` | how long after the slot's time stage 2 (and a supporter's escalation clock) starts counting |
| `nightly_summary_time` | `23:50` | the nightly message's local time, **and** the stage-2 cutoff |

**SQL-only by design — there is no UI and no `grant update`.** Same reasoning
as `lock_lag_days`: a knob worth having and not worth a settings screen. The
elder's Settings stays a single on/off switch. To change one:

```sql
update public.households set followup_after = '90 minutes' where id = '...';
```

One more column, added by
[`0016`](../supabase/migrations/0016_supporter_push_subscriptions.sql), lives
on `push_subscriptions` itself rather than on `households` — the one exception
to "SQL-only":

| Column | Default | Meaning |
|---|---|---|
| `escalation_after` | `1 hour` | per-subscription delay past `followup_after` before a supporter's escalation fires. One of four fixed values (`30 minutes`/`1 hour`/`2 hours`/`3 hours`), set from the supporter's own Settings picker |

Three fire windows remain function arguments rather than columns, because they
are properties of the job rather than of a household or a subscription:
`p_grace` (30 min, how long stage 1 stays eligible), `p_followup_grace` /
`p_window` (20 min, how long stage 2 / an escalation / the nightly message
stays eligible once due), and `p_retry` (4 min delivery backoff).

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
time, so the follow-up no longer inherits stage 1's lateness. A supporter's
escalation clock is built the same way — anchored to the slot's own time, not
to whether stage 1 or stage 2 actually arrived — for the same reason: a
supporter can turn escalation on at any point in the day and still get caught
up correctly rather than needing an elder-side message to have already fired.

## One table, two audiences

`push_subscriptions` holds both an elder's own subscription (`role =
'patient'`) and any supporter's (`role = 'supporter'`), distinguished by the
`role` column added in
[`0016`](../supabase/migrations/0016_supporter_push_subscriptions.sql). This
was the source of a real bug, caught before it ever reached a live device and
worth restating so it isn't reintroduced: **`app.claim_due_notifications`
(the elder's own stage 1/2) and the `nudge` Edge Function's subscriber query
both originally joined `push_subscriptions` by `household_id` alone.** The
moment a supporter subscription existed, both would have started reaching it
too — the elder's own "Morning medicines" reminder landing on the supporter's
phone, and the supporter's own nudge button buzzing themselves.
[`0019`](../supabase/migrations/0019_exclude_supporter_rows_from_elder_reminders.sql)
added `role = 'patient'` to both. `app.claim_daily_summary` is correctly
unfiltered — the nightly message is the one rung meant to reach both roles,
which is why it returns `role` and `elder_name` for the caller to pick wording
from.

**Any new query against `push_subscriptions` has to decide, on purpose, which
role(s) it targets.** There is no default that's safe to assume.

## Machinery

```
pg_cron  medtrack-push, every 5 minutes
   │
   └── net.http_post -> supabase/functions/send-reminders
          │
          ├── rpc claim_due_notifications        -> elder stage 1 + stage 2 rows
          │     └── rpc mark_notification_sent           per delivered row
          ├── rpc claim_supporter_escalations     -> a supporter's own rows
          │     └── rpc mark_supporter_escalation_sent   per delivered row
          ├── rpc claim_daily_summary             -> nightly rows, both roles
          │     └── rpc mark_daily_summary_sent          per delivered row
          └── rpc disable_push_subscription        on a 404/410 from the push service
```

All three claims are **claim-then-send**: the row is inserted (or its
`attempts` bumped) inside the claim, so two overlapping cron runs cannot
double-send. A send that fails leaves `sent_at` null and the row is reclaimed
by a later run, up to 3 attempts with a 4-minute backoff.

The three claims are independent — one failing does not skip the others, and
every error is reported together in the function's response.

Dedup keys:

- elder slot reminders — `app.notification_sends (household, local_date, slot_id, slot_time, stage)`.
  `slot_time` is in the key so **editing a slot's time re-arms that day's
  reminders**; a supporter moving Morning from 09:00 to 10:00 at 09:30 can
  produce two stage 1s.
- supporter escalation — `app.escalation_sends (subscription_id, local_date, slot_id, slot_time)`.
  Keyed by `subscription_id`, not `household_id`, precisely because two
  supporters on the same household can each pick a different
  `escalation_after` and so become eligible for the same slot at genuinely
  different times.
- nightly — `app.daily_summary_sends (household, local_date)`. Its own table,
  not a synthetic slot in `notification_sends`, so it can never satisfy a stage
  lookup by accident. One row regardless of how many subscriptions (of either
  role) end up receiving it.

The "is anything unmarked" test is one function,
`app.unlogged_slots(household, date)`, shared by all three rungs of the elder
ladder and by the supporter's escalation query.

## Platform reality

Applies equally to both an elder's device and a supporter's — none of this is
specific to which role is subscribing.

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
keyed on endpoint. The same is true for a supporter with two devices.

## Why isn't a reminder arriving?

Several distinct causes, indistinguishable from the outside. In rough order of
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
   with the old install. `disabled_at` is set; toggle notifications off and on.
7. **(Supporter only) their own toggle is off**, independent of the elder's —
   or their chosen `escalation_after` simply hasn't elapsed yet.

Confirm what the database thinks before blaming delivery:

```sql
select * from app.claim_due_notifications();
select * from app.claim_supporter_escalations();
select * from app.claim_daily_summary();
```

All three are claim-and-return: calling them consumes the row. Fine on a test
household, not on a live one.

## The supporter's nudge

One button on the supporter's Today screen
([`supabase/functions/nudge`](../supabase/functions/nudge/index.ts)), replacing
a phone call. Manual, supporter → elder, rate limited **server-side** to one
per household per 15 minutes via `households.last_nudge_at` — a worried
relative tapping four times must not produce four buzzes, and client-side
limiting is a suggestion rather than a limit. Unlike everything above, this is
not automatic — it is the one push a supporter *sends* rather than *receives*,
and it targets only `role = 'patient'` subscriptions (see "One table, two
audiences") so a supporter never buzzes their own phone by pressing it.

It reports "sent", "cooling down" (with minutes), "they never turned reminders
on", and "delivery failed" as distinct outcomes, because a silent `sent: 0`
would let the supporter assume the message arrived and was ignored.

## Still not built

**Multiple elders from one supporter device.** A supporter still holds exactly
one share code at a time; supporting two parents means two browsers, each
connected under a different code. Considered and deliberately deferred rather
than built — see [architecture.md](architecture.md) for the one-code-per-device
model this would need to change.

**Anything besides push.** No SMS/email fallback, no in-app banner for someone
who has push turned off, no digest or daily summary email for a supporter who'd
rather not get real-time pings.
