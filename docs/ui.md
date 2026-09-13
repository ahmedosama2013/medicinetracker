# UI

What each screen looks like and the rules behind it. For what the two people
actually *do*, step by step, see [flow.md](flow.md). For how the two devices
work underneath, see [architecture.md](architecture.md).

> **v4 — the elder-first redesign.** This replaces the v3 description
> entirely, and the source is `design_handoff_carepair_elder_ui/`: a handoff
> README plus a navigable HTML prototype. v3 was a *visual* overhaul that left
> the interaction model alone, and the model was the problem — marking a dose
> meant opening a slot, then finding a 30px circle, then tapping it the right
> number of times. v4 rebuilds the elder side around the fact that the user is
> elderly: **marking a dose is one tap from Today**, the type floor doubles,
> every state is a solid colour band readable across a room, and the cycling
> circle is gone. The supporter side keeps its shape and gets a contrast pass
> and an honesty pass.
>
> The prototype is a reference, not code. Nothing was ported from it — it uses
> a bespoke runtime — but its colours, type sizes, spacing, radii and copy are
> final and are reproduced exactly.

## The rules that must not be broken

Ahead of everything else, because they are the ones a later change is most
likely to break without noticing.

**No aggregate adherence, anywhere.** No percentages, no streaks, no scores, no
"78% this month". This is a memory aid and it must never read as judgement of
an elderly person's behaviour. The only counts in the product are quantities of
pills and "2 of 4 in the box". A day reads "All taken" or "2 of 3 dealt with",
never a figure that spans days. **This applies to the supporter's screens too**
— the calendar legend says "No scores, no streaks — just what happened" out
loud, because that is a promise and not a caption.

**Not taking something is a recorded outcome, not a failure.** Neutral grey
(`#3F4048`), never red. Red is reserved for *overdue* and *destructive*, and
those only. The word is "Not taking today", and the action that gets you there
is "Leave this one out today" — never "Skip", never "Missed". It is always
reversible with "Put it back on the list", in the same place.

**Undo is never behind a confirm dialog.** Every mark is instant, raises a toast
carrying Undo, *and* leaves the same undo in the place the mark was made — a
slow reader will miss the toast, and the handoff's usability check flags that
explicitly. Confirmation dialogs are spent only where a tap has consequences
outside the phone: rotating the code, signing out, disconnecting, archiving,
removing a time of day, sharing a photo with strangers.

**One primary action per card.** "See the pills" is an underlined text link
beneath the button, not a second button. Two equal-weight buttons per card made
the screen read as busy, which on this screen means "which one do I press?".

**The type and touch floors.** Nothing in the elder view below 15px; nothing
the person must read in order to act below 17px. Slot names 26px, screen titles
25–27px. Every target at least 44px; primary actions 54–64px. Where a floor and
a tidy single line conflict — the date at 320px, the offline banner on a narrow
phone — **the floor wins and the text takes a second line.**

**Filling the pill box must never write to the dose log.** Filling a tray is not
taking a medicine, and conflating them would quietly falsify the calendar. That
flow has its own vocabulary ("It is in the box", never "taken"), its own
progress bar explicitly labelled as job progress, a blue information band that
says so on entry, and no "taken" affordance anywhere in it.

**The whole day is always shown.** Nothing is hidden because its time has
passed. Hiding a passed slot turns a late dose into an unrecoverable state.

**Nothing *moves* because of the clock.** Morning stays at the top all day and
bedtime stays at the bottom. Nothing reorders, dims or promotes itself at its
own hour. The late tone is the single exception and it only *recolours*: a slot
whose time has passed with something unmarked turns red in place. It never
jumps the queue.

**Nothing may say it worked when it did not.** A state that could not be read is
reported as unknown, not as its safe default. A nudge that reached nobody is
not a send. An in-place update that finds its node gone re-renders from the
store rather than silently doing nothing.

## Two dialects, one stylesheet

A class on `<body>` switches the palette, type scale and density through custom
properties. There is one stylesheet and no duplicated rules.

