# Medicine Tracker: Next Steps

Everything deliberately deferred from v1. Ordered roughly by value. Nothing here blocks the v1 build.

> **Done: §1 (Reminders), §2 (Two-way sync), §3 (Skip and partial doses).**
>
> §1 and §2 shipped together as the online-sync rearchitecture — see
> [architecture.md](architecture.md) and `supabase/migrations/0001_init.sql`.
> §3 shipped in v3 — see below and [v3-plan.md](v3-plan.md).
>
> All three are left in place for the reasoning, not the plan: the
> ntfy-can't-reach-a-phone diagnosis and the snapshot/doseLog asymmetry still
> explain *why* the shipped design looks the way it does.

---

## 1. Reminders

> **Historical.** This section is the diagnosis, not the design. Reminders
> shipped as Web Push (the second option in the table below), not ntfy, and
> the ladder has since grown a follow-up and a nightly catch-all. For what the
> app actually sends today — timings, wording, configuration, and how to debug
> a reminder that never arrives — see **[notifications.md](notifications.md)**.
> Kept because the ntfy-can't-reach-a-phone finding is still why the shipped
> design looks the way it does.

Deferred because there was no delivery path, not because it was low priority. This is pain point number one and should be the first thing picked up after v1 ships.

### The blocker

**ntfy cannot reach a phone without the ntfy app installed on that phone.** On iOS it reaches a device only through the ntfy iOS app via APNS. Posting to a topic with an `X-At` header is visible in ntfy's web UI and reaches nobody otherwise. There is nothing to "wire up later" without this.

Work starts by choosing one of these three:

| Option | Requires | Cost |
|---|---|---|
| **ntfy app on the elder's phone** | Supporter walks the elder through installing it and subscribing to the topic, remotely or in person | Free. Keeps the current architecture intact |
| **Web push with VAPID** | A server holding the private key, plus a scheduler such as a GitHub Actions cron or a Cloudflare Worker cron. Also needs the PWA on the home screen, which is already required on iOS | Free tier on both |
| **SMS or WhatsApp** | A paid messaging API and a server | Paid |

### If ntfy is chosen

Three bugs were already identified during planning. Build these in from the start rather than rediscovering them.

1. **Only `simple` mode may top up the queue.** The topic is shared between both devices and the dedup set is device-local, so a supporter opening their app would post duplicates of reminders the elder's device already posted.
2. **The dedup key must be `date|slotId|time`, not `date|slotId`.** Otherwise changing a slot's time is deduped away: no new reminder is posted, and the old one still fires at the old time.
3. **Queue 24 to 36 hours, not the 72 hours ntfy allows.** There is no ntfy API to cancel or replace a scheduled message, so queue depth is exactly how long a stale reminder outlives a schedule edit.

### Constraints to carry forward

- Maximum scheduled delay on ntfy.sh is 3 days. Minimum is 10 seconds.
- **Never put medicine names in the notification body.** ntfy.sh topics are unauthenticated and anyone who knows the topic can read it. Send only "Time for your morning medicines" and let the user open the app.
- If the app is not opened for more than 36 hours the queue runs dry and reminders stop until it is reopened. Surface this as a calm line in Settings, never a blocking dialog.
- Every network call wrapped. Reminder failure must never throw or block the app.
- Test delivery timing on a real device early. A reminder scheduled for 6am that arrives at 7:15 changes which ntfy build the setup guide should recommend.

### Data model additions

- `queuedReminders` store: `{ key: "2026-08-29|morning-slot-id|08:00", postedAt }`, pruned after 7 days.
- A pairing code, dropped from v1 as `refCode`, returns here. One code per supporter and elder pair, for example `MT-4F7K-2Q9X`, generated on the supporter's first run, carried in the export file, displayed in both apps. The ntfy topic derives from it: `medtrack-` plus the code lowercased with dashes stripped. Neither user ever sees the word "topic".
- `settings` gains `remindersEnabled` and `lastReminderOk`.

---

## 2. Two-way sync

Elder exports back to the supporter so the supporter can see adherence without asking. This is what made snapshots complicated in v2 and needs designing carefully rather than bolting on.

**The trap.** Snapshots are device-local truth, but `doseLog` would be merged across devices. Pairing the supporter's own snapshots with the elder's imported dose rows produces wrong ratios, for example showing 2 of 5 taken when the elder's device correctly recorded 3 of 3.

**Simplest fix.** Only the elder's device ever writes snapshots. A reverse import carries the snapshots along with the dose log, so the supporter renders the elder's expectations rather than recomputing its own.

