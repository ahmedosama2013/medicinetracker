# User flow

Everything the two people actually do, start to finish. This is the only file that describes the flows; other docs link here.

---

## The two people

| | **Supporter** — the person helping | **Simple** — the person taking the medicines |
|---|---|---|
| Their phone shows | Today, Calendar, Medicines, Settings | Today, Calendar, Settings |
| Account | None — just a code | Signs in with Google, once |
| They do | Add medicines, photos and times; check what was taken | Mark doses taken or skipped, check photos |
| How often | At setup, then whenever they want to check in | Every day |

Two phones, two installs. Data moves **live**: anything the supporter adds or changes reaches the elder's phone within a few seconds, automatically. No file to export, send, or import.

The app asks *"Who uses this phone?"* on first run. That answer is changeable at any time in Settings.

---

## Before you start

**Reminders exist, but need turning on.** The app can send a gentle push notification when it's time for medicines that haven't been marked done — see Flow 5. Until that's turned on, nothing happens unless someone opens the app.

---

## Flow 1 — The elder sets up (once, ~5 minutes)

```
Open in Safari  →  Add to Home Screen  →  "I take the medicines"  →  Sign in with Google
```

1. Open https://umerbutt.github.io/Medicine-Tracker/ in **Safari**. (Not Chrome — on iOS only Safari can install to the home screen.)
2. Tap **Share** — the square with an arrow pointing up, in the bottom toolbar.
3. Scroll down, tap **Add to Home Screen**, then **Add**.
4. Open the app from the home screen icon. It asks who uses this phone → **"I take the medicines"** → **Sign in with Google**.
5. Once signed in, the screen shows **your code** — a short one, like `4F7K2Q` — because until a supporter enters it there is nothing else to show. Read it out to whoever is helping you. It is also always in **Settings**.

## Flow 2 — Supporter connects (once, ~15 minutes)

```
Open in Safari  →  Add to Home Screen  →  "I help someone…"  →  Enter the code  →  Add medicines
```

Usually walked through over the phone, with the elder reading out their code.

1. Open https://umerbutt.github.io/Medicine-Tracker/ in **Safari**.
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Open the app from the home screen. Answer **"I help someone with their medicines"**.
4. Enter the code from the elder's Settings screen, then **Connect**. No account, no sign-in — the code is enough.
5. *Optional:* Settings → **Times of day**, to change what time morning, afternoon, evening and night mean, or to add your own.
6. **Medicines** → **Add a medicine**, for each one:
   - Name, strength, how much to take, and the form.
   - **Take a photo** of the actual pill. This is the part that matters — it is how the pills get identified when the weekly organiser is refilled.
   - Notes if useful, e.g. "take with food".
   - **When to take it** — one or more times. Pick the time of day, optionally override its time for this medicine, and choose every day / every few days / certain days of the week.
   - **Save.** A medicine with no times set cannot be saved: it would appear on no screen and you would never notice.

That's it — nothing to send. Everything just added appears on the elder's **Today** screen within a few seconds.

## Flow 3 — Every day

```
Open the app  →  see the day  →  tap a medicine to check the photo  →  tap Done
```

1. Open the app. **Today** shows the whole day, grouped by time of day, in the same order every day: morning at the top, night at the bottom. Nothing is hidden and nothing moves as the day goes on. A small **Now** label marks whichever group's time has most recently passed.
2. To check a pill, tap it. A panel opens with its photo, how much to take, any notes, and every time of day it is due. Tap the photo to see it full screen.
3. Mark each medicine with the circle on its right, or tap **Done** once to mark the whole group. Either way the group turns green and folds up into a row of photos — tap that row to open it again.
4. Tapped by mistake? The button now says **Undo**. Tap it.

**Not taking one?** Tap its circle twice: once for taken, again for skipped. It turns amber and the name is crossed out, and a message offers to put it back. Skipping is recorded, not a failure — nothing in the app treats it as one. **Done** never overrides a medicine you have deliberately skipped.

A group whose time has already passed is still there and can still be marked. Nothing expires at midday. This works even with no signal — see "What can go wrong" below.

If your helper marked something for you, that medicine says **Marked by your helper**.

## Flow 4 — Filling a weekly pill organiser

The photos exist for this.

1. Open **Today**.
2. For each medicine in a group, tap it, then tap the photo to fill the screen, and match it against the packet in hand.
3. Close and move to the next.

A screen built specifically for this — one medicine at a time, the whole week at once, so each box is only opened once — is planned. See Phase 3 in [v3-plan.md](v3-plan.md).

## Flow 5 — Turning on reminders

```
Elder's Settings  →  Reminders  →  Turn on  →  allow notifications
```

1. On the elder's phone, **Settings** → **Reminders** → **Turn on**.
2. The phone will ask for permission to send notifications — allow it.
3. From then on, a notification like *"Time for your evening medicines"* arrives if a slot's time passes with something still unmarked. It never names the medicine, for privacy.
4. If it's still unmarked about 45 minutes later, one follow-up arrives (*"Still time for your evening medicines"*) — and only one. Marking it done any time before or after either notification stops both.