| | `.mode-simple` — taking medicines | `.mode-supporter` — helping |
|---|---|---|
| Canvas | `#D9D1BF` — deliberately dark | `#E5E9F0` |
| Primary | green `#1F5340` | navy `#2A3B5E` |
| Body text | 17–21px | 13–16px |
| Titles | 25–27px | 22–23px |
| Tap targets | 44px floor, 54–64px primary | 40–44px |
| Card borders | 2–3px, in the state colour | 1px, neutral |
| Shadow | one hard `0 4px 0` | none |
| Navigation | 3 pills, 64px, 17px/800 | 5 pills, 52px, 13px/700 |
| Scrolling | Settings only, by design | everywhere |

The canvas is the load-bearing decision on the elder side. v3 used a warm
near-white and white cards merged into it; `#D9D1BF` is dark enough that a
white card is unmistakably an object sitting on a surface. Everything else —
the hard shadow with no blur, the 2px borders, the solid header bands — exists
to keep that separation at arm's length and in poor light.

The supporter's canvas moved the other way for the same reason: v3's `#F7F8FA`
was so close to white that their cards had no edge. `#E5E9F0` is a real step
down, so a white card separates without needing a heavier border.

### The layout shell

Every view renders exactly **one `.screen`** into `#app`, and the shell is a
fixed viewport column:

```
body (100dvh, overflow hidden)
 └── #app
      └── .screen
           ├── .screen-head    fixed — the date, a title, a form bar
           ├── .screen-scroll  the ONE scrolling region
           └── .screen-foot    fixed — "Start filling the box", "all of Morning"
 └── #bottomnav                always visible in the elder view
```

This is what makes 320px and 430px the same layout rather than two. A taller
phone gives the scroll region more room and therefore shows more slot cards
before it scrolls; nothing reflows, nothing rearranges. **There is never a
second column** — above ~600px the single column caps at 34rem and centres,
which is the desktop story too.

What gives way on a narrow phone is horizontal padding and gaps, never type.
Nav labels wrap to a second line rather than shrink, because the 17px floor
outranks a tidy single line.

`100dvh` with a `100vh` fallback, and `env(safe-area-inset-bottom)` on the nav
and every bottom sheet.

### The bottom bar

Three text pills for the elder, five for the supporter. **No icons**: a glyph
beside a 17px label costs vertical room inside a 64px target and says nothing
the word does not. The current tab is a filled `#211F1B` lozenge with knocked-
out text — a shape that is either present or absent, which survives greyscale,
a glance and arm's length. Colour rides on top as reinforcement, never as the
message.

The elder's bar is **Today · Fill the box · Settings** and is always visible:
an elder should never be somewhere they cannot leave in one tap.

**Calendar is deliberately not one of the elder's tabs.** Their day is Today; a
month grid of their own adherence is the report card this app does not issue.
The route stays registered so an old bookmark still resolves, but it is not a
place to go looking. The supporter keeps it — reading the record is a large
part of why they open the app.

A tab stays current across the screens it owns: the medicine *form* belongs to
Medicines, the day detail belongs to Calendar, the slot detail belongs to
Today. That is a `match` list in `js/main.js`, not a `startsWith` — `#/medicine`
does not start with `#/medicines`.

## Type

**Public Sans** for everything, **IBM Plex Mono** for the household code and the
small mono counters only. Both from Google Fonts with `display=swap`, behind a
`preconnect` to both Google origins.

This **reverses v3's "no webfont" rule**, and the trade-off is worth stating
plainly rather than discovering later: offline, or before the font arrives, the
app renders in the system stack in `--font`. That is a visual downgrade, not a
functional one — nothing is invisible and nothing moves much, because the
fallback's metrics are close enough that the swap does not reflow the slot
cards. The redesign leans hard on weight (800) at large sizes for its
personality, and the system stack cannot carry that at 26px; the handoff
specifies Public Sans for exactly this reason.

| Role | Size | Weight | Notes |
|---|---|---|---|
| Screen title (elder) | 25–27px | 800 | `-0.02em` |
| Slot name | 26px | 800 | white on the state band, `nowrap` |
| Slot time | 20px | 700 | `tabular-nums`, `nowrap` |
| Medicine list on Today | 21px | 600 | one line, ellipsis |
| Slot status | 18px | 700 | in the state colour |
| Primary button | 18px | 800 | |
| Text link | 17px | 700 | underlined, 46px tall |
| Body copy | 17–19px | 400–700 | `line-height: 1.45` |
| Section label | 15px | 800 | `0.08em`, uppercase, `#7C766A` |
| Household code | 34–38px | 500 | IBM Plex Mono, `0.14em` |

