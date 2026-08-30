# Medicine Tracker

A medicine reminder and pill identification app for elderly users. Runs entirely in the browser. No backend, no accounts, no server database — all data lives on the phone.

**Live:** https://umerbutt.github.io/Medicine-Tracker/

It solves two problems:

1. **Which pill is which.** Every medicine can carry a photo the helper took themselves, shown full screen with one tap. This is the point of the app.
2. **What was taken.** One tap marks a whole time of day as done, and a month calendar shows the record.

### What it does not do

**It does not send notifications.** Nothing happens on the phone unless someone opens the app. The person taking the medicines needs an existing habit, or an alarm in the phone's own Clock app, to prompt them. Reminders are the first item in [docs/next-steps.md](docs/next-steps.md), and the reason they are not here yet is documented there.

---

## Two people, two phones

The app asks one question on first run — *"Who uses this phone?"* — and becomes a different app depending on the answer.

| | **Simple** (the person taking medicines) | **Supporter** (the person helping) |
|---|---|---|
| Sees | Today, Calendar, Settings | Medicines, Settings |
| Does | Marks doses done, checks photos, imports the list | Adds medicines, photos, times; exports the list |
| Interface | 20px minimum text, 56px minimum targets | Normal density, forms are fine |

Data moves **one way, by file**: the supporter exports, the other phone imports. No sync, no server, no pairing step. The mode can be changed at any time in Settings, and is not hidden behind a gesture.

---

## Setting it up

Both phones, the daily routine, sending updates, and restoring onto a new phone are all in **[docs/flow.md](docs/flow.md)**, written to be read aloud over a call.

The short version: the supporter installs the app, adds the medicines with photos and times, and exports one file. The other phone installs the app and imports that file. Repeat the export/import whenever the medicines change.

## Running it locally

No build step, no `npm install`, no dependencies.

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000/. Service workers and IndexedDB both work on `localhost` without HTTPS.

## Deploying

Push to `main` and point GitHub Pages at the repository root. Every path in the app is relative, so it works at a project sub-path with nothing to configure.

The service worker fetches network-first, so a deploy reaches the phone on the next open with no cache version to bump and nothing to clear.

---

## Known limits

- **iOS can evict the data.** Safari does not grant persistent storage the way Chrome does, and can clear a web app's storage after a long period of disuse. The mitigation is not technical: keep the last exported file. Settings offers **Save a copy of my information** for exactly this, and that file restores everything including the calendar history.
- **Days before the last import are read only.** Importing a new list freezes everything up to yesterday so an updated routine cannot rewrite last month's calendar. The trade-off is that a mistake older than one import cannot be corrected.
- **One person per install.** A caregiver looking after two parents needs two devices or two browsers.
- **No clinical logic.** No interaction checking, no dose validation, no advice. This is a memory aid.

---

## Documentation

| File | What is in it |
|---|---|
| [docs/flow.md](docs/flow.md) | **Start here.** What both people do, step by step, and what to do when something goes wrong |
| [docs/architecture.md](docs/architecture.md) | How it works: data model, the rules that must not be broken |
| [docs/repo-structure.md](docs/repo-structure.md) | What every file does |
| [docs/ui.md](docs/ui.md) | Every screen, and the design rules behind them |
| [docs/medicine-tracker-plan-v3.md](docs/medicine-tracker-plan-v3.md) | The build spec, including why decisions were made |
| [docs/next-steps.md](docs/next-steps.md) | Everything deliberately deferred |
