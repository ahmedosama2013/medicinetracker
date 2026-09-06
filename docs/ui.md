# UI

What each screen looks like and the rules behind it. For what the two people
actually *do*, step by step, see [flow.md](flow.md). For why the v3 work was
sequenced the way it was, and what is still to come, see
[v3-plan.md](v3-plan.md).

> **v3.** This replaces the v2 description entirely. v2 was tidy but generic:
> flat cards on the cold grey every framework ships with, one corner radius,
> `font-weight: 800` in thirteen places, and a 42px photo hidden behind a tap
> on the one screen where identifying a pill is the whole job. v3 makes the
> photo the unit of the interface, gives skipping a dose somewhere to live,
> adds dark mode, and gives the supporter the same screens as the person they
> are helping.

## The rules that must not be broken

Ahead of everything else, because they are the ones a later change is most
likely to break without noticing.

**No aggregate adherence, anywhere.** No percentages, no streaks, no scores, no
"78% this month". This is a memory aid and it must never read as judgement of
an elderly person's behaviour. The one progress indicator in the app is the
rail on Today, and it is bounded to today on purpose: it resets at midnight, is
never stored, and has no historical counterpart. Knowing "two of four done"
while standing in your kitchen is orientation. A monthly figure is a report
card. **This applies to the supporter's screens too** — they see the same rings
the elder sees, and nothing that sums them up.

**Skipped is a recorded outcome, not a failure.** Amber, never red. The word is
"Skipped", never "Missed". A slot containing a skipped medicine says "All
marked", not "All taken", and takes a neutral tint rather than an alarmed one —
one skipped medicine out of six is not a problem with the slot.

**Organiser mode must never write to the dose log.** Filling a tray is not
taking a medicine, and conflating them would quietly falsify the calendar.
(Phase 3; written down now so it is not discovered late.)

**The whole day is always shown.** Nothing is hidden because its time has
passed. Hiding a passed slot turns a late dose into an unrecoverable state.

**Nothing *moves* because of the clock.** Morning stays at the top all day and
night stays at the bottom. Nothing reorders, dims, or promotes itself at its
own hour. The `Now` label is the single exception and it only labels — this
rule used to read "nothing reacts to the clock" and was relaxed deliberately,
because a fixed order cannot say where in the day you are.

## Two densities, one stylesheet

A class on `<body>` switches the type and target scale through custom
properties, not a duplicated stylesheet.

| | `.mode-simple` | `.mode-supporter` |
|---|---|---|
| Body text | 16px | 15px |
| Tap targets | 46px minimum | 40px minimum |
| Row height | 58px | 48px |
| Content width | 28rem | 42rem |
| Navigation | bottom bar, 3 tabs | bottom bar, 4 tabs |

The two now differ mainly on **touch, not text**. Once a photo carries the
recognition, 20px body copy stops earning its space — but a 46px target still
does, and it stays (the accessibility floor is 44px). Simple mode has come down
from 20px/56px at launch, through 18px/52px and 16px/46px, to type that is
close to the supporter's with the target untouched.

The row got *taller* (58px, from 46px) to fit a 44px photo tile. The day still
fits on one screen because a completed slot collapses to a strip of photos.

Font sizes are all `rem`/`em`, so the phone's own text-size setting works.
**Still no webfont**: an offline app cannot wait on a CDN. Personality comes
from restraint instead — weight capped at 600, `-0.015em` tracking on headings,
and `tabular-nums` on every number a person reads aloud or counts against a
physical object (times, doses, the share code, calendar days).

Responsive by being one column that grows. `#app` has a per-mode `max-width`
and centres itself; 375px, 768px and 1280px are the same layout with different
side margins, never a different arrangement.

## Visual language

> **The mistake worth not repeating.** The first v3 build looked far greyer
> than its mockups, and the reason was not the palette. The mockups used
> *tinted fallback tiles* for every medicine, so the screen was full of colour.
> Real photos replace those tiles — and real photos of white tablets are grey
> and brown. **The app got less colourful the moment real data arrived.**
>
> So colour has to live in the chrome, not the content. That is what the
> time-of-day bands below are for: they are the only colour on Today that does
> not depend on something having been photographed or marked.