`tabular-nums` on every number a person reads aloud or counts against a physical
object: times, doses, the share code, calendar days, the pill-box grid.

## Colour and state

**Colour + shape + word, never colour alone.** Every state carries a tone, a
typographic glyph and a word. The glyphs are text characters (`✓ ○ ! — · ▣`)
rather than icons, so they scale with the phone's own text-size setting.

Four tones drive everything on a day screen. A node gets `--state-fg` and
`--state-bg` set on it and every child reads them, so one assignment paints the
border, the header band, the ringed glyph and the status text together.

| State | When | Colour | Glyph | Reads |
|---|---|---|---|---|
| Waiting | nothing marked, not past due | `#55514A` charcoal | `○` | "Still to come" |
| Late | nothing marked, past due | `#8E2F1E` red | `!` | "Not taken yet" |
| Partial | some marked | charcoal, or red if past due | `○` | "2 of 3 dealt with" |
| Done | everything dealt with | `#1F5340` green | `✓` | "All taken" / "All dealt with · 1 not taken" |

"Done" is the broader claim and "All taken" the narrower one. A slot with
something left out today has been *handled*, so it takes the green tone — but
it says "All dealt with · 1 not taken", because saying "All taken" there would
be a lie.

Lateness applies **only to today**. A slot on a past calendar day is not late,
it is history, and painting last Tuesday red would be scoring the person.

Semantic colour has one job each: green means "done or go", amber `#7A5410`
means "needs attention, no blame" (offline, rotating the code, a partially
marked past day), red `#8E2F1E` means overdue or destructive and nothing else,
and neutral grey means "not taking this today".

### Dark mode

Selectable in Settings — Match system, Light, Dark — and applied before the
first render so an explicit dark choice never flashes light. Three states
rather than a switch, because "match my phone" is the default and has to stay
expressible. Low-vision users often need the dark option, which is why it
survived the review that asked whether to drop it.

Every semantic name is redefined, never derived. Two consequences worth knowing
before adding a component:

- **Fills lighten and the text on them darkens.** A `#1F5340` button on a
  near-black canvas is a dark shape on a dark ground, which reads as disabled.
  `--on-state`, `--on-green`, `--on-navy` and `--on-red` all flip with the
  theme, so a solid state band keeps its contrast in both.
- **Shadows carry no information on a dark canvas.** The hard `0 4px 0` becomes
  a black one and does very little; separation there comes from the surface
  ladder plus the 2px borders, which the elder cards have anyway.

### Motion

**There is effectively none, and that is the design.** The handoff is explicit:
motion was kept out of the elder view deliberately. What remains is default
press feedback (a 1px translate) and the indeterminate progress bars on sign-in
and pairing. No card transitions, no slide-in sheets, no page-load animation.
`prefers-reduced-motion` collapses even the progress bars and slows the spinner
rather than making it an invisible ring.

## The pill identity

A medicine has exactly one visual identity — its photo — and it appears at
every size, on every screen, in both roles: 78px in the elder's slot detail,
96px in the sheet, 52px in a pill-box compartment, 44px on the supporter's
lists, 36px on their day rows.

A **rounded square, not a circle** — supporters photograph oblong tablets and
blister strips, and a circular mask eats the ends of both.

With no photo the tile is a **hatch placeholder labelled "pill photo"**, and
that is a change from v3's tinted fallback tile. A tinted tile with a glyph
looked like a design decision; the hatch looks like what it is — a missing
photograph, and on the supporter's screens a job they can do. The supporter's
medicine list says so in words as well ("No photos yet", "Pill photo only").

The prototype ships no real imagery. **Two placeholders still need real
assets**: the pill photos, and the four how-it-works illustrations. The
illustrations are currently line drawings carried over from v3 at the specified
190px — decorative only, with every step's meaning in its title and body — so
the panel never reads as a broken image.

## Elder screens

