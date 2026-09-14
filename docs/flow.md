# User flow

Everything the two people actually do, start to finish. This is the only file that describes the flows; other docs link here.

---

## The two people

| | **Supporter** - the person helping | **Simple** - the person taking the medicines |
|---|---|---|
| Their phone shows | Today, Calendar, Medicines, Box, Settings | Today, Fill the box, Settings |
| Both can | Fill the weekly pill box - it is a tab on both phones | |
| Account | None - just a code | Signs in with Google, once |
| They do | Add medicines, photos and times; follow the day | Mark a time of day taken in one tap; check photos |
| How often | At setup, then whenever they want to check in | Every day |

Two phones, two installs. Data moves **live**: anything the supporter adds or changes reaches the elder's phone within a few seconds, automatically. No file to export, send, or import.

The app asks *"Who uses this phone?"* on first run. That answer is changeable at any time in Settings.

---

## Before you start

**Reminders exist, but need turning on.** The app can send a gentle push notification when it's time for medicines that haven't been marked done - see Flow 5. Until that's turned on, nothing happens unless someone opens the app.

---

## Flow 1 - The elder sets up (once, ~5 minutes)

```
Open in Safari  →  Add to Home Screen  →  "I take the medicines"  →  Sign in with Google
```

1. Open https://umerbutt.github.io/Medicine-Tracker/ in **Safari**. (Not Chrome - on iOS only Safari can install to the home screen.)
2. Tap **Share** - the square with an arrow pointing up, in the bottom toolbar.
3. Scroll down, tap **Add to Home Screen**, then **Add**.
4. Open the app from the home screen icon. It asks who uses this phone → **"I take the medicines"** → **Sign in with Google**.
5. Once signed in, the screen shows **your code** - a short one, like `4F7K2Q` - because until a supporter enters it there is nothing else to show. Read it out to whoever is helping you, or tap **Send it** to pass it on by WhatsApp or text. It is also always in **Settings**.

## Flow 2 - Supporter connects (once, ~15 minutes)

```
Open in Safari  →  Add to Home Screen  →  "I help someone…"  →  Enter the code  →  Add medicines
```

Usually walked through over the phone, with the elder reading out their code.

1. Open https://umerbutt.github.io/Medicine-Tracker/ in **Safari**.
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Open the app from the home screen. Answer **"I help someone with their medicines"**.
4. Enter the code from the elder's Settings screen, then **Connect**. No account, no sign-in - the code is enough.
5. *Optional:* Settings → **Times of day**, to change what time morning, afternoon, evening and bedtime mean, or to add your own. And the **Box** tab, if a weekly organiser is used (Flow 4).
6. **Medicines** → **Add a medicine**, for each one:
   - Name, strength, how much to take, and the form.
   - **Take a photo** of the actual pill. This is the part that matters - it is how the pills get identified when the weekly organiser is refilled.
   - **How much to take** is a number; the unit comes from the form. Halves and
     quarters are allowed.
   - **What it is for**, one short line - read by whoever fills the pill box.
   - A second photo **of the packet**, if useful. It is shown only when filling
     the organiser, where the question is which box to reach for.
   - Notes if useful, e.g. "take with food".
   - **When to take it** - one or more times. Pick the time of day, optionally override its time for this medicine, and choose every day / every few days / certain days of the week.
   - **Save.** A medicine with no times set cannot be saved: it would appear on no screen and you would never notice.

That's it - nothing to send. Everything just added appears on the elder's **Today** screen within a few seconds.

## Flow 3 - Every day

```
Open the app  →  tap "I have taken these"
```

That is the whole daily task: **one tap, on the first screen, with no scrolling
and nowhere to navigate to first.**

1. Open the app. **Today** shows the whole day as one card per time of day, in
   the same order every day: morning at the top, bedtime at the bottom. Nothing
   is hidden and nothing moves as the day goes on.
2. Each card is coloured by its state, in a solid band across the top you can
   read from across the room: **charcoal** still to come, **red** if its time
   has passed and nothing is marked, **green** once it is dealt with. Under the
   band: which medicines it holds, and a line saying where it stands.
3. Tap **"I have taken these"**. The card turns green in place and says "All
   taken". That is it.
4. Tapped by mistake? The same button now says **"Undo this"**, in the same
   place. There is no "are you sure?" - undo is always one tap away. A message
   also appears at the bottom with an Undo button for a few seconds, but you do
   not have to catch it.

**To check a pill first**, tap **"See the pills"** under the button. That opens
the time of day one medicine per card: a large photo, the name and strength,
what it is for, and its own **"I have taken this"** button. Tap the photo row
to open everything known about it, and the photo again to fill the screen.

**Not taking one today?** On that screen, under a medicine, tap **"Leave this
one out today"**. It goes neutral grey - never red, because deciding not to
take something is not a failure and nothing in the app treats it as one - and
the link becomes **"Put it back on the list"**. "I have taken these" never
overrides a medicine you have deliberately left out.