- **A warm canvas.** `#ebe6da` paper rather than the cold `#f6f7fb` of v2, so a
  white card reads as a card. The first attempt used `#f3f1ea`, about 4% off
  white, which on a real phone was not a difference at all — cards merged into
  the page instead of sitting on it.
- **Paper grain.** A very faint `feTurbulence` noise, fixed behind everything,
  as a data URI: no request, no asset, works offline. A perfectly even fill has
  no surface. Kept below the threshold where it reads as texture — if you can
  point at it, it is too strong.
- **Light from above.** A soft radial wash at the top of the canvas. Page
  headings are plain text on the background, so without it the top third of
  every screen was its emptiest part.
- **Shadows are warm and doubled.** A tight contact shadow plus a wide soft one.
  A single 6%-opacity blur — what v3 first shipped — is invisible, and a
  neutral grey shadow on a warm canvas reads as dirt rather than depth.
- **Time of day is the slot's identity.** Morning amber, midday blue, evening
  coral, night indigo: a tinted header band and a sun/sunset/moon glyph.
  Derived from the slot's **time**, never its label, because labels are
  editable and will be translated. Informational, not decorative — and it means
  a day with nothing marked yet still has colour and structure.
- **Brand blue is unchanged** (`#1a56a0`). It is baked into
  `icons/make-icons.py` and `theme-color`, so changing it would mean
  regenerating home-screen icons already installed on real phones.
- **Semantic colour has one job each.** Teal for taken, amber for skipped, red
  for destructive, coral for the passive `Now` marker and non-blocking notices.
  Violet stays decorative only — today's calendar ring, the supporter role chip
  — so it can never be mistaken for a status.
- **`tint` versus `wash`.** Two tokens per semantic colour. `tint` is for small
  fills (a badge, a 44px tile); `wash` is for whole surfaces. They are
  identical in light mode and diverge sharply in dark, because a value that
  reads as a whisper behind an 18px badge reads as a shout as an entire card.
- **Shape varies by role.** Buttons and chips are fully round; cards, sheets and
  inputs use three smaller radius steps. Round means "tappable action".
- **Icons are masked inline SVG**, defined once as custom properties. No icon
  font, no image requests, no build step.

### Dark mode

Selectable in Settings — system, light, or dark — and applied before the first
render so an explicit dark choice never flashes light. Three states rather than
a switch, because "match my phone" is the default and has to stay expressible.

Two things it forced, both worth keeping in mind when adding a component:

- **Shadows carry no information on a dark canvas.** Elevation there comes from
  the surface ladder (`#171613` → `#201f1b` → `#2a2823`) plus hairlines, so
  anything that relies on a shadow to separate itself needs a border as well.
- **Positive states must stay saturated, not dimmed.** The naive inverse of a
  pale green is a grey-green that reads as "disabled". A completed slot in dark
  mode is a deep teal wash with light teal text.

### Motion

Purposeful. Every animation answers something the person did or something that
just became true. A slot completing transitions its whole card; buttons and
rows scale down slightly on press; dialogs, sheets and the photo viewer fade
and rise together so every overlay feels the same; the welcome icon has one
pop-in, the only page-load animation in the app. `prefers-reduced-motion`
collapses all of it — including the loading spinner, which switches to a static
dot rather than becoming an invisible ring.

## The pill identity

The component the redesign is built around. A medicine has exactly one visual
identity and it appears at every size, on every screen, in both roles: 44px on
Today, 34px in the collapsed strip and the Medicines list, 56px in the detail
sheet, overlapped in a stack when a slot is complete.

A **rounded square, not a circle** — supporters photograph oblong tablets and
blister strips, and a circular mask eats the ends of both.

The image inside is `object-fit: contain`, not `cover`, for the same reason
found the hard way against real data: people crop tightly around the pill, so
real photos are often 2:1 wide. A square `cover` crop keeps the middle 50% and
discards both ends, which turns a perfectly good photo of a capsule into a
featureless smear at 44px. `contain` costs a square photo nothing — it still
fills the tile — and keeps a wide one whole, letterboxed against the tile's own
tone so it reads as intentional.

