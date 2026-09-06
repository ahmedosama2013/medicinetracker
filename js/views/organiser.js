/* Filling the weekly pill box, one medicine at a time.
 *
 * The screen the photos have always been for. Someone sits at a kitchen table
 * with a plastic tray, a week's worth of boxes and their phone propped against
 * something, and works through one medicine at a time -- so each box is opened
 * exactly once rather than seven times.
 *
 * Three things about that sitting shape this file:
 *
 * 1. THE STEP LIVES IN THE HASH, not in a variable. Realtime, the midnight
 *    check and the supporter's poll all call router.refresh(), and a step index
 *    held in a closure would send someone back to medicine one with both hands
 *    full. `#/organiser?step=3` also gets the back button for free.
 *
 * 2. THE PLAN IS FROZEN when the sitting starts, and read back from the store
 *    on every render. A supporter editing a medicine halfway through must not
 *    change the grid under someone's hands. See store.startOrganiser.
 *
 * 3. NOTHING HERE WRITES TO THE DOSE LOG. Filling a tray is not taking a
 *    medicine, and conflating the two would quietly falsify the calendar. The
 *    start screen says so out loud, because someone who believed otherwise
 *    would stop marking their doses.
 */

import * as store from '../store.js';
import * as photos from '../photos.js';
import { planWeek } from '../organiser.js';
import { S } from '../strings.js';
import {
  el, append, clear, section, emptyState, pillTile, doseText, doseAmount, toast,
} from '../ui.js';
import { todayStr, formatLong, formatTime, dayOfWeek } from '../date.js';
import { go, refresh, currentPath } from '../router.js';

/* ---- keeping the screen awake --------------------------------------------
 *
 * Filling a tray takes minutes with both hands full and nothing to tap, so the
 * phone's own timeout is the enemy. Module-level rather than per-render
 * because every step change is a full route render, and acquiring and
 * releasing the lock nine times in a row would let the screen dim between
 * medicines -- which is the exact thing this exists to prevent.
 *
 * Best effort throughout: the API is absent on older browsers and rejects
 * outright on low battery. There is nothing useful to say about either, and
 * the screen still works, it just dims. */
let wakeLock = null;

