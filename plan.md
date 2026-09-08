# CarePair UI improvement plan

## Purpose

This plan improves the app for its two primary audiences:

1. The person taking the medicines, who may be older, have reduced vision or dexterity, be unfamiliar with apps, or be worried about making a medication mistake.
2. The supporter who sets up the routine, checks progress, sends reminders, and may fill the weekly pill organiser.

The goal is confidence and predictability. The app should answer these questions quickly:

- What is this app for?
- Which role should I choose?
- Which medicine is this?
- What should be taken now?
- Did my tap work?
- Is the information current?
- How do I fill and check the pill box?

This is a refinement of the current UI, not a redesign of its information architecture. The existing warm visual system, role-based navigation, fixed chronological day, medicine photos, calendar, and organiser flow should remain.

## Current branch state

Work from branch `codex/how-it-works-onboarding`.

Commit `a67e723` already implements the first improvement:

- A `See how it works` action on the welcome screen.
- A four-step accessible bottom sheet.
- Compact explanatory SVG diagrams.
- Step controls, Back/Next actions, progress dots, Escape/backdrop closing, focus trapping, and focus restoration.
- Responsive bottom-sheet positioning on narrow screens.
- All copy in `js/strings.js`.
- Theme-aware artwork using existing CSS tokens.

Do not rebuild this feature from scratch. Review it against this plan, correct defects if found, and preserve the current interaction and visual direction.

If implementation starts from `main` instead, cherry-pick `a67e723` before beginning.

## Product principles that must remain true

### Calm, not judgmental

- Do not add adherence percentages, streaks, scores, grades, missed-dose warnings, celebrations, or gamification.
- A skipped medicine is a recorded decision. It is amber, never red.
- “Everything marked” means the day has been dealt with. It does not claim every medicine was taken.
- Notifications should remain gentle and must not say the person forgot.

### Predictable

- Today keeps every time-of-day slot visible in chronological order.
- Do not reorder slots around the current time.
- Do not automatically hide expired, earlier, skipped, or incomplete medicines.
- Completed slots may remain collapsed because they can always be expanded again.
- The `Now` marker remains informational and must not change the order or availability of actions.

### Photos are the medicine identity

- Preserve the real pill photo as the strongest medicine identifier.
- Continue using `object-fit: contain` so wide capsules and blister strips are not cropped.
- Preserve the full-screen photo viewer.
- Missing photos remain visible as a job the supporter can complete.
- Do not replace real photos with decorative medicine colours.

### Accessible by construction

- Keep a visible text label beside any unfamiliar icon.
- Keep tap targets at least 44px in simple mode.
- Every state must be distinguishable without colour.
- Preserve keyboard focus trapping and focus restoration for overlays.
- All new user-facing copy belongs in `js/strings.js`.
- All inline artwork used only for explanation must be `aria-hidden`.
- Respect `prefers-reduced-motion`.
- Verify light, dark, and system themes.

## Implementation order

Implement one numbered section at a time. After each section, run the focused acceptance checks before moving on. Do not combine unrelated visual changes into one large rewrite.

---

## 1. Finish and validate “How it works”

Status: implemented in `a67e723`; validate and refine only.

### Intended experience

The welcome screen keeps the two role choices as the primary actions. A smaller `See how it works` control opens a four-step guide:

1. Choose how you use the app.
2. The helper sets up medicines, real photos, amounts, and times.
3. Both people can follow the day; medicines can be marked taken or skipped; reminders help.
4. The organiser guides weekly pill-box filling and checking.

The diagrams are explanatory symbols and flows. They must not resemble screenshots, tappable role cards, or a realistic phone interface. They must contain no people, hands, rooms, or household scenery.

### Files

- `js/views/onboarding.js`
- `js/strings.js`
- `js/ui.js`
- `css/app.css`

### Checks

- The guide opens from `#/welcome` without changing the URL.
- Close, Escape, and backdrop dismissal work.
- Focus moves into the sheet and returns to `See how it works`.
- Back, Next, dots, and `Choose your role` all work.
- The last action closes the guide and leaves the real role buttons visible.
- The sheet fits 320×568, 375×667, 390×844, and a desktop viewport without horizontal scrolling or clipped actions.
- The diagrams remain readable in light and dark mode.
- Opening and closing the guide repeatedly does not leave duplicate overlay layers.
- No network request is needed for the artwork.

