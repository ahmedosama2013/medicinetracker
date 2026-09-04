# UI

What each screen looks like and the rules behind it. For what the two people actually *do*, step by step, see [flow.md](flow.md).

> **v2 visual refresh.** This file describes the redesign that replaced the flat, oversized v1 UI: a fuller colour palette, pill-shaped buttons and chips, a masked-SVG icon system (no icon font, no build step), purposeful motion, and a further density reduction in simple mode. Nothing in `architecture.md` changed — this is `css/app.css` and layout only. Where a number below differs from what you remember, this file is the current source of truth; `css/app.css`'s own tokens section is the implementation.

## Two densities, one stylesheet

A class on `<body>` switches the whole type and target scale via CSS custom properties (`--text-*`, `--target-min`, `--row-h`), not a duplicated stylesheet.

| | `.mode-simple` | `.mode-supporter` |
|---|---|---|
| Body text | 16px minimum | 15px minimum |
| Tap targets | 46px minimum | 40px minimum |
| Row height | 46px | 48px (browser default) |
| Navigation | bottom bar, icon over label | top tabs, pill-shaped active state |
| Content width | 28rem, centred | 42rem, centred |

Simple mode has now come down twice: 20px/56px at launch, 18px/52px in the first density pass, and 16px/46px here. Each step kept it clearly the larger of the two densities and above typical target-size guidance (the accessibility floor is 44px; 46px still clears it). **These numbers still need confirming with the app's actual users before being treated as final** — same caveat as the previous pass, now more true than ever since this is the smallest simple mode has ever been.

Font sizes are still all in `rem`/`em`, so the phone's own text-size setting works. No webfont, still: an offline app cannot wait on a CDN, and a thin display face is unreadable at arm's length. Personality comes from weight, spacing, and colour rather than a second typeface.

Responsive by being one column that grows — unchanged in spirit, more explicit in implementation: `#app` has a `max-width` per mode and centres itself, so 375px, 768px and 1280px are the same layout with more or less side margin, never a different arrangement. A couple of breakpoints (`48rem`, `80rem`) nudge padding and the welcome icon's size for comfort; none of them restructure the page.

## Visual language

A fuller palette than v1's flat blue/green/amber/red, built around soft tints of each functional colour rather than flat swatches:

