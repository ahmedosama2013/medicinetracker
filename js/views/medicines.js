/* Helper: the medicine list. The inventory — what exists, what state its
 * photos are in, and what has been retired.
 *
 * Reads live from Supabase via the share code on every visit: helper writes
 * already require connectivity, so there is no local cache to keep in sync
 * here. The PHOTOS, though, come from the local cache js/supporter-sync.js
 * fills rather than a signed URL per row — that would be two round trips per
 * medicine, every time this screen is opened.
 *
 * A medicine with no photo shows the hatch placeholder rather than a generic
 * icon, and the row says so in words. On the helper's own screen a missing
 * photo is a job they can do, so it should be visible rather than absent.
 */

import * as store from '../store.js';
import * as supporter from '../supporter.js';
import { S } from '../strings.js';
import * as photos from '../photos.js';
import {
  el, mount, screen, loadingState, confirmDialog, toast, pillTile,
} from '../ui.js';
import { formatTime } from '../date.js';
import { refresh } from '../router.js';

let showArchived = false;      // kept across renders within a session

/** "Every day · Morning 8:00 am · Bedtime 9:30 pm" */
function scheduleSummary(schedules, slots) {
  const slotById = new Map(slots.map(s => [s.id, s]));
  return schedules
    .filter(s => s.active)
    .map(s => {
      const slot = slotById.get(s.slotId);
      const label = slot?.label || '?';
      const time = s.time || slot?.time;
      const every = s.frequency?.type === 'everyNDays'
        ? ` (${S.freqInterval.toLowerCase()} ${s.frequency.interval} ${S.freqIntervalUnit})`
        : s.frequency?.type === 'weekly'
          ? ` (${(s.frequency.daysOfWeek || []).map(d => S.weekdayShort3[d]).join(', ')})`
          : '';
      return `${label} ${time ? formatTime(time) : ''}${every}`.trim();
    })
    .join(' · ');
}

function photoStateLabel(hasPill, hasPacket) {
  if (hasPill && hasPacket) return S.photoStateBoth;
  if (hasPill) return S.photoStatePill;
  if (hasPacket) return S.photoStatePacket;
  return S.photoStateNone;
}