With no photo it falls back to a tinted tile with a glyph, toned by a hash of
the medicine id. That is **not an attempt to guess the pill's real colour**: it
cannot be known from a name, and a wall of near-identical beige is what
extracting it from the photo would actually produce. It is a stable,
distinguishable marker, which is all a fallback can honestly be. Anywhere the
real identity would matter — checking a filled organiser — the UI counts
instead of colouring.

Only two glyphs exist so far, a pill and a droplet. The droplet earns its place
because liquids and drops are the things that must *not* go in a weekly
organiser, so the distinction becomes load-bearing in Phase 3.

A missing photo shows a **dashed** tile rather than nothing. On the supporter's
screens that gap is a job they can do, so it should be visible.

## The dose target

A 30px circle per medicine that cycles **unmarked → taken → skipped →
unmarked**. One tap covers the common case; the rest are deliberate.

Because two taps land on "skipped" and that is reachable by accident, skipped
is loud — amber fill, struck-through name, the photo desaturated — and raises a
toast offering the way back. Undo from there returns to *taken*, not to
unmarked: one tap too many is what got you there.

The accessible label says what the **next** tap does, since the control cycles
and a screen reader cannot see where it currently sits.

Read-only days (the supporter's Today before they confirm, and the elder's
frozen past days) show the same shape without the affordance: a dashed outline
for unmarked, so "you cannot change this here" is visible before anyone tries.

## Simple mode

### Today

Centred heading, the date, then a progress rail, then the day.

Slots are cards in fixed chronological order. Each has a name, its time, and —
on the slot whose time has most recently passed — a passive `Now` label.

**A completed slot collapses** to a strip of overlapping photos, a count, and a
chevron. This is what buys the space for a whole day on one screen. It is
driven by state, never by the clock, and the strip is a button: the photos must
not become unreachable just because the slot was marked done.

Collapsing happens on the **transition** into resolved — so marking every
medicine one at a time ends up exactly where tapping Done does. Editing inside
a slot the person deliberately expanded keeps it open, because collapsing what
someone just chose to open is the jarring case.

**Done marks only what is unmarked.** A deliberate skip survives it: the person
said something about that medicine and the slot button must not overrule it.
**Undo clears the whole slot**, skips included — it means "put this back to
untouched", and leaving amber behind would make the button's effect depend on
invisible history.

A dose the supporter marked shows "Marked by your helper", so a mark the person
did not make is never a surprise.

### A medicine at its own time

A schedule may override its slot's time for one medicine. Marking is keyed on
`(date, slot, medicine)` with no time in it, so an overridden medicine is still
**marked together with the rest of its slot** — two groups sharing a slot
cannot be completed independently, and splitting them would make one Done tap
appear to complete both.

What the override changes is when it is *due*, and that has to stay visible.
The slot header shows the **slot's own** time; a medicine with an override
shows its time on its own row. Both `mergeBySlot` and `app.compute_day`
previously took the earliest time across the slot, so overriding one medicine
to 6am relabelled the whole Morning card "6:00 am" for everything in it —
nothing was written to the slot, but it read exactly as though the override had
moved it.

For a genuinely different hour, the answer is **a new time of day**, not an
override. The medicine form links to it once an override is set, because that
is where someone discovers they wanted one.

### Cold start

Setup ends at sign-in, and nothing can appear until a supporter enters the
code. That used to be "No medicines yet" and a dead end, at the exact moment
someone is most likely to think the app is broken. It is now the share code,
the largest thing on the screen, because its only job is to be read aloud down
a phone line. (The code's character set already excludes `0`, `O`, `1`, `I` and
`L` for the same reason.)

### Medicine detail sheet

Tapping a medicine opens a sheet: photo, strength, dosage, notes, and every
time of day it is due. The full-screen viewer is still there one tap deeper —
matching a tablet against a blister strip needs the photo as large as the
screen allows, and that is the whole reason the photos exist.

With no photo the block is a plain div, not a button. A control that opens a
full-screen view of nothing is a dead end, and a square of empty space pushes
the actual information below the fold.

### Calendar

