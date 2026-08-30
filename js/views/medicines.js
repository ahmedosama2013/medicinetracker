/* Supporter: the medicine list. */

import * as store from '../store.js';
import { S } from '../strings.js';
import { el, clear, emptyState, confirmDialog, toast } from '../ui.js';
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
  const [medicines, schedules, slots] = await Promise.all([
    store.getMedicines(), store.getSchedules(), store.getSlots(),
  ]);

  clear(app);
  app.appendChild(el('h1.page-title', { text: S.medicinesTitle }));

  const active = medicines.filter(m => !m.archived);
  const archived = medicines.filter(m => m.archived);
  const visible = showArchived ? [...active, ...archived] : active;

  app.appendChild(el('a.btn.btn-primary.btn-block', { href: '#/medicine', text: S.addMedicine }));

  if (!visible.length) {
    app.appendChild(emptyState(S.medicinesEmpty, S.todayNothingSupporter));
  } else {
    const rows = el('div.rows', { style: 'margin-top: 1rem;' });
    for (const medicine of visible) {
      const mine = schedules.filter(s => s.medicineId === medicine.id);
      rows.appendChild(el(`a.row-btn${medicine.archived ? '.row-archived' : ''}`, {
        href: `#/medicine?id=${encodeURIComponent(medicine.id)}`,
      }, [
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
}

/** Archive from inside the form. Exported so the form can reuse the wording. */
export async function archiveMedicine(medicine) {
  const ok = await confirmDialog({
    title: S.archive,
    body: S.archiveConfirm(medicine.name),
    confirmLabel: S.archive,
    danger: true,
  });
  if (!ok) return false;
  await store.setArchived(medicine.id, true);
  toast(S.archived);
  return true;
}