export async function medicinesView({ app, isCurrent = () => true }) {
  const settings = await store.getSettings();
  const code = settings.supporterCode;

  // Every object URL in the app is created and released through js/photos.js.
  const tokens = [];
  const cleanup = () => photos.releaseAll(tokens.splice(0));

  const shell = body => screen({
    head: el('div.s-head', [
      el('span.s-head-main', [el('h1.s-title', { text: S.medicinesTitle })]),
      el('a.btn-s.btn-primary', { href: '#/medicine', text: S.addMedicine }),
    ]),
    scroll: body,
  });

  mount(app, shell(el('div.s-loading', [
    el('span.s-loading-label', { text: S.medsLoading }),
    el('span.s-skeleton', { 'aria-hidden': 'true', style: 'height: 68px' }),
    el('span.s-skeleton', { 'aria-hidden': 'true', style: 'height: 68px' }),
  ])));

  let routine;
  try {
    routine = await supporter.loadRoutine(code);
  } catch {
    if (!isCurrent()) return cleanup;
    mount(app, shell(el('div.s-empty', [
      el('p.s-empty-title', { text: S.errGeneric }),
      el('p.s-empty-body', { text: S.pairConnectionError }),
    ])));
    return cleanup;
  }
  if (!isCurrent()) return cleanup;

  const { medicines, schedules, slots } = routine;
  const active = medicines.filter(m => !m.archived);
  const archived = medicines.filter(m => m.archived);

  if (!active.length && !archived.length) {
    mount(app, shell(el('div.s-empty', [
      el('p.s-empty-title', { text: S.medicinesEmpty }),
      el('p.s-empty-body', { text: S.medicinesEmptyBody }),
      el('a.btn-s.btn-primary', {
        href: '#/medicine', text: S.addFirstMedicine,
        style: 'align-self: flex-start; min-height: 46px; padding: 10px 18px; font-size: 15px',
      }),
    ])));
    return cleanup;
  }

  /* Two rows for the same medicine at the same strength is almost always one
   * medicine entered twice, so they are folded into a single row whose link
   * carries every id — the form then edits all of their schedules together. */
  const groups = [];
  const groupByKey = new Map();
  const sorted = [...active].sort((a, b) => {
    const byName = (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
    return byName || (a.strength || '').localeCompare(b.strength || '', undefined, { sensitivity: 'base' });
  });
  for (const medicine of sorted) {
    const key = `${(medicine.name || '').trim().toLowerCase()}|${(medicine.strength || '').trim().toLowerCase()}`;
    let group = groupByKey.get(key);
    if (!group) {
      group = { medicine, ids: [], schedules: [] };
      groupByKey.set(key, group);
      groups.push(group);
    }
    group.ids.push(medicine.id);
    group.schedules.push(...schedules.filter(s => s.medicineId === medicine.id));
  }

  const photoRows = await Promise.all(groups.map(g => store.getPhoto(g.medicine.id).catch(() => null)));
  if (!isCurrent()) return cleanup;
  const urls = new Map();
  photoRows.forEach((row, i) => {
    if (!row?.blob) return;
    const { url, token } = photos.objectUrl(row.blob);
    tokens.push(token);
    urls.set(groups[i].medicine.id, url);
  });

  function row(group) {
    const medicine = group.medicine;
    const title = [medicine.name, medicine.strength].filter(Boolean).join(' ');
    const href = `#/medicine?id=${encodeURIComponent(medicine.id)}&ids=${group.ids.map(encodeURIComponent).join(',')}`;

    return el('div.s-med', [
      pillTile({
        id: medicine.id,
        url: urls.get(medicine.id),
        form: medicine.form,
        alt: title,
        size: 'sm',
        label: false,
      }),
      el('a.s-med-open', { href }, [
        el('span.s-med-name', { text: title }),
        el('span.s-med-sched', { text: scheduleSummary(group.schedules, slots) || '—' }),
        el('span.s-med-photo', {
          text: photoStateLabel(!!medicine.photoPath, !!medicine.packetPhotoPath),
        }),
      ]),
      el('button.btn-s.btn-s-xs', {
        type: 'button',
        text: S.archive,
        onclick: async () => {
          if (await archiveMedicine(code, medicine)) refresh();
        },
      }),
    ]);
  }

  mount(app, shell(el('div.s-list', [
    ...groups.map(row),

    archived.length ? el('button.btn-s', {
      type: 'button',
      text: showArchived ? S.hideArchived : `${S.showArchived} (${archived.length})`,
      style: 'align-self: flex-start; border: none; background: none; color: var(--navy); text-decoration: underline; padding: 8px 12px; font-size: 14px',
      onclick: () => { showArchived = !showArchived; refresh(); },
    }) : null,

    showArchived && archived.length
      ? el('div', { style: 'display: flex; flex-direction: column; gap: 8px' }, [
        ...archived.map(medicine => el('div.s-med.s-med-archived', [
          el('span.s-med-open', { style: 'cursor: default' }, [
            el('span.s-med-name', {
              text: [medicine.name, medicine.strength].filter(Boolean).join(' '),
            }),
            el('span.s-med-photo', { text: S.archived }),
          ]),
          el('button.btn-s.btn-s-xs.btn-nav-outline', {
            type: 'button',
            text: S.unarchive,
            onclick: async () => {
              try {
                await supporter.setArchived(code, medicine.id, false);
                toast(S.restoredToast(medicine.name));
                refresh();
              } catch {
                toast(S.errGeneric);
              }
            },
          }),
        ])),
        el('span.s-archived-note', { text: S.archivedNote }),
      ])
      : null,
  ])));

  return cleanup;
}

/**
 * Archive, from the list or from inside the form.
 *
 * Names the consequence — it leaves Today and the pill box, the past record
 * stays, and it can be restored — and names both actions: "Archive" / "Keep
 * it". Never "OK / Cancel".
 */
export async function archiveMedicine(code, medicine) {
  const ok = await confirmDialog({
    title: S.archiveTitle(medicine.name),
    body: S.archiveBody,
    confirmLabel: S.archive,
    cancelLabel: S.archiveKeep,
    danger: true,
  });
  if (!ok) return false;
  try {
    await supporter.setArchived(code, medicine.id, true);
  } catch {
    toast(S.errGeneric);
    return false;
  }
  toast(S.archivedToast(medicine.name));
  return true;
}