The month sits on a card, like everything else. Before that it was 42 rings on
bare canvas, which is most of a screen with nothing on it. The "nothing marked"
ring is deliberately the quietest mark on the grid — it is the default state of
most of a month, so it must not be the loudest thing there.

One ring per day. Arc **length** is taken plus skipped over expected; arc
**colour** is teal, or amber once anything that day was skipped. A skipped dose
fills the arc exactly as a taken one does — deciding not to take something is
engaging with the day, and a shorter arc would read as a mark against the
person. Today is outlined in the decorative violet. Days with nothing due have
no ring at all.

## Supporter mode

Same four screens the elder has, plus Medicines. They open on Today, because
"did they take it?" is why they open the app — not on a configuration list.

### Today

The same day renderer. Two things are different:

**A freshness line.** Their copy is polled, not live — Realtime respects RLS
and a supporter has no session, so no events can reach them. The screen says
when it last reached the server. This is not decoration: polled data presenting
itself as live is a lie the person only discovers when it matters, and "they
haven't marked anything" is precisely the wrong thing to be wrong about.

**Mark on behalf.** Supporters fill the organiser and sit with the person while
they take a dose, so one who cannot mark anything ends up telling the elder to
go and tap their own phone. It is allowed, confirmed once per session, and
attributed. Once per session rather than per tap: a supporter marks several in
a row, and a dialog on each is how you train someone to dismiss dialogs unread.

A supporter write needs connectivity and says so when it fails, rather than
appearing to succeed — marking a dose for someone else is not something to
silently defer.

**Nudge.** One button in place of the phone call a supporter actually makes.
Rate limited on the server, because a worried relative tapping four times must
not produce four buzzes on an elderly person's phone. It never names a
medicine, reads "A quick check on your medicines" rather than "you forgot"
(the supporter cannot see whether a dose was taken and simply not marked), and
reports "they have not turned reminders on" differently from "sent", because
silence would otherwise read as being ignored.

### Medicines

A visual inventory rather than a text list: the tile at 34px, from the local
cache rather than a signed URL per row. A medicine with no photo shows the
dashed tile.

### Settings

Both roles: **Appearance** and **About**. Elder adds **Account** (email, share
code, rotate, sign out) and **Reminders**. Supporter adds **Connection** and
**Times of day** — the latter its own section rather than buried under
Connection, because changing what "Morning" means is routine setup and
disconnecting the device is not.

## Interaction primitives

All in [js/ui.js](../js/ui.js):

- **Dialog** — a question with two buttons. In simple mode they stack with the
  confirming action on top, so a big thumb cannot land on the wrong one.
- **Sheet** — the calendar day and the medicine detail. Sheets stack; **Escape
  closes only the topmost**. Every layer registers its own listener, so without
  that guard one press would dismiss the whole stack and drop the person out of
  the day they were looking at.
- **Toast** — a brief confirmation, optionally with one action (used by the
  skipped state). Never for errors that need a decision; those are a dialog.
- **Photo viewer** — full screen, black, tap anywhere to dismiss.
- **Loading state** — a spinner and a live region. Supporter screens go through
  code-gated RPCs and, for photos, an edge function that can cold-start, so
  "tapped, nothing happened" is a real second or more.

Every overlay traps Escape, moves focus inside on open, and is announced.

## Colour and contrast

| Token | Light | Used for |
|---|---|---|
| `--ink` / `--ink-2` / `--ink-3` | `#22211e` / `#57554e` / `#8a877d` | body, secondary, tertiary text |
| `--canvas` / `--surface` | `#f3f1ea` / `#ffffff` | page, cards |
| `--primary` | `#1a56a0` | actions, links, current tab, brand |
| `--taken` | `#0f6e56` | taken doses, calendar rings |
| `--skip` | `#ba7517` | skipped doses |
| `--attn` | `#993c1d` | the `Now` marker, non-blocking notices |
| `--danger` | `#a32d2d` | archive, remove, destructive confirmations |
| `--accent` | `#534ab7` | decorative only — today's ring, the role chip |

Every one is defined twice, once per mode, never derived. Body text stays at or
above 7:1 on the canvas in simple mode; secondary text stays above 4.5:1
wherever it is not purely decorative. No grey-on-grey, no thin weights, no
icon-only controls without a label.