---

## 2. Clarify role identity with colour and icons

### Problem

The current supporter role tile reuses the pill symbol and coral attention colouring. The pill already represents the product and the medicine itself. Coral is also used for attention and the `Now` marker. This weakens the role distinction and makes the supporter choice look slightly cautionary.

### Decision

Use separate, stable role identities:

- `I take the medicines`: blue tile with the existing check/today symbol.
- `I help someone with their medicines`: decorative violet tile with the existing people symbol.
- Keep role names and descriptions; the icons reinforce the text and never replace it.

Use violet only as a decorative role/accent colour. Continue reserving:

- Blue for actions, links, and current navigation.
- Teal for taken/completed.
- Amber for skipped.
- Coral for attention and `Now`.
- Red for destructive actions and errors.

### Code changes

In `js/views/onboarding.js`:

- Change the supporter role icon from `icon('pill')` to `icon('people')`.
- Give the supporter role tile a class that maps to violet accent tokens.
- Keep the elder role icon and label unchanged.

In `css/app.css`:

- Replace the supporter role tile’s coral values with `--accent-tint` and `--accent-ink`.
- Check contrast in both token sets.
- Do not recolour the role card border or entire card; colour should identify the icon, not dominate the choice.

### Acceptance checks

- The two role cards remain equal in visual prominence.
- The supporter tile reads as connection/help rather than warning.
- Both icons remain clear in greyscale because the labels are always present.
- Dark mode does not render the violet tile as disabled or muddy.

---

## 3. Make the dose-state interaction understandable

### Problem

The per-medicine circle cycles:

`unmarked → taken → skipped → unmarked`

This is efficient after it is learned, but the second and third states are hidden knowledge. An older user can accidentally reach skipped and may not understand why another tap changed the meaning.

### Decision for this pass

Keep the existing three-state cycle and its optimistic write ordering. Do not move dose writing into the medicine-detail sheet in this pass; that would spread date/slot mutation responsibilities into a view currently used only for information.

Add a compact, visible explanation near the existing Today hint:

- `Tap a medicine to see its photo.`
- `Tap its circle once for taken; tap again to skip.`

The two ideas should be visually grouped without becoming a large instruction card. Use small inline symbols only if they remain readable; text is authoritative.

On the first actual transition to skipped, keep the existing amber state, strike-through, desaturated photo, and Undo toast. The Undo action continues to return the dose to taken because an accidental skip is most likely one tap too many.

### Code changes

In `js/strings.js`:

- Add a concise string for the dose-circle explanation.
- Do not hard-code the copy in the view.

In `js/views/today.js`:

- Render the new explanation beside or directly below the existing photo hint.
- Show it only when the day contains medicines.
- Keep it outside every slot; repeating it per medicine would create noise.
- Give the hint a semantic group or paragraph structure that reads naturally to a screen reader.

In `css/app.css`:

- Keep the combined hint compact.
- Use secondary text with sufficient contrast.
- Do not use amber for the instruction itself; amber must continue to mean an actual skipped state.

### Preserve these dose invariants

- One tap still immediately moves the visual state before the network round trip.
- Writes for one dose remain chained so the last tap wins.
- Supporter writes still require connectivity and roll back visibly on failure.
- Elder writes still use the offline outbox.
- `Done` never overwrites an existing skip.
- `Undo` on a slot still clears taken and skipped rows.
- Read-only days keep static state indicators without tap affordance.

### Acceptance checks

- A new user can discover how to mark taken and skipped without opening documentation.
- The hint does not push the first slot below the fold on a normal phone.
- The instruction remains accurate after rapid taps.
- A failed write restores the previous visual state and shows the existing error feedback.
- Screen-reader labels still describe what the next tap will do.

---

## 4. Show honest offline and pending-sync status to the medicine taker

### Problem

The elder’s device correctly saves dose actions locally and queues them while offline, but the screen does not clearly distinguish:

