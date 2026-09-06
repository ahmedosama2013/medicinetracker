/* The Today screen. For most users this is the entire app.
 *
 * Shows the whole day, always. Slots are dimmed by time of day but never
 * hidden: hiding a slot whose time has passed turns a late dose into an
 * unrecoverable state, and the person needs to see the full day to feel sure
 * about what is left.
 */

import * as store from '../store.js';
import * as schedule from '../schedule.js';
import * as supporterSync from '../supporter-sync.js';
import { S } from '../strings.js';
import * as supporter from '../supporter.js';
import { el, clear, emptyState, toast } from '../ui.js';
import { todayStr, formatLong } from '../date.js';
import { refresh } from '../router.js';
import { renderDay } from './day.js';

/**
 * One segment per slot, filled when that slot is fully marked.
 *
 * This is the app's only progress indicator and it is deliberately bounded to
 * today: it resets at midnight, is never stored, and has no historical
 * counterpart. The rule it must not break is that nothing anywhere aggregates
 * adherence over time -- see docs/ui.md. Knowing "two of four done" while
 * standing in your kitchen is orientation; knowing "68% this month" is a
 * report card, and this app never issues one.
 */
async function progressRail(date) {
  const [groups, log] = await Promise.all([
    schedule.expectedFor(date),
    store.getDoseLogForDate(date),
  ]);
  if (groups.length < 2) return null;      // one slot: a rail says nothing

  // A segment fills when the slot is *resolved*, not when it is all-taken: a
  // deliberately skipped medicine is dealt with, and leaving the segment
  // hollow would nag about a decision the person already made.
  const marked = new Set(log.map(r => `${r.slotId}|${r.medicineId}`));
  const states = groups.map(g => g.medicines.every(m => marked.has(`${g.slotId}|${m.medicineId}`)));
  const done = states.filter(Boolean).length;

  return el('div', [
    el('div.rail', states.map(on => el(`span.rail-seg${on ? '.is-on' : ''}`))),
    el('p.rail-count', { text: S.doneOfSlots(done, states.length) }),
  ]);
}

/* How stale the supporter's copy is. They poll rather than receive Realtime
 * (see js/supporter-sync.js), so a screen that looked live would quietly turn
 * into a lie the moment the connection dropped -- and "they haven't marked
 * anything" is exactly the wrong thing to be wrong about. */
function freshnessLine() {
  const at = supporterSync.lastSync();
  if (!at) return el('p.freshness.freshness-stale', { text: S.updatedNever });
  const mins = Math.floor((Date.now() - at) / 60000);
  return el('p.freshness', { text: mins < 1 ? S.updatedJustNow : S.updatedAgo(mins) });
}

/* One button in place of a phone call, which is the actual current behaviour
 * when a supporter wants to know whether the medicines were taken.
 *
 * Disabled while in flight and after a send: the rate limit is enforced on the
 * server (a client-side one is a suggestion), but a button that stays tappable
 * invites the tapping the server is there to absorb. */
function nudgeButton(settings) {
  const button = el('button.btn.btn-block.nudge', {
    type: 'button',
    text: S.nudge,
    onclick: async () => {
      button.disabled = true;
      try {
        const result = await supporter.nudge(settings.supporterCode);
        if (result?.retryInMinutes) {
          toast(S.nudgeWait(result.retryInMinutes));
        } else if (result?.reason === 'no-subscriptions') {
          toast(S.nudgeNoSubscription);
        } else if (!result?.sent) {
          /* The function distinguishes "delivered to nobody" from "delivered",
           * and this fell through to the success toast. Nothing burned the
           * cooldown either, so trying again is worth offering. */
          toast(S.nudgeFailed);
          button.disabled = false;
        } else {
          toast(S.nudgeSent);
        }
      } catch {
        toast(S.errGeneric);
        button.disabled = false;
        return;
      }
      /* Left disabled after any outcome: nothing about tapping it again in the
       * next few seconds can help, and the server's limit should be a
       * backstop rather than something a person meets by accident. */
    },
  });

  return el('div.nudge-wrap', [button, el('p.nudge-hint', { text: S.nudgeHint })]);
}

/* The way in to organiser mode: a card, not a tab.
 *
 * Filling the box is an occasional job -- weekly at most -- and a fifth thing
 * in the nav would ask everyone to look past it every day. It only appears
 * once the household has said which times of day go in a box, so an elder who
 * does not use one never sees it at all.
 */