### E1 — Today

The screen most of this redesign is. Column, top to bottom:

1. **Date header** — the date at 25px/800, "TODAY" at 15px/800 tracked and
   uppercase on the right.
2. **Offline banner**, conditional — one amber line, never a paragraph: "No
   internet — your taps are saved here." Shown when the browser is offline *or*
   the outbox has queued taps. **Nothing on the screen is disabled by it.**
3. **The slot list** — the one scrolling region, 22px between cards, 20px
   inside, margin above the first.
4. **The bottom nav**, always visible.

**The slot card is the component.** A white card, radius 22, `2px solid` in the
state colour, one hard `0 4px 0` shadow, and:

- A **solid header band** in the state colour with white text: slot name 26px
  on the left, time 20px tabular on the right, both `nowrap`. The band is what
  makes the state legible across a room, and it is why the border matches it.
- The **medicine names on one line**, 21px/600, collapsed to fit (below).
- A **24px ringed glyph** plus the status text, both in the state colour.
- **One button, full width, 54px**: "I have taken these" — or "I have taken it"
  when the slot holds one medicine. When everything in the slot is already
  marked it becomes **"Undo this"**, a `#F1EDE3` outline in the same place.
- Beneath it, **"See the pills"** as a 46px underlined link.

**Cards are natural height and do not stretch to fill.** Stretching them made
the day read as blocks rather than as things to do. Two slots fit a phone
comfortably with margin above the first; a third scrolls, and that is fine.

**Marking is one tap.** The button marks every *unmarked* medicine in the slot
as taken and flips the card in place to the done state, plus a toast with Undo.
Something deliberately left out today survives it — the person said something
about that medicine and this button must not overrule it. "Undo this" clears
the whole slot, left-outs included: it means "put this back to untouched", and
leaving one behind would make the button's effect depend on invisible history.

**Medicine names never wrap and never clip mid-word.** One name is itself; two
join with "and"; three or more become "{first} and N more". A third rule is not
optional: two names can be long on their own — "Atorvastatin and Latanoprost
drops" is 33 characters — so past a 30-character budget a pair also takes the
"and 1 more" form. That is the handoff's own worked example. The CSS ellipsis
behind this is the second line of defence, not the mechanism.

**Other states.** *Loading*: "Getting today ready…" and three 128px skeletons in
descending tints. *No medicines yet*: a white explainer card plus the green
code card, the code at 38px mono with 58px Copy / Send it — because until a
helper enters it there is nothing else to show, and its only job is to be read
aloud down a phone line. *Nothing due*: a 56px green check circle, "Nothing to
take today", and when the next one is.

There is no progress rail and no "Now" label. Both were v3; the state bands say
more, louder, in the place the person is already looking.

### E2 — One time of day ("See the pills")

Reached only from a Today card, never from the nav. Today already marks the
whole slot in one tap; this screen exists for the other question — *is this the
right tablet?* — so the photo comes first and every medicine gets its own
button.

A 56px "‹ Today" button on the left; the slot name at 28px and its time
right-aligned. Then one card per medicine: radius 20, `2px solid` in that
**dose's** state, the same hard shadow. Each card is a tappable row — a 78px
pill photo beside the name and strength at 23px/800, "dose · purpose" at 19px,
the state line at 18px/800, and an underlined "Bigger picture and notes" link —
then a 60px primary "I have taken this" (or a 60px outline "Undo — not taken"),
then a 46px text action: "Leave this one out today", or "Put it back on the
list" once it has been.

Above the nav, a full-width 62px outline button: "{take label} — all of
{slot}", or "Undo all of {slot}".

A dose the supporter marked reads "✓ Taken · Marked by your helper", so a tick
the person did not make is never a surprise. Only on their own screen: on the
helper's it would be telling them what they already know.

> **A deliberate departure from the prototype.** Its medicine cards are
> `flex: 1 1 0`, dividing the screen between however many there are. That is
> lovely with two and clips with five, and clipping a dose is not a trade this
> screen gets to make. The cards are natural height in the scrolling region
> instead — identical for the two- and three-medicine cases that cover almost
> every household, and it simply scrolls beyond that.

### E3 — Fill the box

