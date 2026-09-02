# UI

What each screen looks like and the rules behind it. For what the two people actually *do*, step by step, see [flow.md](flow.md).

## Two densities, one stylesheet

A class on `<body>` switches the whole type and target scale. There is no second theme and no duplicated CSS.

| | `.mode-simple` | `.mode-supporter` |
|---|---|---|
| Body text | 18px minimum | 16px minimum |
| Tap targets | 52px minimum | 44px minimum |
| Navigation | bottom bar, icon over label | top tabs |
| Page width | 32rem, centred | 44rem, centred |

Simple mode was originally 20px text / 56px targets. Both came down a step in a visual-density pass: still clearly the larger of the two densities (well above the supporter mode and above typical target-size guidance), but no longer oversized on a modern phone screen. **These numbers should be confirmed with the app's actual users before being treated as final** — they were chosen by eye, not tested with the people the density exists for.

Font sizes are in `rem` throughout, so the phone's own text-size setting still works. No webfont: an offline app cannot wait on a CDN, and a thin display face is unreadable at arm's length.

Responsive by being one column that grows. The same layout runs at 375px, 768px and 1280px — a wider screen gets a wider centred column, not a different design and not different behaviour.

## Visual language

One accent colour beyond the original blue/green/amber/red set, plus consistent shadow and motion treatment on anything tappable:

- **Primary blue** (`#1a56a0`) stays the brand colour — it's baked into the home-screen icons (`icons/make-icons.py`) and `theme-color`, so it was never a candidate for change. It still marks the primary action, links, and the current nav item.
- **Accent violet** (`#6b3fa0`) is new, used only decoratively: the supporter's icon chip on the role picker, and the "today" ring on the calendar. It never carries functional meaning, so it can't be confused with the semantic colours below.
- **Green / amber / red** (`--ok` / `--warn` / `--danger`) keep their existing, single job each — completed state, non-blocking notices, destructive actions — and are not used decoratively anywhere. Functional colour stays functional.
- **Buttons and tappable rows** now carry a soft shadow (`--shadow` / `--shadow-md`) and a small hover/press transition (border colour, shadow, a 1px translate on `:active`). `prefers-reduced-motion` still removes every transition, same as before.
- **Radius and shadow are shared tokens** (`--radius`, `--radius-lg`, `--shadow`, `--shadow-md`, `--shadow-lg`) so a card, a button and a sheet all read as the same design rather than each screen inventing its own corner rounding.

## Simple mode

### Today

```
┌─────────────────────────────────────┐
│ Today            Sunday 30 August   │
│ Tap a medicine to see its photo.    │
│                                     │
│ ┌─ Morning · 8:00 am ─────────────┐ │
│ │ ▢  Augmentin 625 mg             │ │   ← 52px row
│ │    1 tablet · take with food    │ │
│ │ ▢  Metformin 500 mg             │ │
│ │    1 tablet                     │ │
│ │ ▢  Amlodipine 5 mg              │ │
│ │    1 tablet                     │ │
│ │ ┌─────────────────────────────┐ │ │
│ │ │           Done              │ │ │   ← one button per slot
│ │ └─────────────────────────────┘ │ │
│ └─────────────────────────────────┘ │
│ ┌─ Night · 9:00 pm ───────────────┐ │
│ │ …                               │ │
│ └─────────────────────────────────┘ │
│                                     │
│   Today    Calendar    Settings     │
└─────────────────────────────────────┘
```

Four rules here, each one deliberate:

**The whole day is always shown.** Nothing is hidden because its time has passed. Hiding a passed slot turns a late dose into an unrecoverable state, and the person needs to see the full day to feel sure about what is left.

**Nothing reacts to the clock.** Morning is at the top all day and night is at the bottom all day. No slot promotes itself at its own hour, nothing dims once its time is past, nothing reorders. A screen that rearranges itself through the day is disorienting for the person who has to trust it. The only state shown is what they marked themselves: a completed slot turns green, says "All taken", and its button becomes **Undo**.

**Rows are compact.** 52px tall (was 56px — see the density note above), 48px thumbnail, name and strength on one line, dosage and notes on the next, both truncated rather than wrapped. A slot commonly holds five or six medicines; a card tall enough to be "friendly" pushes **Done** off the screen, which is the one control that matters. The row height dropped along with the rest of simple mode's density in the visual-refresh pass — worth re-measuring against a real seven-medicine slot before relying on an exact pixel figure here again.

**One Done per slot, not per medicine.** One tap writes one row per medicine, so the interface stays simple while the data stays granular. Tapping again undoes the whole slot.

**A tap changes only the slot that was tapped.** It turns green in place; every other slot, the heading and the scroll position stay exactly where they were. An earlier version re-rendered the whole day on each tap, which read as the page refreshing under the person's thumb — alarming right after pressing something.

### Photo view

Tapping any medicine row opens the photo full screen on black, name and strength overlaid at the bottom, with the image given the entire viewport. Tap anywhere, press Escape, or press back to close. A medicine with no photo shows a pill glyph and "No photo" rather than an error.

This is the pill-identification feature and the reason the app exists, so it gets the whole screen and no chrome.

