/* Filling the weekly pill box, one medicine at a time. Shared by both roles —
 * whoever is holding the tray fills it.
 *
 * THIS FLOW CAN NEVER MARK A DOSE. Filling a tray is not taking a medicine,
 * and conflating the two would quietly falsify the calendar. So it has its own
 * vocabulary ("It is in the box", never "taken"), its own progress bar
 * explicitly labelled as job progress, a blue information band that says so on
 * entry, and no "taken" affordance anywhere. The check screen shows quantities
 * to compare with the tray and explicitly refuses to certify it — the app
 * cannot see the tray, so the last word is the person's.
 *
 * Three things about the sitting shape this file:
 *
 * 1. THE STEP LIVES IN THE HASH, not in a variable. Realtime, the midnight
 *    check and the helper's poll all call router.refresh(), and a step index
 *    held in a closure would send someone back to medicine one with both hands
 *    full. `#/organiser?step=3` also gets the back button for free.
 *
 * 2. THE PLAN IS FROZEN when the sitting starts, and read back from the store
 *    on every render. A helper editing a medicine halfway through must not
 *    change the grid under someone's hands. See store.startOrganiser.
 *
 * 3. QUANTITIES ARE CHIPS, NOT A TABLE. One chip per weekday with the number
 *    in it, tinted green where there is a dose and grey where there is not.
 *    A table of ticks is unreadable at arm's length on a kitchen table.
 */

import * as store from '../store.js';
import * as supporter from '../supporter.js';
import * as photos from '../photos.js';
import { planWeek } from '../organiser.js';
import { S } from '../strings.js';
import {
  el, mount, screen, toast, pillTile, doseText, doseAmount,
  openPhotoViewer, openSheet, progressBar,
} from '../ui.js';
import { todayStr, formatLong, formatTime, dayOfWeek, addDays } from '../date.js';
import { go, refresh, currentPath } from '../router.js';

/* ---- keeping the screen awake --------------------------------------------
 *
 * Filling a tray takes minutes with both hands full and nothing to tap, so the
 * phone's own timeout is the enemy. Module-level rather than per-render
 * because every step change is a full route render, and acquiring and
 * releasing the lock nine times in a row would let the screen dim between
 * medicines -- which is the exact thing this exists to prevent. */
let wakeLock = null;

