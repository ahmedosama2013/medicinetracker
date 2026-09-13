# Handoff: CarePair — Elder-First UI Redesign

## Overview
CarePair is a two-role medication app: the **person taking medicines** (the "elder view") and the
**person helping them** (the "supporter view"). This handoff covers a redesign of the elder view for
accessibility and calm — large type, one primary action per card, high figure/ground contrast, no
hidden navigation — plus the matching contrast pass applied across the supporter view.

## About the Design Files
The files in this bundle are **design references created in HTML**. They are prototypes showing the
intended look and behaviour — *not* production code to copy directly.

The task is to **recreate these designs inside the target codebase's existing environment**
(React / Vue / SwiftUI / Android / whatever the app already uses), using its established components,
routing, state management and styling conventions. Do not port the prototype's markup, inline styles
or its custom runtime. If the project has no UI environment yet, choose the framework that best fits
it and implement the designs there.

`CarePair.dc.html` uses a bespoke prototyping runtime (`<sc-if>`, `<sc-for>`, `{{ }}` holes, a
`Component` logic class). Read it as a spec: the template shows structure and exact styling values,
the logic class at the bottom shows the state model and derived values. `CarePair-standalone.html`
is the same design bundled to open in any browser with no dependencies — use it to click through the
flows.

The prototype renders inside a **390 × 844 phone frame** drawn in the page. That frame is scaffolding
for reviewing the design. In the real app the screens are the whole viewport.

## Fidelity
**High-fidelity.** Colours, type sizes, weights, spacing, radii and copy are final and intentional.
Recreate them faithfully. Where the target codebase already has an equivalent primitive (button,
card, list row), use that primitive and give it these values rather than building new ones.

Two things are deliberate and should survive the port:
1. **Type floor.** No text in the elder view is below 15px, and nothing the user must read to act is
   below 17px. Body copy is 17–21px, slot names 26px, screen titles 25–27px.
2. **Touch floor.** Every tappable target in the elder view is at least 44px tall; primary actions
   are 54–64px.

---

## Design Tokens

### Colour — shared
| Token | Hex | Use |
|---|---|---|
| Ink | `#1C1A17` | Primary text |
| Ink 2 | `#45423C` | Secondary text / body copy |
| Ink 3 | `#55514A` | Tertiary text |
| Muted | `#7C766A` | Labels, captions, de-emphasised links |
| Faint | `#9A958A` | Disabled / not-applicable |
| Frame | `#211F1B` | Hard borders, active nav pill |
| Green (primary) | `#1F5340` | Primary action, "done" state, links |
| Green dark | `#14362a` | Link hover, mono code text |
| Green tint | `#E7F1EA` | "Done" surfaces |
| Green line | `#9CC0AC` | "Done" borders |
| Red | `#8E2F1E` | Destructive / "late" state |
| Red 2 | `#7A2716` | Error headings |
| Red tint | `#FBEAE5` | Error surfaces |
| Amber | `#A6741C` | Warning borders (offline, rotate code) |
| Amber ink | `#7A5410` | Warning text |
| Amber tint | `#FFF4E0` | Warning surfaces |

### Colour — elder view
| Token | Hex | Use |
|---|---|---|
| Canvas | `#D9D1BF` | Screen background. **Deliberately dark** — white cards must pop off it. |
| Card | `#FFFFFF` | All content cards |
| Card border | state colour | 2px, takes the slot's state colour |
| Card shadow | `0 4px 0 rgba(28,26,23,0.18)` | Hard-edged lift, no blur |
| Chrome | `#FFFFFF` | Bottom nav bar, with `border-top: 2px solid #211F1B` |
| Warm off-white | `#F1EDE3` | Secondary button fill inside white cards |
| Hairline | `#DDD7CB` | Neutral card borders (Settings) |
| Divider | `#E4DFD4` | Row dividers |

### Colour — supporter view
| Token | Hex | Use |
|---|---|---|
| Canvas | `#E5E9F0` | Screen background |
| Card | `#FFFFFF` | Content cards |
| Navy | `#2A3B5E` | Primary action |
| Border | `#C7CCD6` / `#E1E4EA` | Card borders / dividers |
| Label | `#374151` | Form labels |

### Slot state tones (elder Today)
Each time-of-day card carries one state. The state colour is used for the card border, the solid
header band, the status glyph ring and the status text.

