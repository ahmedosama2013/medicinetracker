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
import * as supporterSync from '../supporter-sync.js';
import { S } from '../strings.js';
import { el, clear, openSheet, alertDialog, loadingState, emptyState } from '../ui.js';
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
      style: 'border: 2px solid var(--line); background: transparent;',
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

export async function calendarView({ app, isCurrent = () => true }) {
  const settings = await store.getSettings();

  /* Both are re-read on every draw, not captured once. A calendar left open
   * overnight would otherwise keep treating yesterday as today -- and go on
   * offering to edit it -- and would miss the nightly freeze advancing the
   * lock line underneath it. */
  let today = todayStr();
  let locked = settings.lockedThrough;

  let cursor = parse(today);          // { y, m } of the visible month
  let sheetCleanup = null;

  function dayState(date) {
    if (isAfter(date, today)) return 'future';
    if (locked && !isAfter(date, locked)) return 'locked';
    return 'open';
  }

  let opening = false;

  async function openDay(date) {
    if (opening) return;              // two taps used to open two sheets
    const state = dayState(date);

    if (state === 'future') {
      await alertDialog({ title: S.notYet, body: S.notYetBody });
      return;
    }

    opening = true;
    let rendered = null;
    let sheetOpen = true;

    const sheet = openSheet({
      title: formatLong(date, S.monthNames, S.weekdayNames),
      content: loadingState(),
      onClose: () => {
        sheetOpen = false;
        rendered?.cleanup();
        rendered = null;
        sheetCleanup = null;
        draw();
      },
    });

    let day;
    try {
      day = await renderDay({
        date,
        editable: state === 'open',
        lockReason: state === 'locked' ? S.lockedBody : null,
      });
    } catch {
      if (sheetOpen) sheet.setContent(emptyState(S.errGeneric));
      opening = false;
      return;
    } finally {
      opening = false;
    }

    /* Closed while the day was loading -- easy, since the sheet is on screen
     * showing a spinner the whole time. `rendered` was still undefined when
     * onClose ran, so every object URL for this day used to leak, and
     * setContent then wrote into a detached node. */
    if (!sheetOpen) {
      day.cleanup();
      return;
    }

    rendered = day;
    sheet.setContent(day.node);
    sheetCleanup = () => { rendered?.cleanup(); rendered = null; };
    // The month's rings are refreshed by draw() when the sheet closes, so
    // marking a dose does not rebuild the sheet under the person's thumb.
  }

  /* Built detached, appended in one go -- see the same note in today.js. The
   * month's data is two awaits away and clearing first left an empty page
   * behind, or, with two draws in flight, two grids. */
  async function draw() {
    today = todayStr();
    locked = (await store.getSettings()).lockedThrough;

    const cells = monthGrid(cursor.y, cursor.m);

    /* History is fetched a range at a time on both devices, so paging to a
     * month nobody has looked at yet has to go and get it. Without this the
     * rings would silently render hollow -- which does not read as "not
     * loaded", it reads as "they took nothing all month".
     *
     * The elder's device joined this: its cache used to hold every dose row
     * the household had, so any month was already local. It now mirrors a
     * recent window and pages back the same way the supporter does. */
    const first = cells[0].date;
    const last = cells[cells.length - 1].date;
    if (settings.role === 'supporter' && settings.supporterCode) {
      await supporterSync.ensureRange(settings.supporterCode, first, last).catch(() => {});
    } else if (settings.role === 'simple' && settings.householdId) {
      /* Imported here rather than at the top: js/sync.js reaches the full
       * Supabase client, and a supporter opens this same view. */
      await import('../sync.js')
        .then(sync => sync.ensureHistoryRange(settings.householdId, first, last))
        .catch(() => {});
    }

    const completion = await scheduleLib.completionForDates(cells.map(c => c.date));
    if (!isCurrent()) return;

    const frag = document.createDocumentFragment();

    frag.appendChild(el('div.cal-head', [
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

    const sheet = el('div.cal-sheet');
    frag.appendChild(sheet);

    sheet.appendChild(el('div.cal-weekdays', S.weekdayShort.map((d, i) =>
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
    sheet.appendChild(grid);

    sheet.appendChild(el('div.cal-legend', [
      el('span.cal-legend-item', [
        el('span.cal-swatch', { style: 'background: var(--taken-line);' }),
        S.allTaken,
      ]),
      el('span.cal-legend-item', [
        el('span.cal-swatch', { style: 'background: var(--skip-line);' }),
        S.someSkipped,
      ]),
      el('span.cal-legend-item', [
        el('span.cal-swatch', { style: 'border: 2px solid var(--line);' }),
        S.nothingMarked,
      ]),
    ]));

    clear(app);
    app.appendChild(frag);
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