- saved locally and synced;
- saved locally and waiting for a connection;
- permanently failing or repeatedly retrying.

For medication data, silent uncertainty damages trust even when the local interaction succeeds.

### Desired behavior

Add a quiet status line on the elder’s Today screen only when action is needed or syncing is pending:

- Online with empty outbox: show nothing.
- Offline or outbox contains writes: `Saved on this phone. Waiting to sync.`
- Sync completes and the outbox becomes empty: briefly show `Up to date`, then remove it.
- A server rejection that cannot succeed should eventually be distinguishable from a connection failure. If that cannot be implemented safely in this pass, document it and retain the pending wording; do not falsely claim success.

This status is separate from the supporter freshness line. A supporter polls and reports when data was last fetched. The elder writes locally and needs to know whether those writes reached the server.

### Suggested implementation

In `js/store.js`:

- Reuse `getOutbox()`; do not allow views to import `db.js`.
- If useful, add a small read helper such as `hasPendingOutbox()`.

In `js/sync.js`:

- Add a narrowly scoped status subscription or callback that reports outbox state changes.
- Notify after enqueue, after successful deletion from the outbox, and after a flush finishes.
- Avoid triggering a full router refresh for every outbox change. Update only the status node or dispatch a small application event.
- Preserve the existing flush re-entrancy guard and local-echo suppression.

In `js/views/today.js`:

- Create the elder sync-status node only in simple mode.
- Update the node in place.
- Return cleanup for any event listener.
- Use `aria-live="polite"` so status changes are announced without interrupting.

In `js/strings.js`:

- Add the pending and up-to-date wording.

In `css/app.css`:

- Use neutral or blue informational styling.
- Do not use red for ordinary offline state.
- Keep the line compact and avoid a persistent banner when everything is healthy.

### Acceptance checks

- Marking a dose while offline shows the local-save/pending message.
- Reloading while still offline preserves the pending indication because the outbox persists.
- Reconnecting flushes the outbox and updates the status without rebuilding Today or moving scroll.
- Multiple rapid dose actions do not cause flicker or duplicate listeners.
- The supporter never sees the elder outbox status.
- The status never says synced merely because the UI was updated optimistically.

---

## 5. Add a test-notification action

### Problem

Notification permission, browser subscription, server subscription, VAPID configuration, and push delivery can fail at different points. A simple on/off label does not prove a notification can actually reach the device.

### Desired behavior

After reminders are confirmed as enabled, show a secondary action:

`Send a test notification`

The action should send a neutral test push to the current device. It should clearly report:

- delivered/request accepted;
- browser or server subscription missing;
- notifications unsupported;
- permission denied;
- server configuration or delivery failure.

Do not use the supporter’s nudge for this. A nudge has a different audience, cooldown, wording, and purpose.

### Backend approach

Prefer a dedicated Edge Function or narrowly scoped RPC/function pair that targets the current subscription endpoint.

For the elder:

- Authenticate the request with the signed-in Supabase session.
- Resolve the household and current user server-side.
- Send only to the submitted endpoint if it belongs to that user and is active.
- Never trust a client-supplied household ID.

For the supporter:

- This can be deferred if it materially expands the endpoint. If implemented, gate it by the share code and target only the current endpoint.
- Do not accidentally send the test to every supporter or to the elder.

Keep test wording in `supabase/functions/_shared/messages.ts` with the other push copy. It must not name a medicine.

### Frontend files

Likely affected:

- `js/views/settings.js`
- `js/push.js`
- `js/supporter-push.js` if supporter testing is included
- `js/strings.js`
- `supabase/functions/_shared/messages.ts`
- A new or extended Edge Function
- Setup and notification documentation

### Interaction requirements

- The button is disabled and busy while sending.
- One tap creates at most one request.
- Success is reported only when the server reports a successful push send.
- A missing server subscription is not reported as delivered.
- Keep the action secondary to the reminder on/off control.

### Acceptance checks

- Test succeeds on a supported installed PWA with reminders enabled.
- Test gives an accurate message when the browser subscription exists but the server row is absent.
- Test does not affect reminder schedules, cooldowns, notification deduplication, or dose logs.
- Test cannot send to another household by altering client arguments.