| State | Condition | Colour `fg` | Glyph | Status text |
|---|---|---|---|---|
| Waiting | nothing marked, not past due | `#55514A` | `○` | "Not taken yet" / time-based copy |
| Late | nothing marked, past due | `#8E2F1E` | `!` | "Not taken yet" |
| Partial | some marked | `#55514A` | `○` | "N of M dealt with" |
| Done | all marked | `#1F5340` | `✓` | "All taken" / "All dealt with · N not taken" |

### Typography
Families: **Public Sans** (400/500/600/700/800) for all UI; **IBM Plex Mono** (400/500) for the
household code only.

| Role | Size | Weight | Notes |
|---|---|---|---|
| Screen title (elder) | 25–27px | 800 | `letter-spacing: -0.02em` |
| Slot name | 26px | 800 | `-0.02em`, white on state band |
| Slot time | 20px | 700 | `font-variant-numeric: tabular-nums` |
| Medicine list | 21px | 600 | `line-height: 1.3`, single line + ellipsis |
| Slot status | 18px | 700 | state colour |
| Primary button | 18px | 800 | |
| Link button | 17px | 700 | underlined |
| Body copy | 17–19px | 400–700 | `line-height: 1.45` |
| Section label | 15px | 800 | `0.08em`, uppercase, `#7C766A` |
| Household code | 34–38px | 500 | IBM Plex Mono, `letter-spacing: 0.14em` |

### Spacing, radii, shadow
- Elder scroll region: `padding: 8px 18px 22px`; `gap: 22px` between slot cards.
- Slot card internals: header `11px 20px`; body `16px 20px 6px`; action block `10px 16px 8px`.
- Radii: cards `22px` (elder Today) / `18–20px` (other cards), buttons `14px`, nav pills `16px`,
  pills/badges `999px`.
- Shadow: exactly one — `0 4px 0 rgba(28,26,23,0.18)` on elder cards. No blurred shadows anywhere.

---

## Screens / Views

### Shared entry

**Welcome** — role picker. Logo tile 52px (`#1F5340`, radius 16), title 34px/800, one-line
description 20px. Two 76px stacked buttons: "I take medicines" (filled green) and "I help someone"
(2px `#211F1B` outline). Below them a 60px text button "How it works", then a 15px note "You can
change this later in Settings." Vertically centred, `gap: 28px`, `padding: 24px 24px 34px`.

**How it works** — 4-panel carousel. Top illustration slot 190px (placeholder hatch pattern — needs a
real asset), 28px title, 19px body. Footer: "Back" (outline, flex 1) + "Next"/"Done" (filled, flex 2),
both 60px, above a `1px #E4DFD4` rule. Counter in the header shows "N of 4".

**Sign in** — single 72px "Continue with Google" style button, plus loading and error states.
Loading: tinted panel with a 8px progress bar. Error: red-tinted panel, 2px `#8E2F1E` border,
heading + reason + 60px retry button. Copy is explicit that nothing was changed.

**Pair (supporter)** — household code entry. 68px mono input, 2px navy border. Demo chips fill a
good/bad code. States: invalid code, connection failed, connecting, connected. Each is a tinted
panel with icon + heading + explanation.

---

### Elder view

#### E1 — Today *(the primary screen; most of the redesign is here)*
**Purpose.** See what to take now and mark it taken in one tap, without navigating anywhere.

**Layout.** Column, top to bottom:
1. **Date header** — `padding: 10px 22px 12px`, baseline-aligned row. Left: date, 25px/800,
   `-0.02em`. Right: "TODAY", 15px/800, `0.1em`, uppercase, `#7C766A`.
2. **Offline banner** *(conditional)* — `margin: 0 14px 10px`, `padding: 10px 14px`, radius 12,
   `#FFF4E0` on 2px `#A6741C`. A "!" glyph and one 17px/700 line: "No internet — your taps are saved
   here." One line only; never wraps to a paragraph.
3. **Slot list** — the flexible region: `flex: 1`, `overflow-y: auto`,
   `padding: 8px 18px 22px`, `gap: 22px`. Cards are natural height (`flex: none`) — they do **not**
   stretch to fill. Two slots fit the 844px frame comfortably with margin above the first; a third or
   more scrolls. This is intentional: stretching cards to fill made the screen read as blocks.
4. **Bottom nav** — `padding: 10px 14px 18px`, `border-top: 2px solid #211F1B`, `background: #FFFFFF`.
   Three equal 64px pills, 17px/800: Today · Fill the box · Settings. Active pill is
   `#211F1B` with `#FBF9F5` text; inactive is transparent with `#1C1A17` text. Always visible.