async function acquireWakeLock() {
  if (wakeLock || !navigator.wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
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

function onVisibility() {
  if (document.visibilityState === 'visible' && currentPath() === '#/organiser') {
    acquireWakeLock();
  }
}

// ---- sheets ---------------------------------------------------------------

/* Which compartments the physical box actually has. A tick list rather than a
 * settings screen, because it is a question about the plastic object on the
 * table and the answer changes when someone buys a different box. */
function openBoxTimes(slots, { role, code, onChange }) {
  const draft = slots.map(s => ({ ...s }));

  const sheet = openSheet({
    padded: true,
    content: null,
  });

  function paint() {
    sheet.setContent([
      el('span.ms-name', { text: S.boxTimesTitle, style: 'font-size: 22px' }),
      el('span.callout-body', { text: S.boxTimesBody }),
      ...draft.map(slot => el('button.boxtime-row', {
        type: 'button',
        'aria-pressed': String(!!slot.inBox),
        onclick: async () => {
          const next = !slot.inBox;
          if (!next && draft.filter(s => s.inBox).length === 1) {
            toast(S.boxTimesKeepOne);
            return;
          }
          slot.inBox = next;
          paint();
          try {
            /* The elder's device writes through the same code-gated RPC the
             * helper uses, but has to tell its own sync layer that this write
             * was local so the echo does not look like a remote edit. */
            if (role === 'simple') {
              const sync = await import('../sync.js');
              sync.markRoutineWrite(slot.id);
            }
            await supporter.setSlotInBox(code, slot.id, next);
            await store.saveSettings({ slots: draft.map(({ ...s }) => s) });
            onChange?.();
          } catch {
            slot.inBox = !next;
            paint();
            toast(S.errGeneric);
          }
        },
      }, [
        el('span.boxtime-tick', { 'aria-hidden': 'true', text: slot.inBox ? '✓' : '' }),
        el('span.boxtime-name', { text: slot.label }),
        el('span.boxtime-time', { text: formatTime(slot.time) }),
      ])),
      el('button.btn.btn-primary.btn-lg.btn-block', {
        type: 'button', text: S.done, onclick: () => sheet.close(),
      }),
    ]);
  }

  paint();
  return sheet;
}

/* Everything due this week that is NOT going in the tray, with its reason.
 * Two reasons and two sentences, because they are not the same fact: a syrup
 * cannot go in a compartment at all; a tablet in an unticked time of day is
 * out because of how this household's box is shaped -- and that one is a
 * setting the person can go and change. */
function openOutside(outOfBox) {
  const sheet = openSheet({
    padded: true,
    content: [
      el('span.ms-name', { text: S.fillOutsideTitle, style: 'font-size: 24px' }),
      ...outOfBox.map(item => el('div.out-row', [
        el('span.out-name', { text: [item.name, item.strength].filter(Boolean).join(' ') }),
        el('span.out-dose', { text: doseText({ doseQty: item.doseQty, form: item.form }) }),
        el('span.out-why', {
          text: item.reason === 'form' ? S.fillOutByForm : S.fillOutBySlot(item.slotLabels),
        }),
      ])),
      el('button.btn.btn-primary.btn-lg.btn-block', {
        type: 'button', text: S.done, onclick: () => sheet.close(),
      }),
    ],
  });
  return sheet;
}

/* What belongs in one compartment -- because a count that does not match is
 * only useful if you can then work out WHICH medicine is missing, and that is
 * a question you answer by looking at the pills, not by reading names. So the
 * real photos are loaded here, on demand and per compartment. */
function openCompartment(row, day) {
  const rows = new Map();
  const tokens = [];

  const sheet = openSheet({
    padded: true,
    onClose: () => photos.releaseAll(tokens.splice(0)),
    content: [
      el('span.ms-name', {
        text: formatLong(day.date, S.monthNames, S.weekdayNames),
        style: 'font-size: 22px',
      }),
      el('span.comp-qty', { text: `${row.label} · ${formatTime(row.time)}` }),
      ...(day.items.length
        ? day.items.map(item => {
          const node = el('div.comp-row', [
            pillTile({ id: item.medicineId, form: item.form, size: 'md', label: false }),
            el('span.comp-main', [
              el('span.comp-name', { text: item.name }),
              el('span.comp-qty', { text: doseText({ doseQty: item.qty, form: item.form }) }),
            ]),
          ]);
          rows.set(item.medicineId, { node, item });
          return node;
        })
        : [el('p.sheet-note', { text: S.fillCompartmentEmpty })]),
      el('span.sheet-note', { text: S.fillCompartmentNote }),
      el('button.btn.btn-primary.btn-lg.btn-block', {
        type: 'button', text: S.done, onclick: () => sheet.close(),
      }),
    ],
  });

  for (const [medicineId, { node, item }] of rows) {
    store.getPhotoBlob(medicineId, 'pill')
      .then(blob => {
        // Closed again while the read was in flight: onClose has already run,
        // so a URL created now would never be revoked.
        if (!blob || !node.isConnected) return;
        const { url, token } = photos.objectUrl(blob);
        tokens.push(token);
        node.firstChild.replaceWith(pillTile({
          id: medicineId, url, form: item.form, alt: item.name, size: 'md', label: false,
        }));
      })
      .catch(() => { /* the fallback tile is already there */ });
  }

  return sheet;
}

function openWeekPicker(weekStart, onPick) {
  let value = weekStart;
  const sheet = openSheet({
    padded: true,
    content: [
      el('span.ms-name', { text: S.fillWeekLabel, style: 'font-size: 22px' }),
      el('input', {
        type: 'date', value, style: 'min-height: 56px; font-size: 18px',
        oninput: e => { value = e.target.value; },
      }),
      el('span.sheet-note', { text: S.fillCountNote }),
      el('button.btn.btn-primary.btn-lg.btn-block', {
        type: 'button',
        text: S.done,
        onclick: () => { sheet.close(); if (value) onPick(value); },
      }),
    ],
  });
  return sheet;
}

// ---- the three screens ----------------------------------------------------

function weekLabel(dates) {
  return `${formatLong(dates[0], S.monthNames, S.weekdayNames)} – ${formatLong(dates[6], S.monthNames, S.weekdayNames)}`;
}

function startScreen({
  app, session, plan, weekStart, allSlots, code, role, onStart, onPick, onRefresh,
}) {
  const done = new Set(session?.done || []);
  const remaining = plan.steps.filter(s => !done.has(s.medicineId)).length;
  const resuming = session?.weekStart === weekStart && done.size > 0 && remaining > 0;
  const hasWork = plan.boxSlots.length > 0 && plan.steps.length > 0;

  const boxLabel = plan.boxSlots.map(s => s.label).join(', ') || S.fillCompartmentsNone;

  mount(app, screen({
    head: el('div.fill-head', [
      el('h1.page-title', { text: S.fillTitle }),
      el('span.fill-sub', { text: S.fillSubtitle }),
    ]),
    scroll: el('div.fill-body', [

      /* Said once, on entry, in its own colour. Repeating it on every step
       * would be nagging; leaving it out risks someone believing this screen
       * marks doses and quietly stopping marking them on Today. */
      el('div.fill-notdoses', [
        el('span.fill-notdoses-glyph', { 'aria-hidden': 'true', text: 'i' }),
        el('span.fill-notdoses-text', { text: S.fillNotDoses }),
      ]),

      el('div.setting-rows', [
        el('button.setting-row', {
          type: 'button',
          onclick: () => openWeekPicker(weekStart, onPick),
        }, [
          el('span.setting-row-main', [
            el('span.setting-row-label', { text: S.fillWeekLabel }),
            el('span.setting-row-value', { text: weekLabel(plan.dates) }),
          ]),
          el('span.setting-row-action', { text: S.fillChange }),
        ]),
        el('button.setting-row', {
          type: 'button',
          onclick: () => openBoxTimes(allSlots, { role, code, onChange: onRefresh }),
        }, [
          el('span.setting-row-main', [
            el('span.setting-row-label', { text: S.fillCompartmentsLabel }),
            el('span.setting-row-value', { text: boxLabel }),
          ]),
          el('span.setting-row-action', { text: S.fillChange }),
        ]),
      ]),

      !plan.boxSlots.length ? el('div.callout.callout-warn', [
        el('span.callout-title', { text: S.fillNoSlotsTitle }),
        el('span.callout-body', { text: S.fillNoSlotsBody }),
        el('button.btn', {
          type: 'button',
          text: S.fillChooseCompartments,
          style: 'align-self: flex-start; min-height: 52px; background: var(--amber-ink); color: #fff; font-size: 16px',
          onclick: () => openBoxTimes(allSlots, { role, code, onChange: onRefresh }),
        }),
      ]) : null,

      plan.boxSlots.length && !plan.steps.length ? el('div.callout.callout-neutral', [
        el('span.callout-title', { text: S.fillNothingTitle }),
        el('span.callout-body', { text: S.fillNothingBody }),
      ]) : null,

      hasWork ? el('div.callout.callout-green', [
        el('span.callout-title', { text: S.fillCount(plan.steps.length) }),
        el('span.callout-body', { text: S.fillCountNote }),
      ]) : null,

      resuming ? el('div.callout.callout-resume', [
        el('span.callout-title', { text: S.fillResumeTitle }),
        el('span.callout-body', { text: S.fillResumeBody(done.size, plan.steps.length) }),
        el('div.callout-actions', [
          el('button.btn.btn-primary', {
            type: 'button', text: S.fillCarryOn, onclick: () => onStart(true),
          }),
          el('button.btn.btn-quiet', {
            type: 'button', text: S.fillStartAgain, onclick: () => onStart(false),
          }),
        ]),
      ]) : null,

      plan.outOfBox.length ? el('button.fill-outside', {
        type: 'button',
        text: S.fillOutsideButton(plan.outOfBox.length),
        onclick: () => openOutside(plan.outOfBox),
      }) : null,
    ]),
    foot: hasWork && !resuming ? el('div.fill-foot', [
      el('button.btn.btn-primary.btn-xl.btn-block', {
        type: 'button', text: S.fillStart, onclick: () => onStart(false),
      }),
    ]) : null,
  }));
}

/** One chip per weekday, with the quantity in it. */
function qtyStrip(step, dates) {
  return el('div.qty-strip', dates.map((date, i) => {
    const qty = step.grid.reduce((sum, row) => sum + (row.days[i]?.qty || 0), 0);
    return el(`span.qty-chip${qty ? '.is-on' : ''}`, [
      el('span.qty-chip-day', { text: S.weekdayShort3[dayOfWeek(date)] }),
      el('span.qty-chip-num', { text: qty ? doseAmount(qty) : '–' }),
    ]);
  }));
}

/** "Every day, morning and evening" / "Mon, Thu, Sun — morning". */
function daysSentence(step, dates) {
  const dueDays = dates.filter((_, i) =>
    step.grid.some(row => row.days[i]?.due));
  const slotNames = [...new Set(step.grid
    .filter(row => row.days.some(d => d.due))
    .map(row => row.label.toLowerCase()))];
  const slotText = slotNames.length > 1
    ? `${slotNames.slice(0, -1).join(', ')} and ${slotNames[slotNames.length - 1]}`
    : (slotNames[0] || '');
  const dayText = dueDays.length === dates.length
    ? S.freqDaily.toLowerCase()
    : dueDays.map(d => S.weekdayShort3[dayOfWeek(d)]).join(', ');
  return [dayText, slotText].filter(Boolean).join(' — ');
}

function stepScreen({ app, plan, step, index, done, photoUrls, onToggle, doneCount }) {
  const last = index === plan.steps.length - 1;
  const title = [step.name, step.strength].filter(Boolean).join(' ');

  const slab = (url, caption, packet) => (url
    ? el(`button.photo-slab${packet ? '.photo-slab-packet' : ''}`, {
      type: 'button',
      'aria-label': `${caption}: ${S.fillTapToEnlarge}`,
      onclick: () => openPhotoViewer({
        url, name: step.name, strength: step.strength, altText: title, caption,
      }),
    }, [
      el('img', { src: url, alt: '' }),
      el('span.photo-slab-tag', { text: caption }),
    ])
    /* No photo yet: the slab still says which one is missing, in two words.
     * The long "ask whoever adds the medicines" line is said once below the
     * pair, not twice inside it. */
    : el(`div.photo-slab${packet ? '.photo-slab-packet' : ''}`, [
      el('span.photo-slab-cap', { text: caption }),
      el('span.photo-slab-hint', {
        text: packet ? S.noPacketPhotoYet : S.noPhoto,
        style: 'text-decoration: none; font-size: 13px',
      }),
    ]));

  mount(app, screen({
    head: el('div.fillstep-head', [
      el('div.fillstep-bar', [
        el('a.back-btn', { href: '#/organiser', text: S.close }),
        el('span.fillstep-count', { text: S.fillProgress(index + 1, plan.steps.length) }),
      ]),
      el('span.progress.fillstep-progress', { 'aria-hidden': 'true' },
        el('span', { style: `width: ${Math.round(((index + 1) / plan.steps.length) * 100)}%` })),
      el('span.fillstep-note', {
        text: `${S.fillDoneCount(doneCount, plan.steps.length)} — ${S.fillProgressNote}`,
      }),
    ]),
    scroll: el('div.fillstep-body', [
      el('div', { style: 'display: flex; flex-direction: column; gap: 2px' }, [
        el('span.fillstep-name', { text: title }),
        step.purpose ? el('span.fillstep-purpose', { text: step.purpose }) : null,
      ]),

      el('div.photo-pair', [
        slab(photoUrls.pill, S.pillPhoto, false),
        slab(photoUrls.packet, S.packetPhoto, true),
      ]),
      !photoUrls.pill && !photoUrls.packet
        ? el('span.qty-days', { text: S.fillNoPhotos })
        : null,

      /* The number that gets acted on: how many to tip out of the box before
       * distributing them. Biggest thing in the card, because everything else
       * here is a reference and this is an instruction. */
      el('div.qty-card', [
        el('span.qty-total', {
          text: S.fillWeekQty(doseText({ doseQty: step.total, form: step.form })),
        }),
        el('span.qty-caption', { text: S.fillHowManyEachDay }),
        qtyStrip(step, plan.dates),
        el('span.qty-days', { text: daysSentence(step, plan.dates) }),
      ]),
    ]),
    foot: el('div.fillstep-foot', [
      done
        ? el('div.filled-strip', [
          el('span.filled-strip-glyph', { 'aria-hidden': 'true', text: '✓' }),
          el('span.filled-strip-text', { text: S.fillIsInTheBox }),
          el('button.btn', {
            type: 'button', text: S.fillUndo, onclick: () => onToggle(false),
          }),
        ])
        : el('button.btn.btn-primary.btn-xl.btn-block', {
          type: 'button', text: S.fillInTheBox, onclick: () => onToggle(true),
        }),
      el('div.fillstep-nav', [
        el('button.btn.btn-quiet', {
          type: 'button',
          text: S.fillBack,
          onclick: () => go(index === 0 ? '#/organiser' : `#/organiser?step=${index}`),
        }),
        el('button.btn.btn-outline', {
          type: 'button',
          text: last ? S.fillCheckTheBox : S.fillNextMedicine,
          onclick: () => go(last ? '#/organiser?step=check' : `#/organiser?step=${index + 2}`),
        }),
      ]),
    ]),
  }));
}

/* The tray, checked by counting.
 *
 * Counting is how a filled organiser is actually verified. Colour cannot do
 * it: real photos of white tablets are grey. There is no tick, no pass, no
 * "looks right" -- the app cannot see the tray, and an app that claimed the
 * tray was correct would be claiming something it has no way to know. */
function checkScreen({ app, plan, onFinish }) {
  mount(app, screen({
    head: el('div.fillcheck-head', [
      el('a.back-btn', {
        href: `#/organiser?step=${plan.steps.length}`,
        text: S.fillCheckBackToMedicines,
      }),
      el('span.fillcheck-title', { text: S.fillCheckTitle }),
      el('span.fillcheck-intro', { text: S.fillCheckIntro }),
    ]),
    scroll: el('div.fillcheck-body', [
      el('div.check-head', plan.boxSlots.map(s => el('span', { text: s.label }))),
      ...plan.dates.map((date, i) => el('div.check-row', [
        el('span.check-day', {
          text: `${S.weekdayShort3[dayOfWeek(date)]} ${Number(date.slice(8, 10))}`,
        }),
        ...plan.compartments.map(row => {
          const day = row.days[i];
          const total = day?.total || 0;
          return el(`button.check-cell${total ? '' : '.check-cell-empty'}`, {
            type: 'button',
            'aria-label': `${row.label}, ${formatLong(date, S.monthNames, S.weekdayNames)}`,
            text: total ? doseAmount(total) : '–',
            onclick: () => openCompartment(row, day),
          });
        }),
      ])),
      el('p.fillcheck-hint', { text: S.fillCheckTapHint }),
    ]),
    foot: el('div.fill-foot', [
      el('button.btn.btn-primary.btn-xl.btn-block', {
        type: 'button', text: S.fillCheckDone, onclick: onFinish,
      }),
    ]),
  }));
}

// ---- the view -------------------------------------------------------------

export async function organiserView({ app, query, isCurrent = () => true }) {
  /* A household that has said it does not use a physical box at all -- see
   * Settings, and js/main.js's nav filter which normally keeps this route out
   * of reach. Checked again here for whoever still lands on it directly: an
   * old bookmark, a stale nav render, or the moment right after someone else
   * on the household just turned it off. Before the wake lock and its
   * listener are taken, not after, so there is nothing here to clean up. */
  if ((await store.getSettings()).usesOrganizer === false) {
    if (!isCurrent()) return;
    go('#/today');
    return;
  }
  if (!isCurrent()) return;

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

  /* `?step=` is 0 (or absent) for the start screen, 1..N for the medicines,
   * and the literal "check" for the tray check at the end. A string rather
   * than N+1 so the check screen keeps its identity when the routine changes
   * size between sittings. */
  const raw = query?.get('step') || '';
  const checking = raw === 'check';
  const stepParam = Number(raw);
  const wanted = !checking && Number.isInteger(stepParam) && stepParam > 0 ? stepParam : 0;

  const [settings, stored, boxSlots, allSlots] = await Promise.all([
    store.getSettings(), store.getOrganiser(), store.getBoxSlots(), store.getSlots(),
  ]);
  if (!isCurrent()) return cleanup;

  const code = settings.role === 'simple' ? settings.shareCode : settings.supporterCode;

  /* The plan is frozen for a sitting so nobody's edit can move the grid under
   * someone's hands -- but changing which times of day go in the box is not an
   * edit to the routine, it is a change to the tray being filled. A plan made
   * for a 7x2 tray is meaningless once the box is 7x4, so that one change ends
   * the sitting rather than being ignored by it. */
  const boxIds = boxSlots.map(s => s.id).join('|');
  const plannedBoxIds = (stored?.plan?.boxSlots || []).map(s => s.id).join('|');
  const staleBox = !!stored && plannedBoxIds !== boxIds;
  if (staleBox) await store.clearOrganiser();
  const session = staleBox ? null : stored;

  /* The week starts on the Monday of the current week rather than "today", so
   * the columns line up with the tray in front of the person. Overridden by
   * whatever the sitting was started for. */
  const mondayOfThisWeek = () => {
    const today = todayStr();
    const shift = (dayOfWeek(today) + 6) % 7;     // Sunday = 0 in dayOfWeek
    return addDays(today, -shift);
  };
  const weekStart = session?.weekStart || mondayOfThisWeek();

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

  // Back to the start whenever the sitting was just discarded, the step number
  // is past the end of the plan, or there is nothing to check.
  if ((staleBox && (wanted > 0 || checking))
    || (wanted > 0 && !step)
    || (checking && !plan.steps.length)) {
    go('#/organiser', { replace: true });
    return cleanup;
  }

  if (checking) {
    checkScreen({
      app,
      plan,
      onFinish: () => {
        store.clearOrganiser().catch(() => {});
        go('#/today');
        toast(S.fillCheckToast);
      },
    });
    return cleanup;
  }

  if (!step) {
    startScreen({
      app,
      session,
      plan,
      weekStart,
      allSlots,
      code,
      role: settings.role,
      onRefresh: () => refresh(),
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
        const firstUndone = resuming
          ? plan.steps.findIndex(s => !done.has(s.medicineId))
          : 0;
        go(`#/organiser?step=${(firstUndone === -1 ? 0 : firstUndone) + 1}`);
      },
    });
    return cleanup;
  }

  /* Both photos, read here rather than for every medicine up front: one step
   * is on screen at a time, and holding a dozen blobs live to show two is a
   * dozen object URLs doing nothing. */
  const photoUrls = { pill: null, packet: null };
  const [pill, packet] = await Promise.all([
    store.getPhotoBlob(step.medicineId, 'pill').catch(() => null),
    store.getPhotoBlob(step.medicineId, 'packet').catch(() => null),
  ]);
  if (!isCurrent()) return cleanup;
  for (const [kind, blob] of [['pill', pill], ['packet', packet]]) {
    if (!blob) continue;
    const { url, token } = photos.objectUrl(blob);
    tokens.push(token);
    photoUrls[kind] = url;
  }

  stepScreen({
    app,
    plan,
    step,
    index,
    photoUrls,
    done: done.has(step.medicineId),
    doneCount: done.size,
    onToggle: async filled => {
      await store.setOrganiserStepDone(step.medicineId, filled);
      toast(filled ? S.fillPutIn(step.name) : S.fillUnmarked(step.name));
      if (!filled) { refresh(); return; }
      if (index === plan.steps.length - 1) { go('#/organiser?step=check'); return; }
      go(`#/organiser?step=${wanted + 1}`);
    },
  });

  return cleanup;
}