- **Primary blue** (`#1a56a0`) is unchanged — it's baked into the home-screen icons (`icons/make-icons.py`) and `theme-color`, so it was never a candidate for change. A `--primary-600` / `--primary-700` pair gives it a gradient for primary buttons and the brand mark; `--primary-50` / `--primary-100` are soft tints used behind icons, chips, and the share code.
- **Accent violet** (`#6b3fa0`) is still decorative only: the supporter's role-picker icon chip, the "today" ring on the calendar. Never functional, so it can't be confused with the semantic colours.
- **Green / amber / red** (`--ok` / `--warn` / `--danger`) keep one job each — completed state, non-blocking notices, destructive actions — each now paired with a `-50` tint for its own soft background (a completed slot's whole card, not just its tag).
- **Icons are masked inline SVG**, defined once as CSS custom properties (`--icon-pill`, `--icon-calendar`, `--icon-settings`, `--icon-today`) and applied via `mask-image` wherever `js/ui.js`'s `icon()` helper or a nav link's `data-icon` attribute names them. No icon font, no image requests, no build step — consistent with everything else in the project.
- **Buttons are pill-shaped**; cards and inputs use two smaller, separate radius steps (`--radius-lg` / `--radius-sm`). Varying the shape by role — fully round for anything tappable-as-an-action, rounded-rect for content containers — is deliberate, so the interface doesn't read as one corner-radius applied to everything regardless of hierarchy.
- **Shadows and motion are shared tokens** (`--shadow-sm/--shadow/--shadow-md/--shadow-lg`, `--dur-fast/--dur/--dur-slow`, `--ease/--ease-out`) so a card, a button and a sheet read as the same design.

### Motion

Purposeful, not decorative. Every animation in `app.css` answers something the person did or something that just became true, not a scroll position:

- **Slot completion** — the whole card's background and border transition to the green tint over `--dur-slow`, and the "All taken" tag pops in. The completion itself is the moment; nothing else on the row moves.
- **Buttons and rows** — a small scale-down on `:active` (mouse press or tap), never a bounce or a bigger bookclub-esque bounce that would feel toy-like on a health app.
- **Dialogs, sheets, the photo viewer** — fade and rise in together (`dialog-in`), so opening one overlay always feels the same regardless of which.
- **The welcome screen's icon** — one orchestrated pop-in on load (`welcome-pop`), the only "page load" animation in the app, since it's the first thing anyone sees and the one place worth a moment of polish.
- **`prefers-reduced-motion: reduce`** collapses every animation and transition to effectively nothing, same guarantee as before.

## Simple mode

### Today

```
┌─────────────────────────────────────┐
│              Today                  │
│         Sunday 30 August            │
│   Tap a medicine to see its photo.  │   ← only rendered when a medicine exists
│                                     │
│ ┌─ Morning · 8:00 am ─────────────┐ │
│ │ ▢  Augmentin 625 mg             │ │   ← 46px row
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

The heading block is now centred — "Today", the date beneath it, and the "Tap a medicine…" hint all sit in one centred column, rather than the date sitting off to the right. Every other page heading (Settings, Medicines, a medicine form) centres the same way, so headers read as one consistent pattern across the app instead of one screen doing its own thing. Standalone headings (Settings, Medicines, a medicine form) also got a real gap above and below — they were sitting flush against the nav and the first card, which read as cramped.

**The hint line only appears once there is something to tap.** Previously it rendered unconditionally, so it showed up above the "No medicines yet" empty state — a hint for an action that wasn't available yet. `js/views/today.js` now checks `store.getActiveMedicines()` before deciding what to render, so an empty day shows only the empty state and (for a supporter) the add-a-medicine button; the hint appears only alongside actual slots. This is the one behavioural fix in this pass — everything else here is styling and layout, per the brief.

Five rules now, the four from before plus the new one above, each one deliberate:

**The whole day is always shown.** Nothing is hidden because its time has passed. Hiding a passed slot turns a late dose into an unrecoverable state, and the person needs to see the full day to feel sure about what is left.

**Nothing reacts to the clock.** Morning is at the top all day and night is at the bottom all day. No slot promotes itself at its own hour, nothing dims once its time is past, nothing reorders. The only state shown is what they marked themselves: a completed slot turns green (card background and border, not just a tag), says "All taken", and its button becomes **Undo**.

**Rows are compact.** 46px tall (was 52px), 42px thumbnail, name and strength on one line, dosage and notes on the next, both truncated rather than wrapped. A slot commonly holds five or six medicines; a card tall enough to be "friendly" pushes **Done** off the screen, which is the one control that matters.

**One Done per slot, not per medicine.** Unchanged. One tap writes one row per medicine, so the interface stays simple while the data stays granular.

**A tap changes only the slot that was tapped.** Unchanged, and this pass was careful not to touch it: `js/views/day.js` — the module that actually owns the tap-to-complete re-render — has no markup or behavioural changes in this pass, only the CSS classes it already emits being restyled.

### Photo view

Unchanged in behaviour: tapping any medicine row opens the photo full screen on black, name and strength overlaid at the bottom. Tap anywhere, press Escape, or press back to close. A medicine with no photo shows the pill glyph and "No photo". The open/close transition is now a simple fade rather than an instant cut.

### Calendar

One ring per day: filled when everything expected was logged, a partial arc for some of it, hollow when nothing was marked, nothing at all for a day with nothing due. Today is outlined in the accent violet, still distinct from "the thing you'd tap" (primary blue). Chevron buttons and the month/year picker are now pill-shaped to match the rest of the button language, with a small press animation.

No percentages, no streaks, no scores, anywhere — unchanged. This is a memory aid, and it must never read as judgement of someone's behaviour.

### Settings

Unchanged in content: **Account** (signed-in email, share code, rotate, sign out), **Reminders**, app version. The page heading is now centred like every other screen's; the share code is shown in a tinted pill with tabular numerals so its characters are easy to read out over a phone call.

## Sign-in and pairing — redesigned

The three pre-auth screens (`onboarding.js`, `auth.js`, `pairing.js`) share one visual language (`.welcome`, `.role-btn`, `.role-icon`) and were the first-screen priority for this pass, since "Who uses this phone?" is the very first thing anyone — elder or supporter — ever sees. They're also the only screens with nothing else on the page, so they're centred in the full viewport height (`body.mode-none`) rather than pinned to the top with empty space left below:

- **A branded icon mark** now opens the screen: a rounded-square chip in a blue gradient with the pill glyph, sitting in a soft ring of the same blue, with a single one-time pop-in animation on load. This is the one deliberately "designed" moment in the app; everything after it stays quiet.
- **"Who uses this phone?"** — the two role choices are pill-icon cards (blue for "I take the medicines", violet for "I help someone"), each with a hover lift and a press-down animation, ending in the same trailing-chevron affordance used for every tappable row elsewhere in the app.
- **Sign in** (simple) and **Enter the code** (supporter) keep the same one-field-and-one-button shape as before — no password field, no extra form — just restyled to match: the Google sign-in button reads as the page's one primary action, and a wrong code shows an inline error under the field, not a dialog.

## Supporter mode

### Medicines

Unchanged in content and behaviour. Rows are now cards with a soft shadow and a hover/press state instead of flat dividers; archived medicines are dimmed rather than struck through.

### Add or edit medicine

Same single form, same rule: a save with zero times is refused with an explanation, not a red asterisk. Each schedule is now its own tinted card with a numbered chip, so multiple times for one medicine read as clearly separate blocks rather than a long unbroken list of fields.

### Times of day

Unchanged in behaviour. Removing a slot that is in use still warns how many medicine times will stop appearing before deactivating those schedules.

## Interaction primitives

All still in [js/ui.js](../js/ui.js), unchanged in behaviour, restyled to the new tokens:

- **Dialog** — a question with two buttons. In simple mode the buttons still stack with the confirming action on top.
- **Sheet** — for the calendar day and month picker. Still centres on the screen like a dialog at every width. Now fades and rises in rather than appearing instantly.
- **Toast** — a brief confirmation, positioned clear of the bottom nav in simple mode. Never used for errors that need a decision.
- **Photo viewer** — full screen, black, tap anywhere to dismiss, now with a fade transition.

Every overlay still traps Escape, moves focus inside on open, and is announced to screen readers. `prefers-reduced-motion` removes every transition and animation added in this pass, same guarantee as before.

## Colour and contrast

| Token | Value | Used for |
|---|---|---|
| `--ink` | `#12151c` | body text |
| `--ink-2` | `#454e5c` | secondary text |
| `--ink-3` | `#6b7280` | tertiary text, hints, timestamps |
| `--primary` | `#1a56a0` | primary buttons, links, current nav item, the app's brand colour |
| `--accent` | `#6b3fa0` | decorative only — the supporter's role-picker icon, today's calendar ring |
| `--ok` | `#1a7a3c` | completed slots, calendar rings |
| `--warn` | `#a5690c` | non-blocking notices |
| `--danger` | `#b3272d` | archive, remove, destructive confirmations |

Body text stays at or above 7:1 contrast on white in simple mode; secondary text (`--ink-2`) stays above 4.5:1 everywhere it's used for anything other than pure decoration. No grey-on-grey, no thin weights, no icon-only controls without a label. `prefers-reduced-motion` removes every transition and animation, including the new hover/press motion on buttons, rows, and calendar days.