**Slot card anatomy** (the core component):
- Shell: `#FFFFFF`, radius 22, `2px solid <state fg>`, `box-shadow: 0 4px 0 rgba(28,26,23,0.18)`,
  `overflow: hidden`.
- **Header band**: solid fill in the state colour, `padding: 11px 20px`. Slot name 26px/800 white on
  the left; time 20px/700 white, tabular-nums, right-aligned. Both `white-space: nowrap`. The band
  is what makes state legible across the room.
- **Body**: `padding: 16px 20px 6px`, `gap: 10px`. Medicine names 21px/600 on **one line** with
  `overflow: hidden; text-overflow: ellipsis` — long lists collapse to e.g. "Atorvastatin and 1
  more" (see *Copy rules*). Below: a 24px ringed glyph in the state colour + status text 18px/700 in
  the state colour.
- **Actions**: `padding: 10px 16px 8px`, column, `gap: 2px`.
  - **One** real button, full width, 54px: "I have taken these" (filled `#1F5340`, white, 18px/800).
    When everything in the slot is already marked it becomes "Undo this" — 2px `#7C766A` outline on
    `#F1EDE3`, ink `#45423C`.
  - Beneath it, "See the pills" as a 46px borderless underlined link, 17px/700, `#1F5340`. It is a
    link, not a button, on purpose — two equal-weight buttons per card made the screen feel busy.

**Other states of E1:**
- *Loading*: "Getting today ready…" 18px, then three 128px skeleton blocks in descending tints.
- *Empty (no medicines yet)*: white explainer card + a green code card with the household code at
  38px mono and 58px "Copy" / "Send it" buttons. Explains that the helper adds medicines.
- *Nothing due today*: centred 56px green check circle, 26px/800 "Nothing to take today", 19px
  explanation of when the next dose is.

#### E2 — Slot detail ("See the pills")
**Purpose.** Recognise each pill and mark doses individually.

Header: 56px "‹ Today" button (2px `#211F1B`, white) on the left; slot name 28px/800 and time
20px/700 right-aligned. Then one card per medicine: radius 20, white, `2px solid <dose state>`,
same hard shadow, `padding: 14px`, `gap: 11px`. Each card is a tappable row — 78px pill photo
(radius 14, 2px `#C5BEAE`; **placeholder in the prototype, needs real photography**) beside a stack:
name + strength 23px/800, "dose · purpose" 19px, state line 18px/800, and an underlined "Bigger
picture and notes" 17px/700 link. Below the row, a 60px primary "I have taken this" (or 60px outline
"Undo — not taken"), plus a 46px underlined text action "Leave this one out today" /
"Put it back on the list". Footer above the nav: full-width 62px outline button
"{take label} — all of {slot}" or "Undo all of {slot}".

#### E3 — Fill the box
A single-page weekly pill-organiser flow. Medicines are shown as **7-day quantity strips**, not a
table: one chip per weekday with the quantity, `#E7F1EA`/`#1F5340` when there is a dose,
`#F2EEE6`/`#9A958A` when there is none. The check grid uses thick borders and large numerals.
Variants: nothing to do, ready to start, resume in progress. Finishing returns to Today with a
"Box marked as prepared for this week" toast.

#### E4 — Settings *(the only elder screen that scrolls by design)*
Title 27px/800. Sections labelled 15px/800 uppercase `#7C766A`, `gap: 22px` between them, cards
radius 18 / `2px #DDD7CB` / `padding: 18px`:
- **Your account** — name 20px/700, email 17px. Then the green code card (`#E7F1EA` on 2px
  `#1F5340`): code 34px mono, 56px "Copy" / "Send it", and a 52px dashed-amber "Make a new code…".
- **Reminders** — status pill (tinted, ringed glyph + 19px/700 label), 17px note, 58px toggle button,
  52px "Send me a test reminder".
- **How it looks** — theme list, 60px rows, 19px/700, selected row tinted.
- **About** — version, a plain-language disclaimer that the app gives no medical advice, and a link
  to "How it works".
- 62px "Sign out…" (2px `#8E2F1E` outline, red ink) and a 48px "Change role" text link.

---

