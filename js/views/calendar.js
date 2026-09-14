/* Month calendar - the helper's record of what happened.
 *
 * Six visually AND textually distinct day states, because no mark in this app
 * may ever be carried by colour alone:
 *
 *   ✓  every medicine dealt with          green
 *   ○  something still unmarked           amber
 *   -  something not taken                neutral grey, never red
 *   ·  nothing was due                    paper
 *   ▣  a read-only record, past the lock line
 *      (no mark, plain) a future day, not markable
 *
 * No percentages, no streaks, no scores. This is a memory aid and it must
 * never read as medical judgement - the legend says so out loud.
 *
 * Editable days are those after the household's lock line and not in the
 * future. A nightly server-side job advances `lockedThrough`, synced onto this
 * device by js/sync.js; a day on or before it is kept as a record.
 */

import * as store from '../store.js';
import * as scheduleLib from '../schedule.js';
import * as supporterSync from '../supporter-sync.js';
import { S } from '../strings.js';
import { el, mount, screen, openSheet } from '../ui.js';
import { todayStr, monthGrid, parse, formatLong, isAfter } from '../date.js';
import { go } from '../router.js';

/* One tone per day state. `line` carries the same information as `bg` for
 * anyone who cannot separate the fills. */
const DAY_TONE = {
  done: { bg: 'var(--green-tint)', fg: 'var(--green)', line: 'var(--green-line)', glyph: '✓' },
  part: { bg: 'var(--amber-tint)', fg: 'var(--amber-ink)', line: 'var(--amber)', glyph: '○' },
  skipped: { bg: 'var(--neutral-tint)', fg: 'var(--neutral)', line: 'var(--neutral-line)', glyph: '-' },
  nodue: { bg: 'var(--e-paper)', fg: 'var(--faint)', line: 'var(--divider)', glyph: '·' },
  future: { bg: 'var(--card)', fg: 'var(--s-muted)', line: 'var(--s-line-2)', glyph: '' },
};

function toneFor({ expected, taken, skipped }, { future }) {
  if (future) return DAY_TONE.future;
  if (!expected) return DAY_TONE.nodue;
  const handled = taken + skipped;
  if (handled < expected) return DAY_TONE.part;
  return skipped ? DAY_TONE.skipped : DAY_TONE.done;
}