Reached from the elder's **Fill the box** tab and the supporter's **Box** tab.
Both roles have it: whoever is holding the tray fills it. (In v3 it lived under
Settings → Pill box; it is a tab now because the nav had room once Calendar
left the elder's bar, and a weekly job is easier to find than to remember.)

**Start** — a navy information band that says filling the box does not mean
anything has been taken; two rows for the week and which compartments the box
has, each opening a sheet; then how many medicines go in, a resume panel if a
sitting was interrupted, and an outline button listing what stays *out* of the
box with its reason. Two reasons, two sentences: a syrup cannot go in a
compartment at all, whereas a tablet at an unticked time of day is out because
of how this household's box is shaped — and only the second is something the
person can change.

**A step per medicine** — the mono "Medicine 1 of 4", a progress bar, and a line
that says what it is progress *through* ("0 of 4 put in the box — this is how
far through the job you are, nothing else"). Then the name at 30px, both photos
side by side at 130px, and the quantity card.

**Quantities are chips, not a table.** One chip per weekday with the number in
it, `#E7F1EA`/`#1F5340` where there is a dose and grey `–` where there is not.
A table of ticks is unreadable at arm's length on a kitchen table; seven chips
are countable at a glance. Above them the week's total as the largest thing in
the card, because everything else there is reference and that is an instruction.

**Check** — a 7-day × compartment grid of totals with thick borders and large
numerals, because counting is how a filled tray is actually verified and pill
colour is unknowable from a photo. Tapping a compartment lists what belongs in
it with real photos, since "the count is wrong" is only useful if you can find
out which one is missing.

**There is no verdict.** No tick, no "looks right". The app cannot see the tray,
and one that claimed the tray was correct would be claiming something it has no
way to know. The intro says so.

Which times of day go in the box is a per-slot tick list rather than a
compartment count. A count has a hole in it: with a 7×2 tray and four times of
day, the afternoon and evening medicines have nowhere to go, and merging two
times into one compartment puts the afternoon dose where it gets taken at
breakfast. That is the one place this app could actively mislead someone.

### E4 — Settings

**The only elder screen that scrolls by design.** Four sections at 22px apart,
each a 15px/800 uppercase label over a radius-18 card with a 2px hairline
border:

- **Your account** — name and email, then the green code card: the code at 34px
  mono, 56px Copy / Send it, and a 52px dashed-amber "Make a new code…".
- **Reminders** — a tinted status pill with a ringed glyph, a plain-language
  note, a 58px toggle and a 52px "Send me a test reminder". Three states, not
  two: on, off, and *not available* when the phone has blocked notifications —
  a switch that cannot be wrong is worse than one that admits it does not know.
- **How it looks** — three 60px rows, the selected one filled and ticked.
- **About** — version, a plain-language disclaimer that the app gives no
  medical advice, and a link to How it works.

Then a 62px red-outline "Sign out…" and, below it, a 48px underlined "Change
role (back to the start)". **A role switcher is a trap** for the person taking
the medicines — one wrong tap and they are in an admin app — so it is an escape
hatch at the very bottom, not a settings row.

## Supporter screens

Same information architecture, deliberately denser, and tightened for trust.
They open on Today, because "did they take it?" is why they open the app.

### Today

A collapsible slot list: a row per time of day with a state ring, "Morning ·
8:00 am", the status and the count, and an Open/Hide affordance. Expanding
shows a photo, name and state per medicine with **Mark taken** / **Clear**, and
a footer action **Mark the whole slot**.

Marking the whole slot is real and reversible but it is **never the primary
action** — making it primary invites marking everything at 8am before anything
has been swallowed. It is an outline button at the bottom of an opened row.

Three things above the list exist because the helper is always looking at a
copy of someone else's day:

- **A live sync line** — a dot, "Updated 2 minutes ago", and **Check now**. The
  dot turns amber past fifteen minutes. Their copy is polled, not live:
  Realtime respects RLS and a supporter has no session, so no event can reach
  them. Polled data presenting itself as live is a lie the person only
  discovers when it matters, and "they haven't marked anything" is precisely
  the wrong thing to be wrong about.
- **A date warning** when their phone's date differs from the household's: "You
  are looking at their day." Shown only when the two actually differ.
- **A failure panel** when a refresh fails, stating how stale the data is *and*
  that marks made now are saved and sent when the connection returns.

**Acting on someone else's behalf is always labelled.** The first mark of a
session asks — naming the person, and naming how many medicines when it is a
whole slot — and then never asks again, replaced by a persistent dashed pill:
"Marking on Margaret's behalf this session". Once per session rather than per
tap: a helper marks several in a row, and a dialog on each is how you train
someone to dismiss dialogs unread.

**Nudge their phone** sits in the header. Rate limited on the server, because a
worried relative tapping four times must not produce four buzzes on an elderly
person's phone. It never names a medicine, and it reports "they have not turned
reminders on" differently from "sent", because silence would otherwise read as
being ignored.

The header date is abbreviated — "Sun 13 Sep" — because the full form and the
Nudge button do not fit one 375px row at 23px. It is the only abbreviated date
in the app, and the helper's dialect is the denser one.

### Calendar

A month grid of tinted day tiles, replacing v3's conic-gradient rings. **Six
states, each visually *and* textually distinct**, because no mark here may be
carried by colour alone:

| | Means | Tone |
|---|---|---|
| `✓` | every medicine dealt with | green |
| `○` | something still unmarked | amber |
| `—` | something not taken | neutral grey |
| `·` | nothing was due | paper |
| *(blank)* | a future day, not markable | white, cool border |
| `▣` before the mark | a read-only record, past the freeze line | — |

Today carries a 3px navy border. The legend spells all of it out in words and
ends with "No scores, no streaks — just what happened."

### One day

A **screen** now, not a sheet over the grid. A day opened from the calendar is
somewhere you stay for a while — reading what happened, opening a medicine,
correcting a mark — and a sheet made all three feel like a peek.

It states which of three framings applies before showing anything: *editable*
("You can still correct this day"), *locked* (kept as a record, past the freeze
line — said in words rather than shown as dead buttons), or *future* (you can
see what is planned, nothing can be marked). Then a card per slot with a tinted
head and a row per medicine, each with **Change** when the day is editable —
which opens the same medicine sheet with the same words on the same buttons.
There is no second vocabulary for fixing yesterday.

### Medicines

A visual inventory: the tile, the name and strength, the schedule summary, and
the photo state in words. **Archive** on each row names its consequence — it
leaves Today and the pill box, the past record stays, it can be restored — and
names both actions, "Archive" / "Keep it". Archived medicines are behind a
"Show archived (N)" link, dashed, with **Restore**.

### Medicine form

Three sections in the order someone holding a packet works through them: **what
it is**, **photos**, **when they take it**. The medicine and its times are
deliberately not two screens — a medicine that exists but is scheduled nowhere
appears on no screen and the helper has no way to notice, so there is no save
without at least one time.

Choices that are a small closed set — the form, how often — are **chips rather
than dropdowns**. A chip shows every option at once, which is what makes
"Liquid" discoverable as the thing that keeps a medicine out of the pill box.

Validation says how many things need fixing and lists them in one line at the
top, so the person knows the size of the job before scrolling to find them.

### Times of day

The words the person taking the medicines reads on their Today screen, and the
compartments of the physical pill box. **Removing one names how many medicine
schedules use it** — "3 medicine schedules use Morning. They will need a new
time of day before they appear on Today again." — with "Remove Morning" /
"Keep it". At least one must remain.

### Settings

Connection, the helper's own alerts (with "How long to wait first" as four
chips — the delay is framed as alerting *them*, never as a warning aimed at the
person taking medicines, who never sees it), Times of day, Appearance, About.

## Shared entry

**Welcome** — a 52px logo tile, the name at 34px, a one-line description, then
two 76px stacked buttons and nothing competing with them: "I take the
medicines" filled green, "I help someone with their medicines" outlined. Below,
a 60px "How it works" text button and a 15px note that the choice is
changeable.

**How it works** — a four-panel carousel at `#/how`. A route rather than a
sheet: it creates no data, so it is safe to open from anywhere, and being a
route means the phone's own Back button leaves it. Both Settings screens link
to it with a `from` parameter, so Close returns where it was opened from.

**Sign in** — one 72px "Continue with Google", plus loading and error states.
The error copy follows the rule every error in the app follows: say what
happened, say that nothing was lost, say what to do next.

**Pair** — the helper's code entry, painted in *their* palette before a role
exists, so they land in their own product from the first tap. A 68px mono input
with a 2px navy border, upper-cased in place because the code is printed upper
case on the other phone. Four states, each a tinted panel with a glyph, a
heading and an explanation: invalid code, connection failed, connecting,
connected. The two failures are deliberately different — a wrong code is the
helper's to fix by asking; a dropped connection is not their fault and must not
be reported as if it were.

## Interaction primitives

All in [js/ui.js](../js/ui.js). The pattern rule: **full screens for places you
live in, bottom sheets for things you look at, centre dialogs only for
consequences.**

- **Dialog** — centred, and the two buttons **stack**. The confirm button
  *names the action* ("Remove Morning", "Sign out", "Yes, mark on their
  behalf") and the cancel button names the alternative ("Keep it", "Stay signed
  in", "Not now"). Never "OK / Cancel", and never side by side — a named action
  is long, and truncating it is exactly what a confirm dialog must not do. The
  destructive confirm is filled red; the safe one is filled green.
- **Sheet** — rises from the bottom, radius 26 (22 for the supporter), with an
  optional fixed foot below the scrolling body so a medicine sheet's take/undo
  buttons are reachable without scrolling past the notes. Sheets stack and
  **Escape closes only the topmost**.
- **Toast** — confirms every state change in plain past tense, and carries Undo
  for anything reversible. The only transient UI in the app.
- **Photo viewer** — full screen on `#14120F`, with a labelled bar and a 52px
  Close. The reason the app exists, so it gets the whole screen.
- **Busy overlay** — for something slow enough that a disabled button is not
  enough of an answer. Names the step it is on. Saving a medicine is its only
  user and it earns it: the medicine, its schedule, a photo upload and a cache
  refresh, one after the other.
- **Overlays are dismissed on navigation.** An open sheet used to survive the
  screen underneath it changing, leaving a Close button that returned to a card
  no longer there. The router closes them on a genuine navigation — keyed on
  the **full hash**, query included, so `refresh()` (Realtime, the poll, the
  midnight check) does not close a sheet someone is reading, while
  `?step=check` → `?step=1` does.

Every overlay traps **Tab** as well as Escape, moves focus inside on open, and
returns focus to whatever opened it on close. `aria-modal` tells a screen reader
the page behind is inert and does nothing whatever about the tab order, so
without the trap focus walked straight out into the screen behind — which for a
keyboard or switch user is the difference between a modal and a decoration.

## Colour tokens

Light values. Every one is redefined for dark, never derived.
Full set in [css/app.css](../css/app.css) sections 1–3.

| Token | Value | Used for |
|---|---|---|
| `--ink` / `--ink-2` / `--ink-3` | `#1C1A17` / `#45423C` / `#55514A` | body, secondary, tertiary text |
| `--muted` / `--faint` | `#7C766A` / `#9A958A` | labels and captions / disabled |
| `--frame` | `#211F1B` | hard borders, the active nav pill |
| `--e-canvas` / `--e-card` | `#D9D1BF` / `#FFFFFF` | elder page / cards |
| `--s-canvas` / `--s-card` | `#E5E9F0` / `#FFFFFF` | supporter page / cards |
| `--green` / `--green-tint` / `--green-line` | `#1F5340` / `#E7F1EA` / `#9CC0AC` | primary, done |
| `--navy` | `#2A3B5E` | supporter primary |
| `--red` / `--red-tint` | `#8E2F1E` / `#FBEAE5` | overdue and destructive **only** |
| `--amber` / `--amber-ink` / `--amber-tint` | `#A6741C` / `#7A5410` / `#FFF4E0` | needs attention, no blame |
| `--neutral` / `--neutral-tint` | `#3F4048` / `#ECEBEE` | "not taking today" — never red |
| `--lift` | `0 4px 0 rgba(28,26,23,0.18)` | the one shadow in the app |

No grey-on-grey, no thin weights, and no icon-only control without a label.