async function organiserCard() {
  const [boxSlots, session] = await Promise.all([
    store.getBoxSlots(), store.getOrganiser(),
  ]);
  if (!boxSlots.length) return null;

  const total = session?.plan?.steps?.length || 0;
  const remaining = total - (session?.done?.length || 0);
  const midSitting = session && total > 0 && remaining > 0 && remaining < total;

  return el('a.card.og-card', { href: '#/organiser' }, [
    el('span.og-card-main', [
      el('span.og-card-title', { text: S.organiserOpen }),
      el('span.og-card-body', {
        text: midSitting ? S.organiserResume(remaining) : S.organiserCardBody,
      }),
    ]),
    el('span.role-chevron', { 'aria-hidden': 'true', text: '\u203a' }),
  ]);
}

export async function todayView({ app, isCurrent = () => true }) {
  const date = todayStr();
  const settings = await store.getSettings();
  if (!isCurrent()) return;
  let cleanup = () => {};

  /* Everything is fetched BEFORE the screen is cleared, and the whole screen
   * goes up in one go.
   *
   * The old order -- clear, then await, then append -- is what let two
   * overlapping renders leave two copies of the day on screen: both cleared
   * before either appended. `isCurrent` is the guard against that; building
   * detached first is the belt, and it also means the person never sees a bare
   * heading with the day missing underneath it. */
  async function draw() {
    const medicines = await store.getActiveMedicines();
    if (!isCurrent()) return;

    const head = el('div.day-head', [
      el('h1.page-title', { text: S.navToday }),
      el('span.day-date', { text: formatLong(date, S.monthNames, S.weekdayNames) }),
    ]);

    if (!medicines.length) {
      cleanup();
      cleanup = () => {};
      clear(app);
      app.appendChild(head);

      /* The elder's cold start. Setup ends at sign-in, and until a supporter
       * has added something there is nothing this screen can show -- so it
       * used to say "No medicines yet" and stop, which is a dead end at the
       * exact moment the person is most likely to wonder whether the app is
       * broken. Their code IS the next step, so it goes here, big enough to
       * read out over a phone call. */
      if (settings.role === 'simple' && settings.shareCode) {
        app.appendChild(el('div.coldstart', [
          el('p.empty-title', { text: S.coldStartTitle }),
          el('p.coldstart-body', { text: S.coldStartBody }),
          el('p.coldstart-label', { text: S.coldStartCodeLabel }),
          el('p.coldstart-code', { text: settings.shareCode }),
          el('p.coldstart-foot', { text: S.coldStartWaiting }),
        ]));
        return;
      }

      app.appendChild(emptyState(
        S.todayNothing,
        settings.role === 'simple' ? S.todayNothingSimple : S.todayNothingSupporter,
      ));
      if (settings.role === 'supporter') {
        app.appendChild(el('a.btn.btn-primary.btn-block', { href: '#/medicine', text: S.addMedicine }));
      }
      return;
    }

    let rail;

    // In parallel: both read the same stores, and the rail used to wait behind
    // the day for no reason.
    const [railNode, organiser, rendered] = await Promise.all([
      progressRail(date),
      organiserCard(),
      // onChange swaps the rail and nothing else. renderDay already replaced
      // the tapped slot in place, and redrawing the day here would re-read the
      // database, reload every photo and jump the scroll position under the
      // person's thumb.
      renderDay({
        date,
        editable: true,
        // This day's nodes are gone -- something re-rendered underneath a
        // write. Rebuild from the store rather than leaving the tap looking
        // ignored.
        onStale: () => refresh(),
        onChange: async () => {
          const next = await progressRail(date);
          if (rail && next) {
            rail.replaceWith(next);
            rail = next;
          }
        },
      }),
    ]);

    if (!isCurrent()) {
      // Superseded while we were reading. Its photos are already loaded and
      // nothing else will ever release them.
      rendered.cleanup();
      return;
    }

    rail = railNode;

    cleanup();
    clear(app);
    app.appendChild(head);
    if (rail) app.appendChild(rail);
    app.appendChild(el('p.page-sub', { text: S.tapForPhoto }));

    if (settings.role === 'supporter') {
      app.appendChild(freshnessLine());
      app.appendChild(nudgeButton(settings));
    }

    cleanup = rendered.cleanup;
    app.appendChild(rendered.node);
    // Below the day, not above it. Today's job is what to take today; filling
    // next week's box is the thing you go looking for, not the thing you are
    // interrupted by.
    if (organiser) app.appendChild(organiser);
  }

  await draw();
  return () => cleanup();
}
