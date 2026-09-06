/* Supporter: the medicine list. Reads live from Supabase via the share code
 * on every visit -- supporter writes already require connectivity, so there
 * is no local cache to keep in sync here. */

import * as store from '../store.js';
import * as supporter from '../supporter.js';
import { S } from '../strings.js';
import * as photos from '../photos.js';
import { el, clear, loadingState, emptyState, confirmDialog, toast, pillTile } from '../ui.js';
import { formatTime } from '../date.js';
import { refresh } from '../router.js';

let showArchived = false;      // kept across renders within a session

/** "Morning 8:00 am · Night 9:00 pm" */
function scheduleSummary(schedules, slots) {
  const slotById = new Map(slots.map(s => [s.id, s]));
  return schedules
    .filter(s => s.active)
    .map(s => {
      const slot = slotById.get(s.slotId);
      const label = slot?.label || '?';
      const time = s.time || slot?.time;
      const every = s.frequency?.type === 'everyNDays'
        ? ` (every ${s.frequency.interval} days)`
        : s.frequency?.type === 'weekly'
          ? ` (${(s.frequency.daysOfWeek || []).map(d => S.weekdayNames[d].slice(0, 3)).join(', ')})`
          : '';
      return `${label} ${time ? formatTime(time) : ''}${every}`.trim();
    })
    .join(' · ');
}

export async function medicinesView({ app }) {
  const settings = await store.getSettings();
  const code = settings.supporterCode;

  // Every object URL in the app is created and released through js/photos.js.
  const tokens = [];
  const cleanup = () => photos.releaseAll(tokens.splice(0));

  clear(app);
  app.appendChild(el('h1.page-title', { text: S.medicinesTitle }));
  const pending = loadingState();
  app.appendChild(pending);

  let routine;
  try {
    routine = await supporter.loadRoutine(code);
  } catch {
    pending.remove();
    app.appendChild(emptyState(S.errGeneric, S.pairCodeInvalid));
    return cleanup;
  }
  pending.remove();

  const { medicines, schedules, slots } = routine;
  const active = medicines.filter(m => !m.archived);
  const archived = medicines.filter(m => m.archived);
  const visible = showArchived ? [...active, ...archived] : active;

  app.appendChild(el('a.btn.btn-primary.btn-block', { href: '#/medicine', text: S.addMedicine }));

  if (!visible.length) {
    app.appendChild(emptyState(S.medicinesEmpty, S.todayNothingSupporter));
  } else {
    /* Photos come from the local cache js/supporter-sync.js fills, not from a
     * signed URL per row -- that would be two round trips per medicine every
     * time this list is opened. A medicine with no photo yet gets the dashed
     * tile, which is the point: on the supporter's own screen a missing photo
     * is a job they can do, so it should be visible rather than absent. */
    const photoRows = await Promise.all(visible.map(m => store.getPhoto(m.id).catch(() => null)));
    const urls = new Map();
    photoRows.forEach((row, i) => {
      if (!row?.blob) return;
      const { url, token } = photos.objectUrl(row.blob);
      tokens.push(token);
      urls.set(visible[i].id, url);
    });

    const rows = el('div.rows', { style: 'margin-top: 1rem;' });
    for (const medicine of visible) {
      const mine = schedules.filter(s => s.medicineId === medicine.id);
      rows.appendChild(el(`a.row-btn${medicine.archived ? '.row-archived' : ''}`, {
        href: `#/medicine?id=${encodeURIComponent(medicine.id)}`,
      }, [
        pillTile({
          id: medicine.id,
          url: urls.get(medicine.id),
          form: medicine.form,
          archived: medicine.archived,
          size: 'sm',
        }),
        el('span.row-main', [
          el('span.row-title', {
            text: [medicine.name, medicine.strength].filter(Boolean).join(' '),
          }),
          medicine.archived ? el('span.badge', { text: S.archived }) : null,
          el('span.row-sub', { text: scheduleSummary(mine, slots) || '—' }),
        ]),
        el('span.row-chev', '›'),
      ]));
    }
    app.appendChild(rows);
  }

  if (archived.length) {
    app.appendChild(el('button.btn-link', {
      type: 'button',
      text: showArchived ? S.hideArchived : `${S.showArchived} (${archived.length})`,
      onclick: () => { showArchived = !showArchived; refresh(); },
    }));
  }

  return cleanup;
}

/** Archive from inside the form. Exported so the form can reuse the wording. */
export async function archiveMedicine(code, medicine) {
  const ok = await confirmDialog({
    title: S.archive,
    body: S.archiveConfirm(medicine.name),
    confirmLabel: S.archive,
    danger: true,
  });
  if (!ok) return false;
  await supporter.setArchived(code, medicine.id, true);
  toast(S.archived);
  return true;
}
