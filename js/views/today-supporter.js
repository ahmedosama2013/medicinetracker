/* The helper's Today: the same information architecture as the elder's,
 * deliberately denser, and tightened for trust.
 *
 * Three things separate it from the elder's screen, and all three are about
 * honesty rather than density:
 *
 * 1. IT IS A COPY OF SOMEONE ELSE'S DAY. The helper polls; they do not receive
 *    Realtime (it respects RLS and they have no session). So the top of the
 *    screen states how old the data is and offers a manual check, and says so
 *    out loud when the copy is stale or the refresh failed. "They haven't
 *    marked anything" is exactly the wrong thing to be wrong about.
 * 2. THEIR PHONE MAY BE ON A DIFFERENT DATE. todayStr() answers with the
 *    household's day, which is the only correct answer - and it means this
 *    screen can say Sunday while the phone it runs on says Monday. Said out
 *    loud, and only when the two actually differ.
 * 3. ACTING ON SOMEONE'S BEHALF IS ALWAYS LABELLED. Once per session in a
 *    confirmation, and after that permanently in a dashed chip.
 *
 * The slot list is collapsible: a row per time of day, expanding to
 * per-medicine rows plus a "Mark the whole slot" action. Marking the whole
 * slot is real and reversible but it is never the primary action - making it
 * primary invites marking everything at 8am before anything is swallowed.
 */

import * as store from '../store.js';
import * as photos from '../photos.js';
import * as supporterSync from '../supporter-sync.js';
import * as supporter from '../supporter.js';
import { S, firstNameOf } from '../strings.js';
import {
  el, mount, screen, paintTone, pillTile, toast, doseText, doseTone,
} from '../ui.js';
import { loadDay, describeDay, describeSlot, doseKey } from '../day-model.js';
import { doses, mayMark, mayMarkSlot, settled, onBehalfActive } from '../marking.js';
import { todayStr, formatLong, formatShort } from '../date.js';
import { refresh } from '../router.js';
import { openMedicineSheet } from './medicine-sheet.js';

/* How old a copy has to be before the sync line stops looking fresh. Fifteen
 * minutes rather than the poll interval: a single missed poll is not news, a
 * quarter of an hour of silence is. */
const STALE_AFTER_MS = 15 * 60 * 1000;

/* Which slot is expanded, kept across re-renders within a session so the
 * poll's refresh() does not close the row the helper is working in. */
let openSlotId = null;