### Supporter view
Same information architecture, denser and cooler (`#E5E9F0` canvas, `#2A3B5E` primary, 13–23px type).
Screens: **Today** (all slots with per-medicine rows), **Calendar** (month grid with per-day status
tone) → **Day detail**, **Medicines** list → **Medicine form** (name, strength, dose, purpose, photo,
schedule, times of day), **Times of day** (add/rename/remove slots, with a guard that at least one
must remain and a warning naming how many schedules use a slot), **Settings**.

---

## Interactions & Behaviour

**Navigation.** A single `screen` string drives everything; there is no nested router in the
prototype. Elder screens: `e_today`, `e_slot`, `e_settings`, `fill_*`. Supporter screens:
`s_today`, `s_cal`, `s_cal_day`, `s_meds`, `s_form`, `s_times`, `s_settings`. The bottom nav is
always present in the elder view — elders should never be somewhere they can't leave in one tap.

**Marking a dose.** Tapping the slot button marks every unmarked medicine in that slot as taken and
flips the card to the done state (green band, ✓, "All taken") plus a toast. The same button becomes
"Undo this" — undo is always one tap away in the same place, never behind a confirm dialog. Per-dose
marking in E2 behaves the same way at medicine granularity.

**Supporter marking on someone's behalf** is always labelled as such in the confirmation copy.

**Destructive actions** use a centred confirm dialog with an explicit named action
("Remove Morning" / "Keep it"), a plain-language consequence, and the destructive button styled red.

**Toasts** confirm every state change in plain past tense ("Morning marked as taken",
"Times of day saved"). They are the only transient UI.

**Offline.** Taps are queued locally and the banner states it in one sentence. Nothing is disabled.

**Animation.** None beyond default press feedback and the loading progress bars. Motion was kept out
of the elder view deliberately.

**Responsive.** Designed at 390 × 844. The elder layout is a single column with a fixed header and
fixed bottom nav and one scrolling region — it scales to larger phones by giving the scroll region
more room (and therefore showing more slots before scrolling). Do not introduce a second column.

## State Management
State needed by the elder view:
- `screen` — current view.
- `role` — `'elder' | 'supporter'`.
- `openSlot` — which slot E2 is showing.
- `doses` — per (slot × medicine) status: `'unmarked' | 'taken' | 'skipped'`. Everything on Today is
  derived from this: slot state, status text, glyph, whether the button says take or undo.
- `medicines` — name, strength, dose, purpose, photo, which slots it belongs to, which days,
  whether it goes in the pill box, per-slot quantity.
- `timeSlots` — id, display name, time, and how many medicine schedules use it.
- `boxTimes` — which slots the pill organiser covers.
- Settings: `reminders`, `theme`, `supNotif`, escalation window.
- Ephemeral: `toast`, `dialog`, `sheet`.

Derived per slot (do this in a selector, not in the view): the medicines due in it today, how many
are marked, whether it is past due, the resulting state tone, the status string, the medicine-name
summary string, and the take-button label.

Data fetching: today's schedule + dose log on load; dose marks must be optimistic and queued when
offline.

## Copy rules
These matter as much as the visual spec:
- Plain language, no jargon, no medical advice. "I have taken these", not "Confirm dose".
- Medicine names on Today collapse to fit one line: two names join with "and"
  ("Amlodipine and Metformin"); three or more become "{first} and N more"
  ("Atorvastatin and 1 more"). Never wrap, never clip mid-word.
- Errors say what happened, that nothing was lost, and what to do next.
- Skipping is "Leave this one out today", never "Skip" — and it is reversible with
  "Put it back on the list".

## Assets
The prototype ships **no real imagery**. Two placeholders must be replaced:
1. **Pill photos** — 78px rounded squares in E2 (and larger in the medicine detail sheet). Currently
   a diagonal hatch pattern labelled "pill photo". These need real photographs; recognising the
   physical pill is a core feature.
2. **How-it-works illustrations** — a 190px panel per carousel step, currently the same hatch.

Fonts are Google Fonts: Public Sans and IBM Plex Mono. No icon library is used — the few glyphs
(`✓ ○ ! — · ‹ ✕`) are text characters. Replace them with the codebase's icon set if it has one,
keeping the same visual weight.

## Files
- `CarePair.dc.html` — the design source. Template first (structure + exact styles), logic class at
  the bottom (state model, derived values, all copy strings).
- `CarePair-standalone.html` — self-contained build; open in any browser to click through the flows.
  Use the role picker on the Welcome screen to reach the elder view.