---

## 6. Explain the calendar rings in place

### Problem

The calendar communicates several states through ring fill and colour:

- no ring when nothing was due;
- hollow/partial/full progress;
- teal when marked without skips;
- amber when any medicine was skipped;
- violet outline for today.

The encoding is thoughtful but not immediately obvious to a first-time user.

### Decision

Add a compact expandable legend close to the calendar heading. Default it to a single control such as `What do the rings mean?` so it does not permanently take vertical space.

Expanded content should show small rendered examples using the same ring component or shared CSS:

- Full teal: everything marked.
- Partial teal: some marked.
- Amber: includes a skipped medicine.
- No ring: nothing due.
- Violet outline: today.

Do not describe amber as missed or failed.

### Code changes

In `js/views/calendar.js`:

- Reuse the same ring builder used by calendar days; do not create visually separate hard-coded ring styles that can drift.
- Keep expansion local to the view and update it in place.
- Use a native `button` with `aria-expanded` and `aria-controls`.
- Preserve the current month and scroll when toggling.

In `js/strings.js`:

- Add the legend control and label strings.

In `css/app.css`:

- Keep the legend compact and readable.
- Ensure ring examples have adjacent text; colour alone is insufficient.

### Acceptance checks

- Legend states match the actual calendar rendering.
- Opening the legend does not reload calendar data.
- The current month does not reset.
- All meanings remain understandable in greyscale and dark mode.

---

## 7. Improve empty-day wording

### Problem

`No medicines yet` can mean either:

1. No routine has been configured.
2. A routine exists, but nothing is due today.

Those states require different reassurance and next steps.

### Decision

Use separate messages:

- No active medicines in the household:
  - Elder cold start keeps the share-code setup guidance.
  - Supporter sees the existing add-medicine action.
- Active medicines exist, but no groups are due on this date:
  - `No medicines today`
  - Optional secondary line: `Nothing is scheduled for this day.`

Do not show an Add Medicine button to the elder.

### Code changes

Review the boundary between `js/views/today.js` and `js/views/day.js`:

- `todayView` already knows whether active medicines exist.
- `renderDay` knows whether the computed day has groups.
- Pass or select the correct empty-state copy without conflating the two cases.
- Calendar day sheets should use date-neutral wording such as `No medicines were due on this day.`

Add distinct strings in `js/strings.js`.

### Acceptance checks

- Fresh elder household still shows the share code and setup instruction.
- Supporter with no medicines still gets a clear Add Medicine action.
- A weekly or every-N-days routine correctly says `No medicines today` on an off day.
- Calendar retains past/future wording appropriate to the selected date.

---

## 8. Add calm end-of-day reassurance

### Problem

When every expected medicine has been marked, the UI shows completed slots and the progress rail, but there is no single plain-language confirmation for the whole day.

### Desired behavior

When all expected medicines are resolved, show:

`Everything for today is marked.`

If every medicine is taken, the same sentence is sufficient. If some are skipped, do not say `All taken` at the day level.

### Implementation

In `js/views/today.js`:

- Derive the state from the same expected groups and dose rows already used by `progressRail`.
- Avoid an additional IndexedDB read solely for this message; extend the existing result or compute the summary in the same read.
- Update the message in place when a dose changes, just as the progress rail is replaced.
- Remove it immediately if Undo or clearing a dose makes the day unresolved.
- Do not show it when no medicine is due.

In `js/strings.js`:

- Add the reassurance string.

In `css/app.css`:

- Use a compact teal-tinted notice with a check shape and text.
- Keep it visually quieter than a slot card and primary action.
- Avoid confetti, animation loops, exclamation marks, badges, or celebratory language.

### Acceptance checks

- Resolving the final unmarked medicine reveals the message without a full-page refresh.
- A day containing skipped medicines can still be fully resolved and show the message.
- Undo removes the message immediately.
- Midnight rollover computes the new day and removes yesterday’s confirmation.
- No historical score or streak is stored.

---

## 9. Reduce the visual weight of the supporter’s nudge

