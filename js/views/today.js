/* Today. For the person taking the medicines this is the entire app.
 *
 * The redesign's central claim: MARKING A DOSE IS ONE TAP FROM HERE. You no
 * longer open a slot first. Each time-of-day card carries a single full-width
 * button stating the plain current fact -- "You have not taken these yet",
 * flipping in place to "You have already taken these" -- and reversing it is
 * never behind a confirm dialog. "See the pills" sits beneath it as an
 * underlined text link — a link, not a second button, because two
 * equal-weight buttons per card made the screen feel busy.
 *
 * Three more things are deliberate and easy to undo by accident:
 *
 * 1. CARDS ARE NATURAL HEIGHT. They do not stretch to fill the screen.
 *    Stretching made the day read as blocks rather than as things to do. Two
 *    slots fit a phone with margin above the first; a third scrolls, and that
 *    is fine.
 * 2. THE STATE READS AT A DISTANCE. The card header is a solid band in the
 *    slot's state colour with white text, and the border matches. Colour is
 *    never alone: there is a ringed glyph and a word beside it.
 * 3. NO PHOTOS HERE. Today answers "what do I take now?"; recognising a pill
 *    is the slot detail's job. Keeping them off this screen is also what makes
 *    it render without touching the photo store.
 *
 * The helper's Today is a different shape entirely and lives in
 * ./today-supporter.js, loaded only on the branch that needs it.
 */

import * as store from '../store.js';
import { S } from '../strings.js';
import {
  el, mount, screen, paintTone, stateRing, codeCard, toast, TONE, openSheet,
} from '../ui.js';
import { loadDay, describeDay, describeSlot, doseKey } from '../day-model.js';
import { doses, mayMarkSlot, settled } from '../marking.js';
import { todayStr, addDays, formatLong, isAfter } from '../date.js';
import { refresh } from '../router.js';

export async function todayView({ app, isCurrent = () => true }) {
  const settings = await store.getSettings();
  if (!isCurrent()) return;

  if (settings.role === 'supporter') {
    /* Loaded on the branch that needs it. The elder never downloads the
     * helper's Today, and vice versa. */
    const mod = await import('./today-supporter.js');
    if (!isCurrent()) return;
    return mod.supporterTodayView({ app, isCurrent, settings });
  }

  return elderToday({ app, isCurrent, settings });
}

// ---------------------------------------------------------------------------

/* auth.js reaches the full Supabase client and this screen is the elder's
 * cold start, so it is imported lazily rather than at the top. */
const authLib = () => import('../auth.js');

