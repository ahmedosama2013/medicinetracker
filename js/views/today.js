/* The Today screen. For most users this is the entire app.
 *
 * Shows the whole day, always. Slots are dimmed by time of day but never
 * hidden: hiding a slot whose time has passed turns a late dose into an
 * unrecoverable state, and the person needs to see the full day to feel sure
 * about what is left.
 */

import * as store from '../store.js';
import * as schedule from '../schedule.js';
import { S } from '../strings.js';
import { el, clear, emptyState } from '../ui.js';
import { todayStr, formatLong } from '../date.js';
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

export async function todayView({ app }) {
  const date = todayStr();
  const settings = await store.getSettings();
  let cleanup = () => {};

  async function draw() {
    cleanup();
    clear(app);

    // Checked before anything else, so the "tap a medicine" hint below never
    // has a moment where it is showing next to an empty-state message with
    // nothing to tap yet.
    const medicines = await store.getActiveMedicines();

    app.appendChild(el('div.day-head', [
      el('h1.page-title', { text: S.navToday }),
      el('span.day-date', { text: formatLong(date, S.monthNames, S.weekdayNames) }),
    ]));

    if (!medicines.length) {
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

    let rail = await progressRail(date);
    if (rail) app.appendChild(rail);

    app.appendChild(el('p.page-sub', { text: S.tapForPhoto }));

    // onChange swaps the rail and nothing else. renderDay already replaced the
    // tapped slot in place, and redrawing the day here would re-read the
    // database, reload every photo and jump the scroll position under the
    // person's thumb.
    const { node, cleanup: release } = await renderDay({
      date,
      editable: true,
      onChange: async () => {
        const next = await progressRail(date);
        if (rail && next) {
          rail.replaceWith(next);
          rail = next;
        }
      },
    });
    cleanup = release;
    app.appendChild(node);
  }

  await draw();
  return () => cleanup();
}