### Problem

On the supporter’s Today screen, the full-width `Send a reminder` button appears before the medicine slots. It is useful, but it competes with the supporter’s primary task: checking today’s status.

### Decision

Keep the nudge visible, but give it less visual weight.
Use a compact secondary row near the freshness status:

- Bell icon.
- `Send a reminder` label.
- Short supporting text remains available.
- It must not look like the page’s primary action.

Do not hide the action in an overflow menu; supporters may need it quickly.

### Code changes

In `js/views/today.js`:

- Change `nudgeButton()` from a full-width primary-looking block to a compact secondary control.
- Preserve its disabled state, server cooldown handling, no-subscription response, delivery-failure response, and success toast.

In `css/app.css`:

- Add a compact nudge row style.
- Retain a 44px minimum target.
- Use the new bell icon described in the icon section below.

### Acceptance checks

- Today’s medicine state appears visually before or at equal priority to the nudge.
- The action remains easy to locate.
- Repeat taps remain blocked during and after a send.
- The UI still distinguishes sent, cooldown, no subscription, and delivery failure.

---

## 10. Complete the icon vocabulary

### Required icons

Add masked inline SVG tokens consistent with the current solid icon system:

- `bell` for reminders and supporter nudge.
- `camera` or `photo` for photo capture/add-photo actions, if the current text-only control benefits from it.
- Continue using the existing `box` icon for pill-box/organiser entry points.
- Continue using `people` for the supporter role.
- Continue using `today/check` for the medicine-taker role.

### Rules

- Use icons to improve recognition, not to replace labels.
- Keep stroke/fill weight visually consistent with `pill`, `calendar`, and `settings`.
- Add new masks to the icon token block and corresponding `.icon[data-icon]` selectors in `css/app.css`.
- Do not add an icon font, remote asset, emoji, or network request.
- Test every icon at its actual rendered size, not only enlarged in developer tools.
- Do not use the same symbol for unrelated concepts.

### Emoji policy

- Do not introduce emojis into app controls, navigation, headings, status indicators, or diagrams.
- Emoji rendering differs across platforms and can become visually ambiguous at small sizes.
- Existing gentle emojis in push-notification copy may remain because they support tone and are not interactive controls.
- Do not use emoji as the only carrier of notification meaning.

---

## 11. Colour-system review

### Keep

Retain the current warm paper canvas, white/raised surfaces, soft warm shadows, and semantic colour assignments. They suit the app’s calm household setting and help white cards remain visible.

Retain the time-of-day bands. Real medicine photos are often white, grey, or brown; the bands supply stable visual structure without inventing pill colours.

### Refine

- Apply violet to supporter identity.
- Audit secondary and tertiary text on the warm canvas and tinted surfaces at actual component sizes.
- Check dark-mode borders because shadows provide little separation there.
- Check that positive teal remains saturated enough in dark mode to avoid looking disabled.
- Ensure the `Now` coral and skipped amber remain distinguishable.
- Ensure all selected/navigation states retain a shape change, not only a colour change.

### Avoid

- Do not replace the palette with clinical white and bright blue.
- Do not add gradients to primary controls.
- Do not colour every card.
- Do not use red for skipped, offline, stale, or incomplete states.
- Do not derive the fallback medicine colour from a guessed medicine or pill colour.
- Do not change brand blue casually because it is also used by installed icons and metadata.

---

## 12. Explicitly rejected changes

Do not implement these during this plan:

- A complete navigation overhaul.
- A dashboard with statistics.
- Adherence percentages or weekly/monthly summaries.
- Streaks, trophies, celebrations, or shame-oriented language.
- Automatic reordering based on the current time.
- Hiding earlier incomplete medicines.
- A permanently visible organiser navigation tab.
- Icon-only navigation or actions without text.
- Emoji-based controls.
- Multiple visual themes beyond system/light/dark.
- Automatic clinical advice, dose validation, or interaction warnings.
- New supporter accounts or household architecture; those are separate product projects.
- A medicine-detail redesign that moves dose writes into the sheet during this pass.

---

## Cross-cutting engineering requirements

### Rendering