A card whose time has already passed is still there and can still be marked.
Nothing expires at midday. This works even with no signal - see "What can go
wrong" below.

If your helper marked something for you, that medicine says **Marked by your
helper** on the "See the pills" screen.

## Flow 4 - Filling a weekly pill organiser

The photos exist for this. On either phone - whoever is holding the tray.

```
Fill the box  →  Start filling the box  →  one medicine at a time  →  check
```

**Once, first:** open **Fill the box** (the **Box** tab on the helper's phone)
and tap **Change** beside "Compartments in the box". Tick the times of day that
exist as compartments in your plastic box - two ticks is the usual 7×2 tray,
four is 7×4. Anything unticked is taken from its packet on the day instead.

1. **Fill the box.** A blue band says it out loud before anything else: filling
   the box does not mean anything has been taken. Then the week (Monday of the
   current week by default, tap **Change** for another), how many medicines go
   in, and a button listing anything that does *not* - syrups, inhalers and
   drops, plus anything at a time of day you did not tick.
2. **One medicine per screen.** Its photos, what it is for, **how many to take
   out for the whole week**, and seven day chips with the number that goes in
   each. Tap either photo to see it full screen. Tap **"It is in the box"**,
   then **Next medicine**.
3. **At the end, a check screen**: how many go in each compartment, as a grid.
   Count them against the tray. Tap any box to see exactly what belongs in it.
   Then **"I have finished filling the box"**.

The screen stays awake throughout, and you can stop and come back - it
remembers where you were and offers to carry on. Changing which times of day go
in the box starts the sitting again, because the tray it was planned for has
changed shape.

**Nothing here marks anything as taken.** Filling the box is not taking the
medicine, and the app keeps those separate on purpose.

## Flow 5 - Turning on reminders

```
Elder's Settings  →  Reminders  →  Turn reminders on  →  allow notifications
```

1. On the elder's phone, **Settings** → **Reminders** → **Turn reminders on**. The app explains what is about to happen before the phone's own permission prompt appears - that prompt is the single easiest thing in the app to dismiss by accident, and it cannot be asked for again afterwards.
2. The phone will ask for permission to send notifications - allow it.
3. From then on, a notification like *"Time for your evening medicines"* arrives if a slot's time passes with something still unmarked. It never names the medicine, for privacy.
4. If it's still unmarked about 45 minutes later, one follow-up arrives (*"Still time for your evening medicines"*) - and only one. Marking it done any time before or after either notification stops both.

On iPhone this needs the app to have been added to the home screen (Flow 1, step 3) and iOS 16.4 or later - both already true if setup was followed as written.

## Flow 6 - Checking the record

**This is the helper's screen.** The person taking the medicines has no
Calendar tab: their day is Today, and a month grid of their own adherence is
the one thing this app deliberately does not show them.

1. Tap **Calendar**. Each day is a tinted tile with a mark on it - `✓`
   everything dealt with, `○` something still unmarked, `-` something not
   taken, `·` nothing was due, and blank for a day that has not happened yet. A
   `▣` in front means the day is kept as a read-only record.
2. Chevrons move a month at a time; tapping the month name jumps to any month
   and year.
3. Tap a day to open it. It says up front whether it can still be corrected,
   is kept as a record, or has not happened yet - then lists each time of day
   and what was marked. **Change** on a medicine opens the same panel with the
   same buttons used everywhere else.

Two days cannot be edited: days in the future, and days from a couple of days
ago or further back (those are kept as a record - a nightly job freezes them).
No scores, streaks or percentages appear anywhere; the legend at the bottom of
the month says so.

## Flow 7 - The medicines change

Supporter: **Medicines**, edit, add, or **Archive** anything stopped. Archiving keeps the history of what was already taken. That's the whole flow - the change reaches the elder's phone on its own.

- **The record of doses already taken is never touched.**
- Days already frozen (Flow 6) keep showing what was actually expected at the time, not the updated routine.

## Flow 8 - New phone, or reinstalling

Nothing to restore by hand. The medicines, schedule, and dose history all live on the server, not just on the phone.

- **Elder:** install the app, answer **"I take the medicines"**, sign in with the same Google account. Everything comes back - same household, same code (unless it's been rotated since).
- **Supporter:** install the app, answer **"I help someone…"**, enter the current code.

### Two phones at once

The same works without giving anything up. Signing in with the same Google
account on a second phone, tablet or browser reaches the **same** household -
one account owns exactly one household, and the app resolves it rather than
creating another. Medicines, photos, times and the full dose history all
arrive, and both devices then stay in step live: marking a dose on one shows on
the other within seconds.

Marking the same dose on both is harmless. A dose is recorded once per medicine
per slot per day however many devices say so.

Two things are per-device rather than per-account:

- **Reminders.** Turn them on separately on each device. If both are on, both
  will buzz - which is usually the point on a phone and a tablet, and usually
  not on two phones the same person carries.
- **Anything tapped while offline** stays on the device that tapped it until it
  reconnects, so a phone left in a drawer can hold a dose the other has not
  seen yet.

## Flow 9 - Cutting off a supporter, or losing the code

The elder's Settings → **Make a new code…**. It names the consequence first - the current code stops working straight away and anyone helping is disconnected - with **Make a new code** / **Keep this code**. Every device using the old code - including the supporter's own, if they still have it - immediately loses access, and the new code is shown right there to hand to whoever should still have it.

## Flow 10 - Wrong answer at setup

The two paths are different (an account vs. a code), so there is no single
switch. Sign out (elder, at the bottom of Settings) or **Disconnect…**
(supporter, under Connection), then go through Flow 1 or Flow 2 again with the
correct answer. Nothing already set up is deleted.

On the elder's phone there is also a small **"Change role (back to the start)"**
link at the very bottom of Settings, below Sign out. It is deliberately the
quietest thing on the screen and deliberately last: a role switcher is one
wrong tap away from putting the person taking the medicines into an admin app.

## Flow 11 - The supporter checks in

Their **Today** is a list of the day's times of day, one row each, with a state
mark, the time, and where it stands. Tap a row to open it and see the medicines
inside, each with **Mark taken** or **Clear**, plus **Mark the whole slot** at
the bottom. Marking the whole slot is deliberately not the loud button - it
invites marking everything at 8am, before anything has been swallowed.

Because a supporter's phone has no account, it cannot receive live updates the
way the elder's can. It checks every minute or so while the app is open, and
the line under the date says when it last managed to, with a **Check now**
button beside it. If a check fails, a panel says how old the information is and
that anything marked now is still saved and sent when the connection returns.
If their own phone's date differs from the household's, a line says so: *you
are looking at their day*.

Three things they can do from there:

- **Nudge their phone.** The elder's phone buzzes with "A quick check on your
  medicines". It never names a medicine. Only one can be sent an hour, however
  many times the button is pressed, and it only works if the elder has turned
  reminders on (Flow 5) - the app says so if they have not.
- **Mark a dose for them.** Useful when the supporter is sitting with them, or
  filling the organiser together. **The app asks once per session, naming the
  person** - and when it is a whole time of day, naming how many medicines -
  then never asks again, replacing the question with a dashed reminder at the
  top of the screen: *Marking on Margaret's behalf this session*. The dose is
  recorded exactly as if the elder had marked it, except that their screen says
  **Marked by your helper**.
- **Correct an older day.** Calendar → a day → **Change** (Flow 6).

A supporter's mark needs a connection. If it fails, nothing is recorded and the
app says so rather than pretending - marking a dose for someone else is not
something to silently defer.

## Flow 12 - Dark colours

**Settings → How it looks** (the elder) or **Settings → Appearance** (the
helper): match the phone's own setting, or force light or dark. Worth knowing
about for the bedtime dose, which is usually taken in a dark room.

---

## What can go wrong

| Situation | What it means | What to do |
|---|---|---|
| *"That code was not found"* | The code was mistyped, or it's been rotated since it was shared | Double-check the code with the elder, or ask them to read it again from Settings. A *different* message - "Could not connect" in amber - means the code is fine and the connection is not |
| A medicine added by the supporter doesn't appear on Today | Usually just a slow connection | Wait a few seconds, or reopen the app; it does not need a manual refresh once connected |
| Tapped "I have taken these" with no signal | It still works | The tap is saved on the phone immediately and sent to the server as soon as it reconnects. Today shows an amber line saying so, and nothing on the screen is disabled |
| No reminders arriving | Not turned on yet, or permission was denied | Settings → Reminders → **Turn reminders on**. If it says *"Reminders are not available"*, the phone has blocked them: allow notifications for CarePair in the phone's own settings first |
| Nothing on Today | No medicines yet, or none due today | Ask the supporter to add some, or check back later |
| *"Nothing to put in the box this week"* | Everything due is a syrup, inhaler or drops, or is at a time of day not ticked as a compartment | Fill the box → **Change** beside "Compartments in the box" |
| The pill box grid is not the shape of your tray | The ticked compartments do not match the box | Fill the box → **Change** beside "Compartments in the box" |
| Supporter's Today says *"Could not get the latest"* | Their phone cannot reach the server | It keeps showing the last information it had and says how old it is; it retries on its own, and **Check now** forces one. Check the connection if it persists |
| Supporter taps **Mark taken** and gets an error | A supporter's marks need a connection - they are never queued for later | Try again once back online. Nothing was recorded |
| *"Already sent"* when nudging | One per hour, on purpose | Wait, or phone them |
| Supporter's Today shows a different date to their own phone | Deliberate. The app always shows the **elder's** day, wherever the supporter is | Nothing. A line under the date says so when the two differ |
