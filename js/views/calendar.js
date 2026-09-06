/* Month calendar.
 *
 * A ring per day: full when everything expected was dealt with, a partial arc
 * for some of it, nothing at all for a day with nothing due. Amber instead of
 * green once anything that day was skipped. No percentages, no streaks, no
 * scores - this is a memory aid, and it must never read as medical judgement.
 *
 * Editable days are those after the household's lock line and not in the
 * future. A nightly server-side job (see supabase/migrations/0001_init.sql,
 * app.run_daily_freeze) advances `lockedThrough`, synced onto this device by
 * js/sync.js; a day on or before it is kept as a record.
 */

import * as store from '../store.js';
import * as scheduleLib from '../schedule.js';
import { S } from '../strings.js';
import { el, clear, openSheet, alertDialog } from '../ui.js';
import { todayStr, monthGrid, parse, formatLong, isAfter } from '../date.js';
import { renderDay } from './day.js';

/* Green ring, drawn with a conic gradient so it needs no SVG.
 *
 * Uses --taken-line rather than --taken at reduced opacity: an opacity hack
 * only works against a known background, and there are now two of them. Both
 * modes define --taken-line as a fill the day number stays legible on. */
function ring({ taken = 0, skipped = 0, expected = 0 }) {
  if (!expected) return null;

  /* The arc answers "was this day dealt with?", so a skipped dose fills it
   * exactly as a taken one does -- deciding not to take something is engaging
   * with the day, and a shorter arc would read as a mark against the person.
   * What changes is the colour: amber once anything in the day was skipped, so
   * a fully-skipped day is still distinguishable from a fully-taken one
   * without any of it being scored. */
  const handled = Math.min(taken + skipped, expected);
  const share = Math.max(0, Math.min(1, handled / expected));
  const fill = skipped > 0 ? 'var(--skip-line)' : 'var(--taken-line)';

  if (share === 0) {
    return el('span.cal-ring', {
      style: 'border: 3px solid var(--line-strong); background: transparent;',
    });
  }
  if (share >= 1) {
    return el('span.cal-ring', { style: `background: ${fill};` });
  }
  const deg = Math.round(share * 360);
  return el('span.cal-ring', {
    style: `background: conic-gradient(${fill} 0deg ${deg}deg, var(--sunken) ${deg}deg 360deg);`,
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
      const { expected, taken, skipped } = completion.get(cell.date)
        || { expected: 0, taken: 0, skipped: 0 };
      const state = dayState(cell.date);
      const classes = ['cal-day'];
      if (!cell.inMonth) classes.push('cal-day-out');
      if (cell.date === today) classes.push('cal-day-today');
      if (state === 'future') classes.push('cal-day-future');
      if (state === 'locked') classes.push('cal-locked');

      const label = expected
        ? `${formatLong(cell.date, S.monthNames, S.weekdayNames)}, ${S.ofDoses(taken, expected)}${skipped ? `, ${S.ofSkipped(skipped)}` : ''}`
        : formatLong(cell.date, S.monthNames, S.weekdayNames);

      grid.appendChild(el(`button.${classes.join('.')}`, {
        type: 'button',
        'aria-label': label,
        onclick: () => openDay(cell.date),
      }, [
        ring({ taken, skipped, expected }),
        el('span.cal-day-num', { text: String(parse(cell.date).d) }),
      ]));
    }
    app.appendChild(grid);

    app.appendChild(el('div.cal-legend', [
      el('span.cal-legend-item', [
        el('span.cal-swatch', { style: 'background: var(--taken-line);' }),
        S.allTaken,
      ]),
      el('span.cal-legend-item', [
        el('span.cal-swatch', { style: 'background: var(--skip-line);' }),
        S.someSkipped,
      ]),
      el('span.cal-legend-item', [
        el('span.cal-swatch', { style: 'border: 3px solid var(--line-strong);' }),
        S.nothingMarked,
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