- Every async view must check `isCurrent()` after each await and before touching the DOM.
- Preserve router render generations.
- Prefer replacing the affected node over calling `router.refresh()`.
- Views that create object URLs or listeners must return cleanup functions.
- Read the node being replaced before constructing/registering its replacement.

### Data and sync

- Views access IndexedDB through `store.js` only.
- Dose writes go through `doses.js`.
- Supporter writes never enter the elder outbox.
- Elder dose taps remain available offline.
- Realtime echoes must continue updating the cache without redrawing the state the local screen already applied.
- Existing dose history remains append-only except explicit user Undo.

### Copy

- Put every app-visible string in `js/strings.js`.
- Use `marked` where the state may include taken or skipped.
- Avoid `missed`, `failed`, `forgot`, and `adherence` in user-facing routine copy.
- Keep sentences short enough to scan on a phone.
- Do not put readable text inside explanatory SVG artwork.

### CSS

- Use existing custom properties before adding new colour values.
- Use `rem`/`em` for text.
- Keep `min-width: 0` on controls inside narrow grids/flex layouts.
- Avoid percentage-height chains without a definite parent.
- Preserve the exact bottom-navigation height contract.
- Verify at 320px width as well as modern phone widths.

---

## Suggested commit structure

Use focused commits so each behavior can be reviewed or reverted independently:

1. `fix: clarify onboarding role identity`
2. `feat: explain dose states on Today`
3. `feat: show pending dose sync status`
4. `feat: add test notification action`
5. `feat: add calendar ring legend`
6. `fix: distinguish empty routine from empty day`
7. `feat: confirm when today's medicines are resolved`
8. `refactor: refine supporter nudge and icons`
9. `docs: document UI behavior changes`

Do not mix database migrations, notification delivery, and unrelated cosmetic changes in one commit.

## Verification matrix

Test both roles where applicable.

### Welcome and guide

- Fresh browser with no role.
- Light and dark mode.
- Keyboard-only navigation.
- Escape and backdrop dismissal.
- 320px, 375px, 390px, tablet, and desktop widths.

### Elder Today

- No medicines configured.
- Active routine with nothing due today.
- One slot/one medicine.
- Several slots and six medicines in one slot.
- Taken, skipped, Undo, and Done with an existing skip.
- Fully resolved day with and without skips.
- Offline dose marking, reload while offline, then reconnect.
- Midnight rollover while the app remains open.

### Supporter Today

- Freshly paired cache.
- Current and stale polling status.
- Household in another timezone/date.
- First mark-on-behalf confirmation.
- Failed supporter dose write.
- Nudge success, cooldown, no elder subscription, and delivery failure.

### Calendar

- No-dose day, partial day, all-taken day, day containing skips.
- Today, future day, editable recent past, frozen past.
- Legend toggling without month reset or refetch.
- Sheet stacking with medicine detail and Escape closing only the top layer.

### Settings and push

- Unsupported notification device.
- Permission denied.
- Browser subscription without server row.
- Successful subscribe, test notification, and unsubscribe.
- Elder and supporter subscriptions remain separated.

### Accessibility

- Logical focus order.
- Focus returns to the opening control after every overlay.
- Every interactive control has an accessible name.
- State is understandable in greyscale.
- Reduced motion disables nonessential transitions.
- Phone text-size scaling does not clip buttons or artwork.

## Definition of done

The plan is complete when:

- The welcome guide remains stable and visually explanatory.
- Role icons and colours clearly distinguish self-use from helping.
- A first-time user can discover taken and skipped behavior on Today.
- The elder receives honest feedback when dose writes are waiting to sync.
- Enabled reminders can be tested without affecting real reminder schedules.
- Calendar ring meanings are available in place.
- Empty routine and empty day states use different, accurate messages.
- A fully resolved day gives calm reassurance without scoring the person.
- The supporter nudge remains discoverable but no longer dominates Today.
- New icons follow the existing local SVG-mask system.
- All targeted phone sizes, both themes, both roles, offline behavior, and keyboard interaction pass the verification matrix.
- Documentation is updated to describe the resulting behavior rather than the abandoned alternatives.
