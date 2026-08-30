/* Every user-visible string in the app.
 *
 * One file so Urdu can be added later without hunting through views: the plan
 * is a second object of the same shape and a language setting. Nothing else in
 * the codebase should contain display text.
 */

export const APP_VERSION = '1.0.0';

export const S = {
  appName: 'Medicine Tracker',

  // ---- onboarding -------------------------------------------------------
  welcomeTitle: 'Who uses this phone?',
  welcomeIntro: 'This only needs answering once.',
  roleSimple: 'I take the medicines',
  roleSimpleHint: 'A simple screen showing what to take today.',
  roleSupporter: 'I help someone with their medicines',
  roleSupporterHint: 'Add medicines, photos and times, then send them across.',
  roleChangeLater: 'You can change this later in Settings.',

  // ---- navigation -------------------------------------------------------
  navToday: 'Today',
  navCalendar: 'Calendar',
  navSettings: 'Settings',
  navMedicines: 'Medicines',

  // ---- today ------------------------------------------------------------
  todayNothing: 'No medicines yet',
  todayNothingSimple: 'Ask your helper to send you your medicine list.',
  todayNothingSupporter: 'Add a medicine to get started.',
  done: 'Done',
  undo: 'Undo',
  allTaken: 'All taken',
  noPhoto: 'No photo',
  // Shown once at the top of the day rather than on every card: with six
  // medicines in a slot, six copies of the same hint is noise.
  tapForPhoto: 'Tap a medicine to see its photo.',
  closePhoto: 'Close',

  // ---- calendar ---------------------------------------------------------
  calendarTitle: 'Calendar',
  monthPickerTitle: 'Go to month',
  today: 'Today',
  notYet: 'Not yet',
  notYetBody: 'This day has not arrived. You can mark medicines on the day itself.',
  lockedDay: 'Locked',
  lockedBody: 'This day is from before your last update, so it is kept as a record and cannot be changed.',
  dayNothing: 'No medicines were due on this day.',
  ofDoses: (taken, expected) => `${taken} of ${expected} taken`,
  weekdayShort: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
  monthNames: ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'],

  // ---- medicines (supporter) -------------------------------------------
  medicinesTitle: 'Medicines',
  addMedicine: 'Add a medicine',
  editMedicine: 'Edit medicine',
  newMedicine: 'New medicine',
  showArchived: 'Show archived',
  hideArchived: 'Hide archived',
  archived: 'Archived',
  archive: 'Archive',
  unarchive: 'Restore',
  archiveConfirm: name =>
    `Archive ${name}? It stops appearing on the Today screen. The record of doses already taken is kept.`,
  medicinesEmpty: 'No medicines yet.',

  // ---- medicine form ---------------------------------------------------
  fieldName: 'Name',
  fieldNamePlaceholder: 'e.g. Augmentin 625',
  fieldStrength: 'Strength',
  fieldStrengthPlaceholder: 'e.g. 625 mg',
  fieldDosage: 'How much to take',
  fieldDosagePlaceholder: 'e.g. 1 tablet',
  fieldForm: 'Form',
  fieldNotes: 'Notes',
  fieldNotesPlaceholder: 'e.g. take with food',
  fieldPhoto: 'Photo',
  takePhoto: 'Take a photo',
  retakePhoto: 'Change photo',
  removePhoto: 'Remove photo',
  photoOptional: 'Optional, but it is what makes the pills easy to identify.',
  forms: {
    tablet: 'Tablet', capsule: 'Capsule', liquid: 'Liquid', drops: 'Drops',
    injection: 'Injection', inhaler: 'Inhaler', other: 'Other',
  },

  schedulesHeading: 'When to take it',
  addSchedule: 'Add a time',
  removeSchedule: 'Remove',
  scheduleSlot: 'Time of day',
  scheduleTime: 'At',
  scheduleTimeDefault: slotTime => `Slot default (${slotTime})`,
  scheduleFrequency: 'How often',
  freqDaily: 'Every day',
  freqEveryNDays: 'Every few days',
  freqWeekly: 'Certain days of the week',
  freqInterval: 'Every',
  freqIntervalUnit: 'days',
  freqAnchor: 'Starting from',
  freqDaysOfWeek: 'On these days',
  weekdayNames: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],

  save: 'Save',
  cancel: 'Cancel',
  back: 'Back',
  close: 'Close',
  delete: 'Delete',
  confirm: 'Confirm',

  errNameRequired: 'Give the medicine a name.',
  errDosageRequired: 'Say how much to take, for example "1 tablet".',
  errNoSchedule: 'Add at least one time. A medicine with no time set would never appear on the Today screen.',
  errAnchorRequired: 'Choose the date to count from.',
  errDaysRequired: 'Pick at least one day of the week.',
  errPhotoFailed: 'That photo could not be read. Try taking it again.',
  savedMedicine: 'Saved',

  // ---- slots -----------------------------------------------------------
  slotsTitle: 'Times of day',
  slotsIntro: 'These are the default times. A single medicine can be given its own time.',
  slotLabel: 'Name',
  slotTime: 'Time',
  addSlot: 'Add a time of day',
  removeSlot: 'Remove',
  slotRemoveConfirm: (label, n) => n === 0
    ? `Remove ${label}?`
    : `Remove ${label}? ${n} medicine ${n === 1 ? 'time' : 'times'} using it will stop appearing. The record of doses already taken is kept.`,
  slotDefaults: {
    morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening', night: 'Night',
  },
  errSlotLabel: 'Give this time of day a name.',
  errSlotTime: 'Set a time.',

  // ---- settings --------------------------------------------------------
  settingsTitle: 'Settings',
  settingsImportSimple: 'Get my medicines from my helper',
  settingsImportSimpleHint: 'Pick the file your helper sent you.',
  settingsExportSimple: 'Save a copy of my information',
  settingsExportSimpleHint: 'Keep this file somewhere safe. It can restore everything.',
  settingsExportSupporter: 'Send medicines to the person I help',
  settingsExportSupporterHint: 'Makes one file. Send it over WhatsApp or email.',
  settingsImportSupporter: 'Restore from a backup file',
  settingsImportSupporterHint: 'Use this to move to a new phone.',
  settingsSlots: 'Times of day',
  settingsMode: 'Change who uses this phone',
  settingsModeNow: role => role === 'simple'
    ? 'Now set to: I take the medicines'
    : 'Now set to: I help someone with their medicines',
  settingsVersion: 'App version',
  settingsStorage: 'Storage',
  storagePersisted: 'This phone has been asked to keep your data safely.',
  storageNotPersisted: 'Keep a saved copy of your information, just in case.',
  noRemindersTitle: 'There are no reminders yet',
  noRemindersBody: 'This app does not send notifications. Open it when you take your medicines, or set an alarm in the Clock app.',

  // ---- export / import -------------------------------------------------
  exportDone: 'File saved',
  exportBig: 'That file is large. It may be too big to send over email.',
  exportEmpty: 'There is nothing to send yet. Add a medicine first.',

  importPick: 'Choose file',
  importTitleSimple: 'New medicine list from your helper',
  importTitleSupporter: 'Restore from this file',
  importKeepsHistory: 'Your record of what you have taken will be kept.',
  importCounts: c => {
    const parts = [];
    if (c.added) parts.push(`${c.added} new ${c.added === 1 ? 'medicine' : 'medicines'}`);
    if (c.changed) parts.push(`${c.changed} changed`);
    if (c.removed) parts.push(`${c.removed} removed`);
    if (c.unchanged && !parts.length) parts.push('nothing changed');
    return parts.join(' · ');
  },
  importAccept: 'Use the new list',
  importReject: 'Keep what I have',
  importDone: 'Your medicines are up to date',
  errImportShape: 'This file does not look like a medicine list.',
  errImportVersion: 'Your app needs updating. Open it while connected to the internet, then try again.',
  errImportSlots: 'This file is incomplete: a medicine is set to a time of day that the file does not describe. Ask your helper to send it again.',
  errImportRead: 'That file could not be read.',

  // ---- misc ------------------------------------------------------------
  loading: 'Loading',
  errGeneric: 'Something went wrong.',
};