Depends on: restoring Today and Calendar to supporter mode, which were cut from v1 precisely because there was nothing to show.

---

## 3. Skip and partial doses — DONE (v3)

Shipped in migration `0005_skipped_doses.sql` and the v3 Today screen. How the
open questions were answered:

- Not a Skip toggle but a **cycling target**: unmarked → taken → skipped →
  unmarked. One tap for the common case.
- **Done marks only what is unmarked**, so a deliberate skip survives it.
- **Undo on a slot does clear skips** — it means "put this back to untouched",
  and leaving amber behind would make the button depend on invisible history.
- **A skip can be reversed on its own**, by cycling, and reaching `skipped`
  raises a toast offering the way straight back.
- **Calendar's third state** is arc colour, not arc length: a skipped dose
  fills the ring as a taken one does, and the ring turns amber. Shortening it
  would read as a mark against the person.

---

## 4. Pakistani medicine autocomplete — planned for v3 Phase 4

The thing that would make the app meaningfully local rather than a generic tracker.

Scrape the DRAP registered drugs list into a static JSON file served from the repo. The supporter types "Augm" and picks "Augmentin 625mg tablet" instead of typing name, strength and form by hand. Removes the most tedious part of setup and the most likely place for a typo.

No backend needed. It is a static file loaded on demand in supporter mode only, so it never costs the elder anything. Watch the file size and consider splitting by first letter if it gets large.

---

## 5. Urdu

The strings file exists from v1, so this is translation plus layout work rather than refactoring.

Consider: right-to-left layout, whether numerals should be Urdu or Latin, and whether medicine names entered by the supporter should stay in English regardless of interface language, since that is how the packaging reads.

---

## 6. Smaller items

- **PRN and as-needed medicines.** No fixed schedule, logged when taken. Needs a separate section on Today, since it does not belong to any slot.
- ~~**Refill and stock tracking.**~~ **Decided against, in Phase 3.** It was
  planned as item 22 — "I don't have enough" while filling the organiser,
  adding to a shared buy-list — on the reasoning that filling the tray is the
  one moment the information exists. That reasoning still holds. What does not
  is the assumption that knowing you are short tells anyone when to buy:
  households differ on how far ahead they stock up, some have a relative who
  visits monthly and buys everything then, and an elder often cannot say when
  a refill is due either. An app that surfaced "running low" would be guessing
  at a decision the people involved make on information it does not have. Left
  to them. Nothing was built.
- **Multiple patients per supporter install.** For a caregiver looking after two parents.
- **Editing a logged dose's timestamp.** Currently `takenAt` is whenever the dose was marked, which is wrong if it was taken earlier. On a skipped row it means "when this was recorded", which the column name does not say.
- **Unlocking older days.** v1 freezes everything on or before the last import, so an error more than one import old cannot be corrected. Consider a supporter-side override.
- **Automated tests.** Browser-based, not Node, so the no-build-step and no-`package.json` constraint holds. Worth it if `js/schedule.js` grows beyond the three frequency types. Phase 2.5 raised the case for them: several of its bugs were invisible from reading the code and only showed up by counting DOM nodes, and a handful of those checks would make good regression tests.
- **Teach the outbox the difference between "rejected" and "offline".** Both look identical to its catch, so a permanently rejected write — one aimed at a locked day — retries forever and the person sees a tick that never syncs. Phase 2.5 removed the main way to *generate* such a write (the date is re-checked at midnight now), but the retry loop itself is still there. Worth doing if one is ever actually observed.
- **Detached-fragment rendering for all views.** Phase 2.5 numbered renders and made views check `isCurrent()` after each await, which guards the two-copies-of-a-screen bug. Building every view into a fragment the router swaps in would make it unrepresentable instead. Bigger change; revisit if a fourth screen wants it.
- **Install prompt on Android.** If the user base ever extends past iOS, `beforeinstallprompt` gives a real install button instead of the manual Add to Home Screen walkthrough.

---

## 7. Explicitly not planned

Recorded so these do not get reopened without a reason.

- **Drug interaction checking or any clinical logic.** This is a memory aid. Anything that reads as medical advice changes the liability profile and the design entirely.
- **Adherence scores, streaks, gamification.** The app must never read as judgement of an elderly person's behaviour.
- ~~**Accounts, login, cloud database.**~~ Reversed: this shipped. The file-based hand-off turned out to be the limitation, not the architecture — see [architecture.md](architecture.md).
- **Adherence aggregates of any kind**, on either device. The supporter sees the same rings the elder does and nothing that sums them up. Parity makes this tempting to build; it is still a no.