export async function supporterTodayView({ app, isCurrent, settings }) {
  const date = todayStr();
  const code = settings.supporterCode;
  const name = firstNameOf(settings.supporterHouseholdName);

  const tokens = [];
  const cleanup = () => photos.releaseAll(tokens.splice(0));

  let refreshFailed = false;
  let refreshing = false;

  const day = await loadDay(date);
  if (!isCurrent()) return cleanup;

  // Photos come from the local cache js/supporter-sync.js fills, not a signed
  // URL per row - that would be two round trips per medicine, every visit.
  const medicineIds = [...new Set(day.groups.flatMap(g => g.medicines.map(m => m.medicineId)))];
  const photoRows = await Promise.all(medicineIds.map(id => store.getPhoto(id).catch(() => null)));
  if (!isCurrent()) return cleanup;
  const urlFor = new Map();
  photoRows.forEach((row, i) => {
    if (!row?.blob) return;
    const { url, token } = photos.objectUrl(row.blob);
    tokens.push(token);
    urlFor.set(medicineIds[i], url);
  });

  // ---- writes -------------------------------------------------------------

  function restore(snapshot) {
    day.states.clear();
    for (const [k, v] of snapshot) day.states.set(k, v);
  }

  async function setDose(card, medicine, status) {
    if (status && !await mayMark(settings, { householdName: name })) return;

    const key = doseKey(card.id, medicine.medicineId);
    const before = new Map(day.states);
    if (status) day.states.set(key, status); else day.states.delete(key);
    draw();

    try {
      await doses.setDose(settings, date, card.id, medicine.medicineId, status);
    } catch {
      restore(before);
      draw();
      toast(S.errGeneric);
      return;
    }
  }

  async function markSlot(card) {
    if (!await mayMarkSlot(settings, {
      slotName: card.name, count: card.total, householdName: name,
    })) return;

    const before = new Map(day.states);
    for (const m of card.medicines) {
      if (!m.state) day.states.set(doseKey(card.id, m.medicineId), 'taken');
    }
    draw();

    try {
      await settled(card.medicines.map(m => doseKey(card.id, m.medicineId)));
      await doses.logSlot(settings, date, card.id, card.medicines.map(m => m.medicineId));
    } catch {
      restore(before);
      draw();
      toast(S.errGeneric);
      return;
    }
  }

  async function undoSlot(card) {
    const before = new Map(day.states);
    for (const m of card.medicines) day.states.delete(doseKey(card.id, m.medicineId));
    draw();
    try {
      await settled(card.medicines.map(m => doseKey(card.id, m.medicineId)));
      await doses.undoSlot(settings, date, card.id);
    } catch {
      restore(before);
      draw();
      toast(S.errGeneric);
      return;
    }
  }

  // ---- sync state ---------------------------------------------------------

  function syncBar() {
    const at = supporterSync.lastSync();
    const age = at ? Date.now() - at : Infinity;
    const stale = age > STALE_AFTER_MS;
    const mins = at ? Math.floor(age / 60000) : 0;

    return el('div.s-bar', [
      el(`span.s-dot${stale ? '.s-dot-stale' : ''}`, { 'aria-hidden': 'true' }),
      el('span.s-bar-text', {
        text: !at ? S.updatedNever : (mins < 1 ? S.updatedJustNow : S.updatedAgo(mins)),
      }),
      el('button.s-bar-action', {
        type: 'button',
        text: refreshing ? S.loading : S.checkNow,
        disabled: refreshing,
        onclick: checkNow,
      }),
    ]);
  }

  async function checkNow() {
    refreshing = true;
    draw();
    try {
      await supporterSync.refresh(code);
      refreshFailed = false;
      refreshing = false;
      /* A full re-render, not a repaint: the whole point of the button is that
       * the day itself may have changed underneath. */
      refresh();
      return;
    } catch {
      refreshFailed = true;
    }
    refreshing = false;
    draw();
  }

  /* Their phone's own calendar date, in its own zone. Compared against the
   * household's day rather than assumed equal to it. */
  function deviceDateLine() {
    const now = new Date();
    const deviceDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    if (deviceDate === date) return null;
    return el('div.s-notice.s-notice-warn', { role: 'status' }, [
      el('span.s-notice-glyph', { 'aria-hidden': 'true', text: '!' }),
      el('span.s-notice-text', {
        text: S.dateDiffNotice(
          formatLong(deviceDate, S.monthNames, S.weekdayNames),
          formatLong(date, S.monthNames, S.weekdayNames),
        ),
      }),
    ]);
  }

  /* States what is actually true: how stale the data is, and that new marks
   * are kept and sent when the connection returns. */
  function syncFailPanel() {
    if (!refreshFailed) return null;
    const at = supporterSync.lastSync();
    const mins = at ? Math.floor((Date.now() - at) / 60000) : null;
    const when = mins == null ? null
      : (mins < 60 ? S.updatedAgo(mins).replace(/^Updated /, '')
        : `${Math.floor(mins / 60)} ${Math.floor(mins / 60) === 1 ? 'hour' : 'hours'} ago`);
    return el('div.s-notice.s-notice-bad', { role: 'alert' }, [
      el('span.s-notice-title', { text: S.syncFailTitle }),
      el('span.s-notice-text', { text: when ? S.syncFailBodyAged(when) : S.syncFailBody }),
      el('button.btn-s.btn-primary.btn-s-xs', {
        type: 'button', text: S.tryAgain, onclick: checkNow,
      }),
    ]);
  }

  // ---- the slot list ------------------------------------------------------

  function medRow(card, medicine) {
    const tone = doseTone(medicine.state);
    const row = paintTone(el('div.s-medrow'), tone);

    row.appendChild(el('button.s-medrow-open', {
      type: 'button',
      onclick: () => openMedicineSheet({
        medicine,
        url: urlFor.get(medicine.medicineId),
        slotName: card.name,
        state: medicine.state,
        onMark: status => setDose(card, medicine, status),
      }),
    }, [
      pillTile({
        id: medicine.medicineId,
        url: urlFor.get(medicine.medicineId),
        form: medicine.form,
        size: 'sm',
        label: false,
      }),
      el('span.s-medrow-main', [
        el('span.s-medrow-name', {
          text: [medicine.name, medicine.strength].filter(Boolean).join(' '),
        }),
        el('span.s-medrow-state', {
          text: [`${tone.glyph} ${tone.label}`, doseText(medicine)].filter(Boolean).join(' · '),
        }),
      ]),
    ]));

    row.appendChild(medicine.state === 'taken'
      ? el('button.btn-s.btn-s-xs', {
        type: 'button', text: S.clearMark, onclick: () => setDose(card, medicine, null),
      })
      : el('button.btn-s.btn-s-xs.btn-primary', {
        type: 'button', text: S.markTaken, onclick: () => setDose(card, medicine, 'taken'),
      }));

    return row;
  }

  function slotRow(card) {
    const open = openSlotId === card.id;
    const node = paintTone(el('div.s-slot'), card.tone);

    node.appendChild(el('button.s-slot-btn', {
      type: 'button',
      'aria-expanded': String(open),
      onclick: () => { openSlotId = open ? null : card.id; draw(); },
    }, [
      el('span.s-ring', { 'aria-hidden': 'true', text: card.tone.glyph }),
      el('span.s-slot-main', [
        el('span.s-slot-name', { text: `${card.name} · ${card.time}` }),
        el('span.s-slot-status', { text: `${card.statusText} · ${card.countText}` }),
      ]),
      el('span.s-slot-chev', { text: open ? S.slotHide : S.slotOpen }),
    ]));

    if (open) {
      node.appendChild(el('div', [
        ...card.medicines.map(m => medRow(card, m)),
        el('div.s-slot-foot', [
          card.resolved
            ? el('button.btn-s', {
              type: 'button', text: S.undoWholeSlot, onclick: () => undoSlot(card),
            })
            : el('button.btn-s.btn-nav-outline', {
              type: 'button', text: S.markWholeSlot, onclick: () => markSlot(card),
            }),
        ]),
      ]));
    }

    return node;
  }

  async function nudge(button) {
    button.disabled = true;
    try {
      const result = await supporter.nudge(code);
      if (result?.retryInMinutes) toast(S.nudgeWait(result.retryInMinutes));
      else if (result?.reason === 'no-subscriptions') toast(S.nudgeNoSubscription);
      else if (!result?.sent) { toast(S.nudgeFailed); button.disabled = false; }
      else toast(S.nudgeSent);
    } catch {
      toast(S.errGeneric);
      button.disabled = false;
    }
    /* Left disabled after any success: nothing about tapping it again in the
     * next few seconds can help, and the server's rate limit should be a
     * backstop rather than something a person meets by accident. */
  }

  // ---- draw ---------------------------------------------------------------

  function draw() {
    const cards = describeDay(day, date);

    const nudgeBtn = el('button.btn-s.btn-nav-outline', { type: 'button', text: S.nudge });
    nudgeBtn.addEventListener('click', () => nudge(nudgeBtn));

    mount(app, screen({
      head: [
        el('div.s-head', [
          el('span.s-head-main', [
            el('span.s-kicker', { text: S.helpingWhom(name) }),
            el('h1.s-title', { text: formatShort(date, S.monthNames, S.weekdayNames) }),
          ]),
          nudgeBtn,
        ]),
        syncBar(),
        deviceDateLine(),
        syncFailPanel(),
        onBehalfActive()
          ? el('div.onbehalf-chip', { text: S.onBehalfChip(name) })
          : null,
      ],
      scroll: cards.length
        ? el('div.s-list', cards.map(slotRow))
        : el('div.s-empty', [
          el('p.s-empty-title', { text: S.dayNothing }),
          el('p.s-empty-body', { text: S.dayNothingBody }),
          el('a.btn-s.btn-primary', { href: '#/medicine', text: S.addMedicine, style: 'align-self: flex-start' }),
        ]),
    }), { keepScroll: true });
  }

  draw();
  return cleanup;
}

/** Re-exported so js/views/day.js can describe a slot the same way. */
export { describeSlot };
