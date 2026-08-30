/* The Today screen. For most users this is the entire app.
 *
 * Shows the whole day, always. Slots are dimmed by time of day but never
 * hidden: hiding a slot whose time has passed turns a late dose into an
 * unrecoverable state, and the person needs to see the full day to feel sure
 * about what is left.
 */

import * as store from '../store.js';
import { S } from '../strings.js';
import { el, clear, emptyState } from '../ui.js';
import { todayStr, formatLong } from '../date.js';
import { renderDay } from './day.js';

export async function todayView({ app }) {
  const date = todayStr();
  const settings = await store.getSettings();
  let cleanup = () => {};

  async function draw() {
    cleanup();
    clear(app);

    app.appendChild(el('div.day-head', [
      el('h1.page-title', { text: S.navToday }),
      el('span.day-date', { text: formatLong(date, S.monthNames, S.weekdayNames) }),
    ]));
    app.appendChild(el('p.page-sub', { text: S.tapForPhoto }));

    // No onChange: renderDay swaps the tapped slot in place, so the screen
    // must not redraw itself underneath the person.
    const { node, cleanup: release } = await renderDay({ date, editable: true });
    cleanup = release;

    // An empty day is either a fresh install or a day nothing is due: the
    // first needs pointing at the fix, so check whether anything exists yet.
    const medicines = await store.getActiveMedicines();
    if (!medicines.length) {
      app.appendChild(emptyState(
        S.todayNothing,
        settings.role === 'simple' ? S.todayNothingSimple : S.todayNothingSupporter,
      ));
      if (settings.role === 'supporter') {
        app.appendChild(el('a.btn.btn-primary.btn-block', { href: '#/medicine', text: S.addMedicine }));
      }
      return;
    }

    app.appendChild(node);
  }

  await draw();
  return () => cleanup();
}