### Calendar

```
┌─────────────────────────────────────┐
│  ‹      August 2026      ›          │   ← tap the title for month + year
│  S   M   T   W   T   F   S          │
│                          1          │
│  2   3   4   5   6   7   8          │
│  9  ⬤  ⬤  ◔   ○  12  13           │
│                                     │
│  ⬤ All taken    ○ Nothing marked   │
└─────────────────────────────────────┘
```

One ring per day: filled when everything expected was logged, a partial arc for some of it, hollow when nothing was marked, and **nothing at all** for a day with nothing due. Today is outlined in the accent colour (violet) rather than the primary blue, so "today" reads as a distinct marker from "the thing you'd tap."

Tapping a day opens a sheet with that day's slots and the same Done/Undo controls as Today — the same code, so there is nothing new to learn. It now opens centered on the screen like a dialog, on every screen size — see "Interaction primitives" below. Future days open read only ("Not yet"). Days on or before the household's lock line (a couple of days back, advanced nightly by the server) open read only with a plain explanation.

No percentages, no streaks, no scores, anywhere. This is a memory aid, and it must never read as judgement of someone's behaviour.

### Settings

Three groups: **Account** (signed-in Google email, the share code with a "Get a new code" button, sign out), **Reminders** (a single turn-on/turn-off row for Web Push), and app version at the bottom. No export/import screen anymore — the medicine list syncs on its own.

## Sign-in and pairing (before either mode is chosen)

Three small screens, reached from the "Who uses this phone?" question and all sharing the same visual language (`.welcome`, `.role-btn`, `.role-icon`), so the whole pre-auth flow reads as one screen rather than three unrelated ones:

- **"Who uses this phone?"** — a small branded icon above the question, then the two role choices as full-width cards: a round icon chip (blue for "I take the medicines", violet for "I help someone"), the name and one-line hint, and a trailing chevron for the same tappable-row affordance used everywhere else in the app.
- **Sign in** (simple): the same card style, one row, a generic account icon — "Sign in with Google". Nothing else — no password field, no form.
- **Enter the code** (supporter): a single text field plus a "Connect" button. A wrong code shows an inline error under the field, not a dialog; nothing is stored until the code is confirmed against the server.

## Supporter mode

### Medicines

A list showing each medicine's name, strength and the times it is scheduled at, with **Add a medicine** on top and an archived toggle at the bottom. Archiving is a soft delete: it stops appearing on Today, and the record of doses already taken is kept.

### Add or edit medicine

One form, one save: name, strength, how much to take, form, notes, an optional photo, **and the times**.

The times are in the same form on purpose. A medicine that exists but is scheduled nowhere appears on no Today screen and in no calendar, and the supporter has no way to notice — a dead state that looks exactly like success. So a save with zero times is refused with an explanation rather than a red asterisk.

Each time row is: slot, an optional time override, and a frequency of every day / every few days / certain days of the week. "Every few days" reveals an interval and a start date, both required, because counting from nothing is not possible.

### Times of day

The four built-in slots with editable times, plus custom ones. Removing a slot that is in use warns how many medicine times will stop appearing, then deactivates those schedules rather than deleting any history.

### Settings (supporter)

Which household this device is connected to (its display name, not any identifying detail about the elder beyond that), **Times of day**, and **Disconnect this device** — clears the locally-stored code and returns to the "Who uses this phone?" screen. There is nothing server-side to undo: a supporter's device never had an account to begin with.

## Interaction primitives

All in [js/ui.js](../js/ui.js), so behaviour is consistent everywhere:

- **Dialog** — a question with two buttons. In simple mode the buttons stack, with the confirming action on top, so a big thumb does not hit the wrong one.
- **Sheet** — for the calendar day and month picker. Centers on the screen like a dialog, on every screen size — it used to slide up from the bottom on narrow viewports specifically, but that read as "stuck to the bottom" rather than a deliberate gesture, so it was made consistent everywhere instead. Backdrop tap and Escape close it.
- **Toast** — a brief confirmation. Never used for errors that need a decision.
- **Photo viewer** — full screen, black, tap anywhere to dismiss.

Every overlay traps Escape, moves focus inside on open, and is announced to screen readers. Errors that need a decision use a dialog; nothing important is ever a toast that can be missed.

## Colour and contrast

| Token | Value | Used for |
|---|---|---|
| `--ink` | `#10141b` | body text |
| `--ink-2` | `#3d4654` | secondary text, still ≥7:1 on white |
| `--primary` | `#1a56a0` | Done, links, current nav item, the app's brand colour |
| `--accent` | `#6b3fa0` | decorative only — the supporter's role-picker icon, today's calendar ring. Never used for status, so it can't be mistaken for something functional |
| `--ok` | `#1a7a3c` | completed slots, calendar rings |
| `--danger` | `#a4262c` | archive and remove |

Contrast is at least 7:1 for body text in simple mode (unchanged by the density pass — the type scale got smaller, the colours did not). No grey-on-grey, no thin weights, no icon-only controls without a label. `prefers-reduced-motion` removes every transition, including the new hover/press motion on buttons, rows and calendar days.