export async function calendarView({ app, isCurrent = () => true }) {
  const settings = await store.getSettings();
  if (!isCurrent()) return;

  /* Re-read on every draw, not captured once. A calendar left open overnight
   * would otherwise keep treating yesterday as today -- and go on offering to
   * edit it -- and would miss the nightly freeze advancing the lock line
   * underneath it. */
  let today = todayStr();
  let locked = settings.lockedThrough;
  let cursor = parse(today);          // { y, m } of the visible month
  let state = 'loading';              // 'loading' | 'error' | 'empty' | 'month'
  let cells = [];
  let completion = new Map();

  function shell(bodyNode, { scroll = true } = {}) {
    return screen({
      head: el('div.cal-head', [
        el('button.cal-nav', {
          type: 'button', 'aria-label': 'Previous month', text: '‹',
          onclick: () => step(-1),
        }),
        el('button.cal-title', {
          type: 'button',
          text: `${S.monthNames[cursor.m - 1]} ${cursor.y}`,
          onclick: pickMonth,
        }),
        el('button.cal-nav', {
          type: 'button', 'aria-label': 'Next month', text: '›',
          onclick: () => step(1),
        }),
      ]),
      [scroll ? 'scroll' : 'body']: bodyNode,
    });
  }

  function dayState(date) {
    if (isAfter(date, today)) return 'future';
    if (locked && !isAfter(date, locked)) return 'locked';
    return 'open';
  }

  async function load() {
    today = todayStr();
    locked = (await store.getSettings()).lockedThrough;
    cells = monthGrid(cursor.y, cursor.m);

    /* History is fetched a range at a time on both devices, so paging to a
     * month nobody has looked at yet has to go and get it. Without this the
     * grid would silently render "nothing due" all month, which does not read
     * as "not loaded" -- it reads as "they took nothing". */
    const first = cells[0].date;
    const last = cells[cells.length - 1].date;
    try {
      if (settings.role === 'supporter' && settings.supporterCode) {
        await supporterSync.ensureRange(settings.supporterCode, first, last);
      } else if (settings.role === 'simple' && settings.householdId) {
        const sync = await import('../sync.js');
        await sync.ensureHistoryRange(settings.householdId, first, last);
      }
    } catch {
      /* A range that could not be fetched is not fatal: whatever is cached is
       * still worth showing, and the error panel below is reserved for the
       * local read failing. */
    }

    completion = await scheduleLib.completionForDates(cells.map(c => c.date));
    const anything = [...completion.values()].some(c => c.expected || c.taken || c.skipped);
    state = anything ? 'month' : 'empty';
  }

  function monthBody() {
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

    return el('div.cal-body', [
      el('div.cal-weekdays', S.weekdayShort.map((d, i) =>
        el('span', { text: d, 'aria-label': S.weekdayNames[i] }))),

      ...weeks.map(week => el('div.cal-week', week.map(cell => {
        const counts = completion.get(cell.date) || { expected: 0, taken: 0, skipped: 0 };
        const st = dayState(cell.date);
        const tone = toneFor(counts, { future: st === 'future' });
        const isToday = cell.date === today;

        const label = counts.expected
          ? `${formatLong(cell.date, S.monthNames, S.weekdayNames)}, ${S.ofDoses(counts.taken, counts.expected)}${counts.skipped ? `, ${S.ofSkipped(counts.skipped)}` : ''}`
          : formatLong(cell.date, S.monthNames, S.weekdayNames);

        const node = el(`button.cal-day${cell.inMonth ? '' : '.cal-day-out'}${isToday ? '.cal-day-today' : ''}`, {
          type: 'button',
          'aria-label': label,
          'aria-current': isToday ? 'date' : null,
          onclick: () => go(`#/day?date=${cell.date}`),
        }, [
          el(`span.cal-day-num${isToday ? '.cal-day-num-today' : ''}`, {
            text: String(parse(cell.date).d),
          }),
          el('span.cal-day-glyph', {
            'aria-hidden': 'true',
            text: st === 'locked' && tone.glyph ? `▣ ${tone.glyph}` : tone.glyph,
          }),
        ]);
        node.style.setProperty('--day-bg', tone.bg);
        node.style.setProperty('--day-fg', tone.fg);
        node.style.setProperty('--day-line', isToday ? 'var(--navy)' : tone.line);
        return node;
      }))),

      /* Spelled out rather than a row of swatches: the marks are typographic
       * so they scale with the text, and what they mean has to be readable at
       * the same size. */
      el('div.cal-legend', [
        el('span.cal-legend-title', { text: S.calLegendTitle }),
        el('span.cal-legend-line', { text: S.calLegendLine1 }),
        el('span.cal-legend-line', { text: S.calLegendLine2 }),
        el('span.cal-legend-quiet', { text: S.calLegendLine3 }),
      ]),
    ]);
  }

  function draw() {
    if (state === 'loading') {
      mount(app, shell(el('div.s-loading', [
        el('span.s-loading-label', { text: S.calLoading }),
        el('span.s-skeleton', { style: 'height: 220px', 'aria-hidden': 'true' }),
      ])));
      return;
    }

    if (state === 'error') {
      mount(app, shell(el('div.s-list', [
        el('div.s-notice.s-notice-bad', { role: 'alert' }, [
          el('span.s-notice-title', { text: S.calErrorTitle }),
          el('span.s-notice-text', { text: S.calErrorBody }),
          el('button.btn-s.btn-primary.btn-s-xs', {
            type: 'button', text: S.tryAgain, onclick: () => { state = 'loading'; draw(); run(); },
          }),
        ]),
      ])));
      return;
    }

    if (state === 'empty') {
      mount(app, shell(el('div.s-empty', [
        el('p.s-empty-title', { text: S.calEmptyTitle }),
        el('p.s-empty-body', { text: S.calEmptyBody }),
        settings.role === 'supporter'
          ? el('a.btn-s.btn-primary', { href: '#/medicine', text: S.calAddFirst })
          : null,
      ]), { scroll: false }));
      return;
    }

    mount(app, shell(monthBody()));
  }

  function step(months) {
    let m = cursor.m + months;
    let y = cursor.y;
    while (m < 1) { m += 12; y -= 1; }
    while (m > 12) { m -= 12; y += 1; }
    cursor = { y, m };
    state = 'loading';
    draw();
    run();
  }

  /* Month and year in one small panel, so going back a year is two taps rather
   * than twelve presses of the chevron. */
  function pickMonth() {
    let year = cursor.y;
    const sheet = openSheet({ padded: true, content: null });

    const paint = () => {
      sheet.setContent([
        el('div', { style: 'display: flex; align-items: center' }, [
          el('span.s-formbar-title', { text: S.monthPickerTitle }),
          el('button.sheet-close', {
            type: 'button', text: S.close, style: 'margin-left: auto',
            onclick: () => sheet.close(),
          }),
        ]),
        el('div.year-row', [
          el('button.cal-nav', {
            type: 'button', 'aria-label': 'Previous year', text: '−',
            onclick: () => { year -= 1; paint(); },
          }),
          el('span.year-label', { text: String(year) }),
          el('button.cal-nav', {
            type: 'button', 'aria-label': 'Next year', text: '+',
            onclick: () => { year += 1; paint(); },
          }),
        ]),
        el('div.month-picker', S.monthNames.map((name, i) => el('button.btn', {
          type: 'button',
          class: year === cursor.y && i + 1 === cursor.m ? 'btn-primary' : '',
          text: name.slice(0, 3),
          onclick: () => {
            cursor = { y: year, m: i + 1 };
            sheet.close();
            state = 'loading';
            draw();
            run();
          },
        }))),
      ]);
    };
    paint();
  }

  async function run() {
    try {
      await load();
    } catch {
      state = 'error';
    }
    if (!isCurrent()) return;
    draw();
  }

  /* Nothing here polls: the router re-runs the whole view when the helper's
   * poll or the elder's Realtime reports a change. */
  draw();
  await run();
}
