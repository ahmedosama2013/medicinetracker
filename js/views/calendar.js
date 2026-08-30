/* Month calendar.
 *
 * A ring per day: full when everything expected was logged, a partial arc for
 * some of it, nothing at all for a day with nothing due. No percentages, no
 * streaks, no scores - this is a memory aid, and it must never read as
 * medical judgement.
 *
 * Editable days are those after the last import and not in the future. A day
 * on or before `lockedThrough` was frozen by an import (see js/backup.js) and
 * is kept as a record.
 */

import * as store from '../store.js';
import * as scheduleLib from '../schedule.js';
import { S } from '../strings.js';
import { el, clear, openSheet, alertDialog } from '../ui.js';
import { todayStr, monthGrid, parse, formatLong, isAfter } from '../date.js';
import { renderDay } from './day.js';

/** Green ring, drawn with a conic gradient so it needs no SVG. */
function ring(taken, expected) {
  if (!expected) return null;
  const share = Math.max(0, Math.min(1, taken / expected));
  if (share === 0) {
    return el('span.cal-ring', {
      style: 'border: 3px solid var(--line-strong); background: transparent;',
    });
  }
  if (share >= 1) {
    return el('span.cal-ring', { style: 'background: var(--ok); opacity: .22;' });
  }
  const deg = Math.round(share * 360);
  return el('span.cal-ring', {
    style: `background: conic-gradient(var(--ok) 0deg ${deg}deg, var(--surface-2) ${deg}deg 360deg); opacity: .55;`,
  });
}

export async function calendarView({ app }) {
  const today = todayStr();
  const settings = await store.getSettings();
  const locked = settings.lockedThrough;

  let cursor = parse(today);          // { y, m } of the visible month
  let sheetCleanup = null;

  function dayState(date) {
    if (isAfter(date, today)) return 'future';
    if (locked && !isAfter(date, locked)) return 'locked';
    return 'open';
  }

  async function openDay(date) {
    const state = dayState(date);

    if (state === 'future') {
      await alertDialog({ title: S.notYet, body: S.notYetBody });
      return;
    }

    let rendered;
    const sheet = openSheet({
      title: formatLong(date, S.monthNames, S.weekdayNames),
      content: el('p', { text: S.loading }),
      onClose: () => { rendered?.cleanup(); sheetCleanup = null; draw(); },
    });

    rendered = await renderDay({
      date,
      editable: state === 'open',
      lockReason: state === 'locked' ? S.lockedBody : null,
    });
    sheet.setContent(rendered.node);
    sheetCleanup = () => rendered?.cleanup();
    // The month's rings are refreshed by draw() when the sheet closes, so
    // marking a dose does not rebuild the sheet under the person's thumb.
  }

  async function draw() {
    clear(app);

    const cells = monthGrid(cursor.y, cursor.m);
    const completion = await scheduleLib.completionForDates(cells.map(c => c.date));

    app.appendChild(el('div.cal-head', [
      el('button.cal-nav', {
        type: 'button', 'aria-label': 'Previous month',
        onclick: () => { step(-1); },
      }, '‹'),
      el('button.cal-title', {
        type: 'button',
        text: `${S.monthNames[cursor.m - 1]} ${cursor.y}`,
        onclick: pickMonth,
      }),
      el('button.cal-nav', {
        type: 'button', 'aria-label': 'Next month',
        onclick: () => { step(1); },
      }, '›'),
    ]));

    app.appendChild(el('div.cal-weekdays', S.weekdayShort.map((d, i) =>
      el('span', { text: d, 'aria-label': S.weekdayNames[i] }))));

    const grid = el('div.cal-grid');
    for (const cell of cells) {
      const { expected, taken } = completion.get(cell.date) || { expected: 0, taken: 0 };
      const state = dayState(cell.date);
      const classes = ['cal-day'];
      if (!cell.inMonth) classes.push('cal-day-out');
      if (cell.date === today) classes.push('cal-day-today');
      if (state === 'future') classes.push('cal-day-future');
      if (state === 'locked') classes.push('cal-locked');

      const label = expected
        ? `${formatLong(cell.date, S.monthNames, S.weekdayNames)}, ${S.ofDoses(taken, expected)}`
        : formatLong(cell.date, S.monthNames, S.weekdayNames);

      grid.appendChild(el(`button.${classes.join('.')}`, {
        type: 'button',
        'aria-label': label,
        onclick: () => openDay(cell.date),
      }, [
        ring(taken, expected),
        el('span.cal-day-num', { text: String(parse(cell.date).d) }),
      ]));
    }
    app.appendChild(grid);

    app.appendChild(el('div.cal-legend', [
      el('span.cal-legend-item', [
        el('span.cal-swatch', { style: 'background: var(--ok); opacity: .22;' }),
        S.allTaken,
      ]),
      el('span.cal-legend-item', [
        el('span.cal-swatch', { style: 'border: 3px solid var(--line-strong);' }),
        'Nothing marked',
      ]),
    ]));
  }

  function step(months) {
    let m = cursor.m + months;
    let y = cursor.y;
    while (m < 1) { m += 12; y -= 1; }
    while (m > 12) { m -= 12; y += 1; }
    cursor = { y, m };
    draw();
  }

  /* Month and year in one small panel, so going back a year is two taps
   * rather than twelve presses of the chevron. */
  function pickMonth() {
    let year = cursor.y;
    const sheet = openSheet({ title: S.monthPickerTitle, content: null });

    const paint = () => {
      sheet.setContent([
        el('div.year-row', [
          el('button.cal-nav', {
            type: 'button', 'aria-label': 'Previous year',
            onclick: () => { year -= 1; paint(); },
          }, '‹'),
          el('span.year-label', { text: String(year) }),
          el('button.cal-nav', {
            type: 'button', 'aria-label': 'Next year',
            onclick: () => { year += 1; paint(); },
          }, '›'),
        ]),
        el('div.month-picker', S.monthNames.map((name, i) => el('button.btn', {
          type: 'button',
          class: year === cursor.y && i + 1 === cursor.m ? 'btn-primary' : '',
          text: name.slice(0, 3),
          onclick: () => {
            cursor = { y: year, m: i + 1 };
            sheet.close();
            draw();
          },
        }))),
      ]);
    };
    paint();
  }

  await draw();
  return () => { sheetCleanup?.(); };
}
