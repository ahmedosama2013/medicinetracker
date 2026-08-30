# User flow

Everything the two people actually do, start to finish. This is the only file that describes the flows; other docs link here.

**Live app:** https://umerbutt.github.io/Medicine-Tracker/

---

## The two people

| | **Supporter** — the person helping | **Simple** — the person taking the medicines |
|---|---|---|
| Their phone shows | Medicines, Settings | Today, Calendar, Settings |
| They do | Add medicines, photos and times; export | Mark doses done, check photos, import |
| How often | Once at setup, then occasionally | Every day |

Two phones, two installs. Data moves **one way, by file**: the supporter exports, sends it over WhatsApp or email, the other phone imports it. No accounts, no sync, no server, no pairing code.

The app asks *"Who uses this phone?"* on first run. That answer is changeable at any time in Settings.

---

## Before you start

**The app does not send notifications.** Nothing happens on the phone unless someone opens it. The person taking the medicines needs an existing habit — or an alarm in the phone's own Clock app — to prompt them to open it. This is deliberate for v1; the reason is in [next-steps.md](next-steps.md).

---

## Flow 1 — Supporter sets up (once, ~15 minutes)

```
Open in Safari  →  Add to Home Screen  →  "I help someone…"  →  Add medicines  →  Export  →  Send file
```

1. Open https://umerbutt.github.io/Medicine-Tracker/ in **Safari**. (Not Chrome — on iOS only Safari can install to the home screen.)
2. Tap **Share** — the square with an arrow pointing up, in the bottom toolbar.
3. Scroll down, tap **Add to Home Screen**, then **Add**.
4. Open the app from the home screen icon. It asks who uses this phone → **"I help someone with their medicines"**.
5. *Optional:* Settings → **Times of day**, to change what time morning, afternoon, evening and night mean, or to add your own.
6. **Medicines** → **Add a medicine**, for each one:
   - Name, strength, how much to take, and the form.
   - **Take a photo** of the actual pill. This is the part that matters — it is how the pills get identified when the weekly organiser is refilled.
   - Notes if useful, e.g. "take with food".
   - **When to take it** — one or more times. Pick the time of day, optionally override its time for this medicine, and choose every day / every few days / certain days of the week.
   - **Save.** A medicine with no times set cannot be saved: it would appear on no screen and you would never notice.
7. Settings → **Send medicines to the person I help**. This produces one file, `medtrack-medicines-<date>.json`, containing everything including the photos.
8. Send that file over WhatsApp or email.

## Flow 2 — The other phone receives the list (once, ~5 minutes)

```
Open in Safari  →  Add to Home Screen  →  "I take the medicines"  →  Save the file  →  Import  →  Use the new list
```

Usually walked through over the phone by the supporter.

1. Open https://umerbutt.github.io/Medicine-Tracker/ in **Safari**.
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Open the app from the home screen. Answer **"I take the medicines"**.
4. Save the file that arrived. In WhatsApp: tap the file, then **Share** → **Save to Files**.
5. In the app: **Settings** → **Get my medicines from my helper** → pick the file.
6. It says what will change — e.g. *"5 new medicines"* — and that the record of doses already taken will be kept. Tap **Use the new list**.

Done. The medicines appear on **Today**.

## Flow 3 — Every day

```
Open the app  →  see the day  →  tap a medicine to check the photo  →  tap Done
```

1. Open the app. **Today** shows the whole day, grouped by time of day, in the same order every day: morning at the top, night at the bottom. Nothing is hidden and nothing moves as the day goes on.
2. To check a pill, tap it. The photo fills the screen with the name and strength. Tap anywhere to close.
3. After taking everything in that group, tap **Done** once. The group turns green.
4. Tapped by mistake? The button now says **Undo**. Tap it.

A group whose time has already passed is still there and can still be marked. Nothing expires at midday.

## Flow 4 — Filling a weekly pill organiser

The photos exist for this.

1. Open **Today**.
2. For each medicine in a group, tap it to see the photo full screen, and match it against the packet in hand.
3. Close and move to the next.

## Flow 5 — Checking the record

1. Tap **Calendar**. Each day carries a ring: filled when everything was marked, part-filled for some, hollow for nothing, and no ring at all on a day with nothing due.
2. Chevrons move a month at a time; tapping the month name jumps to any month and year.
3. Tap a day to see what was due and mark anything missed.

Two days cannot be edited: days in the future, and days from before the last update arrived (those are kept as a record). No scores, streaks or percentages appear anywhere.

## Flow 6 — The medicines change

```
Supporter edits  →  Export  →  Send  →  Import  →  Use the new list
```

1. Supporter: **Medicines**, edit, add, or **Archive** anything stopped. Archiving keeps the history of what was already taken.
2. Settings → **Send medicines to the person I help** → send the new file.
3. Other phone: Settings → **Get my medicines from my helper** → pick the new file → **Use the new list**.

What happens on import:

- Medicines, times and photos are replaced with the new list.
- **The record of doses already taken is never touched.**
- Days before this update are frozen exactly as they were, so a changed routine does not rewrite last month's calendar.
- Importing the same file twice changes nothing.

## Flow 7 — New phone, or data lost

iOS can clear a web app's storage after a long stretch of disuse, so keep a saved copy.

**Making one:** Settings → **Save a copy of my information** → `medtrack-mycopy-<date>.json`. Keep it in Files, email it to yourself, anywhere. Worth doing after any change.

**Restoring:** install the app on the new phone, answer who uses it, then Settings → import that file. Medicines, photos, times, the full dose history and the frozen calendar all come back.

Note the two filenames differ on purpose — `medtrack-medicines-…` comes from the supporter, `medtrack-mycopy-…` is your own backup — so two files arriving on the same day can be told apart.

## Flow 8 — Wrong answer at setup

Settings → **Change who uses this phone** → confirm. The app reloads into the other mode. Nothing is deleted.

---

## What can go wrong

| Message | What it means | What to do |
|---|---|---|
| *"This file does not look like a medicine list"* | Wrong file picked, or it is damaged | Pick the right file; ask for it to be sent again |
| *"Your app needs updating"* | The file came from a newer version of the app than this phone has | Open the app while connected to the internet, then import again |
| *"This file is incomplete…"* | The file is missing a time of day one of its medicines refers to | Ask the supporter to export and send it again |
| The file cannot be selected in the picker | iOS hides files it thinks are the wrong type | Make sure it was saved as `.json` via **Save to Files** |
| Nothing on Today | No medicines yet, or none due today | Import the list, or check with the supporter |
