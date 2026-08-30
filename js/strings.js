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
  roleSupporterHint: 'Add medicines, photos and times. They sync automatically.',
  roleChangeLater: 'You can change this later in Settings.',

  // ---- sign in (simple) --------------------------------------------------
  signInTitle: 'Sign in',
  signInIntro: 'One tap, no password to remember.',
  signInGoogle: 'Sign in with Google',

  // ---- pairing (supporter) -----------------------------------------------
  pairTitle: 'Enter the code',
  pairIntro: 'Ask the person you are helping for their code, from their Settings screen.',
  pairCodeLabel: 'Code',
  pairCodeRequired: 'Enter the code first.',
  pairCodeInvalid: 'That code is not valid. Check it and try again.',
  pairConnect: 'Connect',

  // ---- navigation -------------------------------------------------------
  navToday: 'Today',
  navCalendar: 'Calendar',
  navSettings: 'Settings',
  navMedicines: 'Medicines',

  // ---- today ------------------------------------------------------------
  todayNothing: 'No medicines yet',
  todayNothingSimple: 'Ask your helper to add your medicines. They will appear here as soon as they do.',
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
  errSlotLabel: 'Give this time of day a name.',

  // ---- settings --------------------------------------------------------
  settingsTitle: 'Settings',
  settingsSlots: 'Times of day',
  settingsVersion: 'App version',
  settingsStorage: 'Storage',
  storagePersisted: 'This phone has been asked to keep your data safely.',
  storageNotPersisted: 'Keep a saved copy of your information, just in case.',

  settingsAccount: 'Account',
  settingsSignedInAs: 'Signed in as',
  settingsShareCode: 'Your code',
  settingsShareCodeHint: 'Share this with anyone helping you, so they can add and update your medicines.',
  settingsRotateCode: 'Get a new code',
  settingsRotateCodeHint: 'Anyone using the old code loses access.',
  settingsRotateCodeConfirm: 'Anyone using your current code will no longer be able to update your medicines. Continue?',
  settingsRotateCodeDone: 'New code ready',
  settingsSignOut: 'Sign out',
  settingsSignOutConfirm: 'You can sign back in with the same Google account any time.',

  settingsConnection: 'Connection',
  settingsConnectedTo: 'Connected to',
  settingsDisconnect: 'Disconnect this device',
  settingsDisconnectHint: 'You can reconnect any time with the code.',
  settingsDisconnectConfirm: 'This device will stop being able to update this household’s medicines until reconnected with a code.',

  settingsNotifications: 'Reminders',
  notificationsHint: 'A gentle reminder when it is time for medicines that have not been marked done.',
  notificationsOffLabel: 'Reminders are off',
  notificationsOnLabel: 'Reminders are on',
  notificationsTurnOn: 'Turn on',
  notificationsTurnOff: 'Turn off',

  // ---- misc ------------------------------------------------------------
  loading: 'Loading',
  errGeneric: 'Something went wrong.',
};