async function acquireWakeLock() {
  if (wakeLock || !navigator.wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    // Dropped automatically when the tab hides; this clears our handle so the
    // visibility handler below can ask again rather than thinking it holds one.
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch {
    wakeLock = null;
  }
}

function releaseWakeLock() {
  const held = wakeLock;
  wakeLock = null;
  held?.release?.().catch(() => {});
}

/* The lock is dropped whenever the tab is hidden, so coming back to the app
 * mid-sitting needs it asked for again -- otherwise the screen stays awake
 * until the first time someone looks away, and never afterwards. */
function onVisibility() {
  if (document.visibilityState === 'visible' && currentPath() === '#/organiser') {
    acquireWakeLock();
  }
}

// ---- the week grid --------------------------------------------------------

/** Mon, Tue, ... over the seven dates, as column headings. */
function gridHead(dates) {
  return el('div.og-row.og-head', [
    el('span.og-rowlabel'),
    ...dates.map(date => el('span.og-day', [
      el('span.og-dayname', { text: S.weekdayNames[dayOfWeek(date)].slice(0, 2) }),
      el('span.og-daynum', { text: String(Number(date.slice(8, 10))) }),
    ])),
  ]);
}

/**
 * One medicine's week: a row per time of day, a cell per day.
 *
 * A cell is one of THREE things, not two. Due carries a dot with the amount
 * in it; not-due is a dash. Rendering both as empty makes a twice-weekly
 * medicine's five blank days read as work still outstanding, which on a screen
 * whose whole job is "have I done this yet" is the wrong thing to be vague
 * about.
 */
function weekGrid(grid, dates) {
  return el('div.og-grid', [
    gridHead(dates),
    ...grid.map(row => el('div.og-row', [
      el('span.og-rowlabel', [
        el('span.og-rowname', { text: row.label }),
        el('span.og-rowtime', { text: formatTime(row.time) }),
      ]),
      ...row.days.map(day => el('span.og-cell', day.due
        ? el('span.og-dot', { text: doseAmount(day.qty) })
        : el('span.og-dash', { 'aria-hidden': 'true' }, '–'))),
    ])),
  ]);
}

// ---- the two screens ------------------------------------------------------

/* Everything due this week that is NOT going in the tray, with its reason.
 *
 * Two reasons and two sentences, because they are not the same fact. A syrup
 * cannot go in a compartment at all; a tablet in an unticked time of day is
 * out because of how this household's box is shaped -- and that one is a
 * setting the person can go and change. */
function outOfBoxStrip(outOfBox) {
  // Null, not an empty section: a household whose medicines all go in the box
  // should see no heading at all. Callers use append(), which drops null --
  // appendChild would throw, and did.
  if (!outOfBox.length) return null;
  return section(S.organiserOutHeading, [
    el('div.og-out', outOfBox.map(item => el('div.og-outrow', [
      pillTile({ id: item.medicineId, form: item.form, size: 'sm' }),
      el('span.og-outmain', [
        el('span.og-outname', [
          el('span', { text: item.name }),
          item.strength ? el('span.og-outstrength', { text: ` ${item.strength}` }) : null,
        ]),
        el('span.og-outwhy', {
          text: item.reason === 'form'
            ? S.organiserOutByForm
            : S.organiserOutBySlot(item.slotLabels),
        }),
      ]),
    ]))),
  ]);
}

function startScreen({ app, session, plan, weekStart, onStart, onPick }) {
  const dateInput = el('input', {
    type: 'date', id: 'og-week', value: weekStart,
    onchange: e => onPick(e.target.value),
  });

  app.appendChild(section(null, [
    el('label.og-weeklabel', { for: 'og-week', text: S.organiserWeekLabel }),
    dateInput,
    el('p.setting-hint', { text: S.organiserWeekHint }),
  ]));

  if (!plan.boxSlots.length) {
    app.appendChild(emptyState(S.organiserNoBoxSlots, S.organiserNoBoxSlotsHint));
    app.appendChild(el('a.btn.btn-block', { href: '#/settings', text: S.settingsPillBox }));
    append(app, outOfBoxStrip(plan.outOfBox));
    return;
  }

  if (!plan.steps.length) {
    app.appendChild(emptyState(S.organiserNothing, S.organiserNothingHint));
    append(app, outOfBoxStrip(plan.outOfBox));
    return;
  }

  const done = new Set(session?.done || []);
  const remaining = plan.steps.filter(s => !done.has(s.medicineId)).length;
  const resuming = session?.weekStart === weekStart && done.size > 0 && remaining > 0;

  app.appendChild(section(null, [
    el('p.og-count', { text: S.organiserCount(plan.steps.length) }),
    /* Said once, here, and nowhere else. Repeating it on every step would be
     * nagging; leaving it out entirely risks someone believing this screen
     * marks doses and quietly stopping marking them on Today. */
    el('p.og-notdoses', { text: S.organiserNotDoses }),
    el('button.btn.btn-primary.btn-block', {
      type: 'button',
      text: resuming ? S.organiserResume(remaining) : S.organiserStart,
      onclick: () => onStart(resuming),
    }),
  ]));

  append(app, outOfBoxStrip(plan.outOfBox));
}

function stepScreen({ app, plan, step, index, done, packetUrl, onToggle }) {
  app.appendChild(el('p.og-progress', { text: S.organiserStep(index + 1, plan.steps.length) }));

  /* The packet, big, because the question at this moment is "which box do I
   * reach for?" -- not "which tablet is this?", which is what the pill tile
   * answers everywhere else in the app. With no packet photo the pill tile is
   * the honest fallback rather than a hole in the layout. */
  app.appendChild(packetUrl
    ? el('div.og-packet', el('img', { src: packetUrl, alt: '' }))
    : el('div.og-packet.og-packet-none', pillTile({
      id: step.medicineId, form: step.form, size: 'lg',
    })));

  app.appendChild(el('h2.og-name', [
    el('span', { text: step.name }),
    step.strength ? el('span.og-strength', { text: ` ${step.strength}` }) : null,
  ]));
  if (step.purpose) app.appendChild(el('p.og-purpose', { text: step.purpose }));

  /* The number that gets acted on: how many to tip out of the box before
   * distributing them. Biggest thing on the screen, because everything else
   * here is a reference and this is an instruction. */
  app.appendChild(el('div.og-total', [
    el('span.og-total-label', { text: S.organiserTakeOut }),
    el('span.og-total-value', {
      text: doseText({ doseQty: step.total, form: step.form }),
    }),
  ]));

  app.appendChild(weekGrid(step.grid, plan.dates));

  app.appendChild(el('div.og-actions', [
    el('button.btn.btn-quiet', {
      type: 'button', text: S.organiserBack,
      onclick: () => go(index === 0 ? '#/organiser' : `#/organiser?step=${index}`),
    }),
    el(`button.btn${done ? '' : '.btn-primary'}`, {
      type: 'button',
      text: index === plan.steps.length - 1 ? S.organiserFinish : S.organiserNext,
      onclick: () => onToggle(true),
    }),
  ]));

  /* A way back out of "filled" without walking backwards through the sitting.
   * Only offered once it IS filled -- an unfilled step has nothing to undo. */
  if (done) {
    app.appendChild(el('button.btn-link.og-unfill', {
      type: 'button', text: S.organiserUnfill, onclick: () => onToggle(false),
    }));
  }
}

// ---- the view -------------------------------------------------------------

export async function organiserView({ app, query, isCurrent = () => true }) {
  const tokens = [];
  const cleanup = () => {
    photos.releaseAll(tokens.splice(0));
    document.removeEventListener('visibilitychange', onVisibility);
    /* Only when actually LEAVING the organiser. The router runs this before
     * the next render, and by then the hash already holds the destination --
     * so a step change can be told apart from a departure, and the lock is not
     * dropped and re-taken nine times in a row. */
    if (currentPath() !== '#/organiser') releaseWakeLock();
  };

  acquireWakeLock();
  document.addEventListener('visibilitychange', onVisibility);

  const stepParam = Number(query?.get('step'));
  const wanted = Number.isInteger(stepParam) && stepParam > 0 ? stepParam : 0;

  const [settings, session] = await Promise.all([store.getSettings(), store.getOrganiser()]);
  if (!isCurrent()) return cleanup;

  const weekStart = session?.weekStart || todayStr();

  /* Read back from the session when there is one, so the grid cannot move
   * under someone mid-sitting. Recomputed only for the start screen, where
   * nothing has been committed to yet and the person is still choosing. */
  let plan = session?.plan;
  if (!plan || session.weekStart !== weekStart) {
    const [medicines, schedules, slots] = await Promise.all([
      store.getMedicines(), store.getActiveSchedules(), store.getSlots(),
    ]);
    if (!isCurrent()) return cleanup;
    plan = planWeek(weekStart, { medicines, schedules, slots });
  }

  const done = new Set(session?.done || []);
  const index = wanted - 1;
  const step = wanted > 0 ? plan.steps[index] : null;

  // A step number past the end of the plan -- a stale bookmark, or a routine
  // that shrank between sittings. Back to the start rather than a blank screen.
  if (wanted > 0 && !step) {
    go('#/organiser', { replace: true });
    return cleanup;
  }

  /* The packet photo is read here rather than for every medicine up front:
   * one step is on screen at a time, and holding nine blobs live to show one
   * is nine object URLs doing nothing. */
  let packetUrl = null;
  if (step) {
    const blob = await store.getPhotoBlob(step.medicineId, 'packet').catch(() => null);
    if (!isCurrent()) return cleanup;
    if (blob) {
      const { url, token } = photos.objectUrl(blob);
      tokens.push(token);
      packetUrl = url;
    }
  }

  clear(app);
  app.appendChild(el('h1.page-title', { text: S.organiserTitle }));
  app.appendChild(el('p.og-week', {
    text: `${formatLong(plan.dates[0], S.monthNames, S.weekdayNames)} – ${formatLong(plan.dates[6], S.monthNames, S.weekdayNames)}`,
  }));

  if (!step) {
    startScreen({
      app, session, plan, weekStart,
      onPick: async next => {
        if (!next) return;
        const [medicines, schedules, slots] = await Promise.all([
          store.getMedicines(), store.getActiveSchedules(), store.getSlots(),
        ]);
        await store.startOrganiser(next, planWeek(next, { medicines, schedules, slots }));
        // Already on this route, so the hash does not change and nothing would
        // re-render on its own.
        refresh();
      },
      onStart: async resuming => {
        // Freeze it now: from here the grid must not move, whatever anyone
        // else edits while this sitting is going on.
        if (!resuming || session?.weekStart !== weekStart) {
          await store.startOrganiser(weekStart, plan);
        }
        const firstUndone = plan.steps.findIndex(s => !done.has(s.medicineId));
        go(`#/organiser?step=${(firstUndone === -1 ? 0 : firstUndone) + 1}`);
      },
    });
    return cleanup;
  }

  stepScreen({
    app, plan, step, index, packetUrl,
    done: done.has(step.medicineId),
    onToggle: async filled => {
      await store.setOrganiserStepDone(step.medicineId, filled);
      if (!filled) { refresh(); return; }
      if (index === plan.steps.length - 1) {
        toast(S.organiserDone);
        go('#/today');
        return;
      }
      go(`#/organiser?step=${wanted + 1}`);
    },
  });

  return cleanup;
}
