# Medicine Tracker: Next Steps

Everything deliberately deferred from v1. Ordered roughly by value. Nothing here blocks the v1 build.

> **§1 (Reminders) and §2 (Two-way sync) are done.** Both shipped together as the online-sync rearchitecture — see [docs/architecture.md](architecture.md) and `supabase/migrations/0001_init.sql`. Left below for the historical reasoning (the ntfy-can't-reach-a-phone diagnosis and the snapshot/doseLog asymmetry both still explain *why* the shipped design looks the way it does).

---

## 1. Reminders

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

## 3. Skip and partial doses

Cut from v1 to keep logging binary. Restoring it means:

- `doseLog.status` widens from `"taken"` to `"taken" | "skipped"`.
- A small Skip toggle per medicine card on Today, logging that medicine immediately.
- Done then logs `taken` for every medicine in the slot not already logged.
- Decide explicitly whether Undo on a slot also removes skip rows created before Done was tapped, and whether a skip can be reversed on its own.
- Calendar rings need a third state, since a fully-skipped slot is neither complete nor untouched.

---

## 4. Pakistani medicine autocomplete

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
- **Refill and stock tracking.** Count down remaining doses, warn the supporter when a medicine is running low.
- **Multiple patients per supporter install.** For a caregiver looking after two parents.
- **Editing a logged dose's timestamp.** Currently `takenAt` is whenever Done was tapped, which is wrong if the dose was taken earlier.
- **Unlocking older days.** v1 freezes everything on or before the last import, so an error more than one import old cannot be corrected. Consider a supporter-side override.
- **Automated tests.** Browser-based, not Node, so the no-build-step and no-`package.json` constraint holds. Worth it if `js/schedule.js` grows beyond the three frequency types.
- **Install prompt on Android.** If the user base ever extends past iOS, `beforeinstallprompt` gives a real install button instead of the manual Add to Home Screen walkthrough.

---

## 7. Explicitly not planned

Recorded so these do not get reopened without a reason.

- **Drug interaction checking or any clinical logic.** This is a memory aid. Anything that reads as medical advice changes the liability profile and the design entirely.
- **Adherence scores, streaks, gamification.** The app must never read as judgement of an elderly person's behaviour.
- **Accounts, login, cloud database.** The file-based hand-off is the architecture, not a limitation being worked around.