async function elderToday({ app, isCurrent, settings }) {
  const date = todayStr();

  let day = null;                        // { groups, states, loggedBy }
  let offline = !navigator.onLine;
  let firstName = null;
  const nodeBySlot = new Map();
  let bannerHost = null;
  let welcomeHost = null;

  const cleanups = [];
  const cleanup = () => { for (const fn of cleanups.splice(0)) fn(); };

  // ---- the offline banner -------------------------------------------------

  /* One sentence, one line, never a paragraph — and nothing on the screen is
   * disabled by it. Taps are queued locally either way; the banner exists so
   * the person is never left wondering whether their tap counted.
   *
   * Only for the one fact worth interrupting for: there is no connection.
   * Marking is otherwise silent while it works -- no "saving" state of its
   * own -- and only speaks up with a toast if a write actually fails. */
  function banner() {
    if (!offline) return null;
    return el('div.offline-banner', { role: 'status' }, [
      el('span.banner-glyph', { 'aria-hidden': 'true', text: '!' }),
      el('span.banner-text', { text: S.offlineBanner }),
    ]);
  }

  function paintBanner() {
    if (!bannerHost?.isConnected) return;
    bannerHost.replaceChildren();
    const node = banner();
    if (node) bannerHost.appendChild(node);
  }

  // ---- the slot card ------------------------------------------------------

  function restore(snapshot) {
    day.states.clear();
    for (const [k, v] of snapshot) day.states.set(k, v);
  }

  function refreshCard(slotId) {
    /* Read the live node BEFORE building: buildCard registers the node it
     * creates, so asking afterwards hands back the new detached one and
     * replaceWith quietly becomes a no-op. */
    const previous = nodeBySlot.get(slotId);
    const group = day.groups.find(g => g.slotId === slotId);
    if (!group) { refresh(); return; }
    const next = buildCard(describeSlot(group, day.states, date));

    /* The whole day has been swapped out from under us — something
     * re-rendered while this write was in flight, which is easy during a
     * confirmation dialog. replaceWith would write into a detached tree and
     * silently do nothing, which looks exactly like the tap being ignored. */
    if (!previous?.isConnected) { refresh(); return; }
    previous.replaceWith(next);
    return next;
  }

  async function markAll(card) {
    if (!await mayMarkSlot(settings, { slotName: card.name, count: card.total })) return;

    const before = new Map(day.states);
    /* Only what is still unmarked. store.logSlot filters out medicines that
     * already have a row, so something deliberately left out today survives a
     * later "I have taken these" — the person said something about that
     * medicine and this button must not overrule it. */
    for (const m of card.medicines) {
      if (!m.state) day.states.set(doseKey(card.id, m.medicineId), 'taken');
    }
    refreshCard(card.id);

    try {
      await settled(card.medicines.map(m => doseKey(card.id, m.medicineId)));
      await doses.logSlot(settings, date, card.id, card.medicines.map(m => m.medicineId));
    } catch {
      restore(before);
      refreshCard(card.id);
      toast(S.errGeneric);
      return;
    }
  }

  async function undoAll(card) {
    const before = new Map(day.states);
    for (const m of card.medicines) day.states.delete(doseKey(card.id, m.medicineId));
    refreshCard(card.id);

    try {
      /* A per-medicine write may still be in flight. Undo deletes the whole
       * slot server-side, and a log landing after that delete would resurrect
       * the row the person just cleared. */
      await settled(card.medicines.map(m => doseKey(card.id, m.medicineId)));
      await doses.undoSlot(settings, date, card.id);
    } catch {
      restore(before);
      refreshCard(card.id);
      toast(S.errGeneric);
      return;
    }
  }

  function buildCard(card) {
    /* Only two colours here, not the three the shared selector can produce:
     * "not due yet" and "due and not taken" both read as the same plain fact
     * on this screen -- taken or not -- so both get the same red. Green is
     * reserved for resolved. The supporter's Today and the calendar day view
     * still use the shared tone as-is; this override is local to this card. */
    const tone = card.resolved ? TONE.done : TONE.late;
    const node = paintTone(el(`div.slot.${tone.cls}`), tone);
    nodeBySlot.set(card.id, node);

    /* The solid band is what makes the state legible across the room. Both
     * halves are nowrap: a slot called "Before breakfast" ellipses rather than
     * pushing its time onto a second line. */
    node.appendChild(el('div.slot-head', [
      el('span.slot-name', { text: card.name }),
      el('span.slot-time', { text: card.time }),
    ]));

    node.appendChild(el('div.slot-body', [
      el('span.slot-meds', { text: card.medNames, title: card.medNames }),
      el('span.slot-status', [
        stateRing(tone),
        el('span.slot-status-text', { text: card.statusText }),
      ]),
    ]));

    /* One real button. When everything in the slot is already marked it
     * becomes Undo, in the same place — undo is always one tap away where the
     * mark was made, never behind a confirm. */
    node.appendChild(el('div.slot-actions', [
      card.resolved
        ? el('button.slot-undo', {
          type: 'button', text: card.undoLabel, onclick: () => undoAll(card),
        })
        : el('button.slot-take', {
          type: 'button', text: card.takeLabel, onclick: () => markAll(card),
        }),
      el('a.btn-link.slot-see', {
        href: `#/slot?id=${encodeURIComponent(card.id)}`,
        text: S.seeThePills,
      }),
    ]));

    return node;
  }

  // ---- "See yesterday" -----------------------------------------------------

  /* Yesterday almost always falls inside the household's correction window --
   * lockedThrough trails today by lock_lag_days (2, by default) -- so this is
   * "editable" far more often than not. When it genuinely is not (a household
   * that has set its lag to 0 or 1), the day is a record: readable and still
   * openable per medicine, same as js/views/day.js does for the helper's
   * calendar, just never markable. */
  const yesterday = addDays(date, -1);
  const yesterdayEditable = !isAfter(yesterday, todayStr())
    && (!settings.lockedThrough || isAfter(yesterday, settings.lockedThrough));

  async function markAllYesterday(yDay, card, redraw) {
    if (!await mayMarkSlot(settings, { slotName: card.name, count: card.total })) return;
    const before = new Map(yDay.states);
    for (const m of card.medicines) {
      if (!m.state) yDay.states.set(doseKey(card.id, m.medicineId), 'taken');
    }
    redraw();
    try {
      await settled(card.medicines.map(m => doseKey(card.id, m.medicineId)));
      await doses.logSlot(settings, yesterday, card.id, card.medicines.map(m => m.medicineId));
    } catch {
      yDay.states.clear();
      for (const [k, v] of before) yDay.states.set(k, v);
      redraw();
      toast(S.errGeneric);
    }
  }

  async function undoAllYesterday(yDay, card, redraw) {
    const before = new Map(yDay.states);
    for (const m of card.medicines) yDay.states.delete(doseKey(card.id, m.medicineId));
    redraw();
    try {
      await settled(card.medicines.map(m => doseKey(card.id, m.medicineId)));
      await doses.undoSlot(settings, yesterday, card.id);
    } catch {
      yDay.states.clear();
      for (const [k, v] of before) yDay.states.set(k, v);
      redraw();
      toast(S.errGeneric);
    }
  }

  /* Echoes buildCard's head and body -- same card, same tones, so yesterday
   * reads as a page out of the same book as today. Two differences:
   *
   * - Its tone is describeSlot's own, unmodified. buildCard collapses "not
   *   yet due" and "overdue" into the same red because both are still live
   *   problems on TODAY's screen; a past day has neither -- same reasoning
   *   js/views/day.js already uses for the helper's calendar.
   * - The action is full-slot take/undo when the day is still editable, and
   *   always a "See the pills" link through to the same per-medicine screen
   *   Today uses (js/views/slot.js, opened here on yesterday's date) -- so
   *   correcting a mark, or just looking at a pill, never needs a second
   *   vocabulary from what Today already taught.
   */
  function yesterdayCard(yDay, card, redraw) {
    const node = paintTone(el(`div.slot.${card.tone.cls}`), card.tone);

    node.appendChild(el('div.slot-head', [
      el('span.slot-name', { text: card.name }),
      el('span.slot-time', { text: card.time }),
    ]));

    node.appendChild(el('div.slot-body', [
      el('span.slot-meds', { text: card.medNames, title: card.medNames }),
      el('span.slot-status', [
        stateRing(card.tone),
        el('span.slot-status-text', { text: card.statusText }),
      ]),
    ]));

    node.appendChild(el('div.slot-actions', [
      yesterdayEditable
        ? (card.resolved
          ? el('button.slot-undo', {
            type: 'button', text: card.undoLabel,
            onclick: () => undoAllYesterday(yDay, card, redraw),
          })
          : el('button.slot-take', {
            type: 'button', text: card.takeLabel,
            onclick: () => markAllYesterday(yDay, card, redraw),
          }))
        : null,
      el('a.btn-link.slot-see', {
        href: `#/slot?id=${encodeURIComponent(card.id)}&date=${encodeURIComponent(yesterday)}`,
        text: S.seeThePills,
      }),
    ]));

    return node;
  }

  async function openYesterday() {
    const yDay = await loadDay(yesterday);

    function content() {
      const cards = describeDay(yDay, yesterday);
      return cards.length
        ? cards.map(card => yesterdayCard(yDay, card, redraw))
        : el('p.scard-note', { text: S.yesterdayEmpty });
    }

    // Declared before use below, but not assigned until openSheet returns --
    // redraw is only ever called from a tap, which cannot happen before this
    // function itself has returned, so the sheet always exists by then.
    let sheet;
    const redraw = () => sheet.setContent(content());

    sheet = openSheet({
      eyebrow: S.yesterdayEyebrow,
      title: formatLong(yesterday, S.monthNames, S.weekdayNames),
      content: content(),
    });
  }

  function foot() {
    return el('div.today-yesterday-foot', [
      el('button.btn.btn-outline.btn-block', {
        type: 'button', text: S.yesterdayButton, onclick: openYesterday,
      }),
    ]);
  }

  // ---- the screen ---------------------------------------------------------

  function head() {
    bannerHost = el('div');
    const node = banner();
    if (node) bannerHost.appendChild(node);
    welcomeHost = el('div.day-welcome', { text: S.welcomeElder(firstName) });
    return [
      welcomeHost,
      el('div.day-head', [
        el('span.day-date', { text: formatLong(date, S.monthNames, S.weekdayNames) }),
        el('span.day-flag', { text: S.todayFlag }),
      ]),
      bannerHost,
    ];
  }

  function paintWelcome() {
    if (!welcomeHost?.isConnected) return;
    welcomeHost.textContent = S.welcomeElder(firstName);
  }

  function loadingScreen() {
    return screen({
      head: head(),
      scroll: el('div.today-loading', { role: 'status', 'aria-busy': 'true' }, [
        el('span.today-loading-label', { text: S.loadingToday }),
        el('span.skeleton', { 'aria-hidden': 'true' }),
        el('span.skeleton.skeleton-2', { 'aria-hidden': 'true' }),
        el('span.skeleton.skeleton-3', { 'aria-hidden': 'true' }),
      ]),
    });
  }

  /* The elder's cold start. Setup ends at sign-in, and until a helper has
   * added something there is nothing this screen can show — so instead of
   * describing the emptiness it carries the next step: their code, at a size
   * that can be read out over a phone call. */
  /* Realtime is supposed to make this unnecessary -- the moment the helper
   * saves a medicine, this screen should redraw itself. In practice a phone
   * that was asleep or had lost its socket missed that event and sat on this
   * screen indefinitely, with no way off it except leaving the app and coming
   * back. One button, doing the same full refetch Realtime would have
   * triggered, closes that gap without the person needing to know any of
   * this happened. */
  async function checkForMedicines(button) {
    button.disabled = true;
    const label = button.textContent;
    button.textContent = S.emptyCheckChecking;

    if (settings.householdId) {
      try {
        const sync = await import('../sync.js');
        await sync.refetchRoutine(settings.householdId);
      } catch {
        // Best effort: fall through and check the cache regardless -- Realtime
        // may already have delivered what this refetch just failed to.
      }
    }
    if (!isCurrent()) return;

    const medicines = await store.getActiveMedicines();
    if (!isCurrent()) return;

    if (!medicines.length) {
      button.disabled = false;
      button.textContent = label;
      toast(S.emptyCheckNoneYet);
      return;
    }

    day = await loadDay(date);
    if (!isCurrent()) return;
    const cards = describeDay(day, date);
    mount(app, cards.length ? listScreen(cards) : nothingDueScreen());
  }

  function emptyScreen() {
    const checkBtn = el('button.btn.btn-dashed-amber', { type: 'button', text: S.emptyCheckButton });
    checkBtn.addEventListener('click', () => checkForMedicines(checkBtn));

    return screen({
      head: head(),
      scroll: el('div.coldstart', [
        el('div.explain-card', [
          el('span.explain-title', { text: S.emptyTitle }),
          el('span.explain-body', { text: S.emptyBody }),
        ]),
        settings.shareCode ? codeCard(settings.shareCode, { label: S.yourCode }) : null,
        checkBtn,
      ]),
    });
  }

  function nothingDueScreen() {
    return screen({
      head: head(),
      body: el('div.nothing-due', [
        el('span.nothing-due-mark', { 'aria-hidden': 'true', text: '✓' }),
        el('span.nothing-due-title', { text: S.noneDueTitle }),
        el('span.nothing-due-body', { text: S.noneDueBody }),
      ]),
      foot: foot(),
    });
  }

  function listScreen(cards) {
    nodeBySlot.clear();
    return screen({
      head: head(),
      scroll: el('div.slot-list', cards.map(buildCard)),
      foot: foot(),
    });
  }

  // ---- draw ---------------------------------------------------------------

  mount(app, loadingScreen());

  const medicines = await store.getActiveMedicines();
  if (!isCurrent()) return cleanup;

  if (!medicines.length) {
    mount(app, emptyScreen());
  } else {
    day = await loadDay(date);
    if (!isCurrent()) return cleanup;
    const cards = describeDay(day, date);
    mount(app, cards.length ? listScreen(cards) : nothingDueScreen());
  }

  // ---- offline / queued taps ---------------------------------------------

  const onOnline = () => { offline = false; paintBanner(); };
  const onOffline = () => { offline = true; paintBanner(); };
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  cleanups.push(() => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  });

  /* The name is cosmetic, not gating: the day above never waits on it, and a
   * failed/slow lookup just leaves the generic "Welcome!" in place. */
  authLib()
    .then(async auth => auth.firstNameFromSession(await auth.getSession()))
    .then(name => {
      if (!isCurrent()) return;
      firstName = name;
      paintWelcome();
    })
    .catch(() => {});

  return cleanup;
}