On iPhone this needs the app to have been added to the home screen (Flow 1, step 3) and iOS 16.4 or later — both already true if setup was followed as written.

## Flow 6 — Checking the record

1. Tap **Calendar**. Each day carries a ring: filled when everything was dealt with, part-filled for some, hollow for nothing, and no ring at all on a day with nothing due. The ring is amber instead of green if anything that day was skipped.
2. Chevrons move a month at a time; tapping the month name jumps to any month and year.
3. Tap a day to see what was due and mark anything missed.

Two days cannot be edited: days in the future, and days from a couple of days ago or further back (those are kept as a record — a nightly job freezes them). No scores, streaks or percentages appear anywhere.

## Flow 7 — The medicines change

Supporter: **Medicines**, edit, add, or **Archive** anything stopped. Archiving keeps the history of what was already taken. That's the whole flow — the change reaches the elder's phone on its own.

- **The record of doses already taken is never touched.**
- Days already frozen (Flow 6) keep showing what was actually expected at the time, not the updated routine.

## Flow 8 — New phone, or reinstalling

Nothing to restore by hand. The medicines, schedule, and dose history all live on the server, not just on the phone.

- **Elder:** install the app, answer **"I take the medicines"**, sign in with the same Google account. Everything comes back — same household, same code (unless it's been rotated since).
- **Supporter:** install the app, answer **"I help someone…"**, enter the current code.

### Two phones at once

The same works without giving anything up. Signing in with the same Google
account on a second phone, tablet or browser reaches the **same** household —
one account owns exactly one household, and the app resolves it rather than
creating another. Medicines, photos, times and the full dose history all
arrive, and both devices then stay in step live: marking a dose on one shows on
the other within seconds.

Marking the same dose on both is harmless. A dose is recorded once per medicine
per slot per day however many devices say so.

Two things are per-device rather than per-account:

- **Reminders.** Turn them on separately on each device. If both are on, both
  will buzz — which is usually the point on a phone and a tablet, and usually
  not on two phones the same person carries.
- **Anything tapped while offline** stays on the device that tapped it until it
  reconnects, so a phone left in a drawer can hold a dose the other has not
  seen yet.

## Flow 9 — Cutting off a supporter, or losing the code

The elder's Settings → **Get a new code**. Every device using the old code — including the supporter's own, if they still have it — immediately loses access, and the new code is shown right there to hand to whoever should still have it.

## Flow 10 — Wrong answer at setup

Settings → **Change who uses this phone** isn't a single button anymore, since the two paths are different (an account vs. a code). Sign out (elder) or disconnect (supporter) from Settings, then go through Flow 1 or Flow 2 again with the correct answer. Nothing already set up is deleted.

## Flow 11 — The supporter checks in

Their **Today** shows the same day the elder sees, with what has been marked so
far. Because a supporter's phone has no account, it cannot receive live
updates the way the elder's can — it checks every minute or so while the app is
open, and a line under the date says when it last managed to.

Two things they can do from there:

- **Send a reminder.** The elder's phone buzzes with "A quick check on your
  medicines". It never names a medicine. Only one can be sent an hour, however
  many times the button is pressed, and it only works if the elder has turned
  reminders on (Flow 5) — the app says so if they have not.
- **Mark a dose for them.** Useful when the supporter is sitting with them, or
  filling the organiser together. The app asks once to confirm, then the
  medicine is recorded exactly as if the elder had marked it, except that their
  screen shows **Marked by your helper**. This needs a connection; if it fails,
  nothing is recorded and the app says so rather than pretending.

## Flow 12 — Dark colours

**Settings → Appearance** on either phone: match the phone's own setting, or
force light or dark. Worth knowing about for the night dose, which is usually
taken in a dark room.

---

## What can go wrong

| Situation | What it means | What to do |
|---|---|---|
| *"That code is not valid"* | The code was mistyped, or it's been rotated since it was shared | Double-check the code with the elder, or ask them to read it again from Settings |
| A medicine added by the supporter doesn't appear on Today | Usually just a slow connection | Wait a few seconds, or reopen the app; it does not need a manual refresh once connected |
| Tapped Done with no signal | It still works | The tap is saved on the phone immediately and sent to the server as soon as it reconnects — nothing is lost |
| No reminders arriving | Not turned on yet, or permission was denied | Settings → Reminders → Turn on, and check the phone's own notification settings for the app |
| Nothing on Today | No medicines yet, or none due today | Ask the supporter to add some, or check back later |
| Supporter's Today says *"Could not check for updates"* | Their phone cannot reach the server | It keeps showing the last information it had; it retries on its own. Check the connection if it persists |
| Supporter taps a circle and gets an error | A supporter's marks need a connection — they are never queued for later | Try again once back online. Nothing was recorded |
| *"Already sent"* when sending a reminder | One per hour, on purpose | Wait, or phone them |
