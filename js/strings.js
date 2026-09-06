/* Every user-visible string in the app.
 *
 * One file so Urdu can be added later without hunting through views: the plan
 * is a second object of the same shape and a language setting. Nothing else in
 * the codebase should contain display text.
 */

export const APP_VERSION = '1.1.0';

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
  // The elder's very first screen after signing in. Until a supporter has
  // added something there is nothing to show, so the empty state carries the
  // next step instead of describing the emptiness.
  coldStartTitle: 'Almost ready',
  coldStartBody: 'Show this code to whoever is helping you. Once they enter it on their phone, your medicines will appear here on their own.',
  coldStartCodeLabel: 'Your code',
  coldStartWaiting: 'Nothing to do until then.',
  done: 'Done',
  undo: 'Undo',
  allTaken: 'All taken',
  noPhoto: 'No photo',
  // Passive marker on the slot whose time has most recently passed. It never
  // reorders, hides or dims anything -- see docs/ui.md.
  nowLabel: 'Now',
  // Today only. Resets at midnight, never stored, and has no historical
  // counterpart anywhere: orientation, not a score.
  doneOfSlots: (done, total) => `${done} of ${total} done today`,
  medicineCount: n => `${n} ${n === 1 ? 'medicine' : 'medicines'}`,
  showMedicines: 'Show the medicines',
  hideMedicines: 'Hide the medicines',

  // Skipped is a recorded outcome, not a failure: amber, never red, and the
  // word is never "Missed". See docs/ui.md.
  skipped: 'Skipped',
  allMarked: 'All marked',
  skippedToast: name => `${name} marked as skipped`,
  // The dose target cycles, so its label has to say what the NEXT tap does.
  doseNotYet: name => `${name}: not marked. Tap to mark taken.`,
  doseTaken: name => `${name}: taken. Tap to mark skipped.`,
  doseSkipped: name => `${name}: skipped. Tap to clear.`,
  // Read-only equivalents: the supporter's Today and the elder's frozen days.
  stateTaken: name => `${name}: taken`,
  stateSkipped: name => `${name}: skipped`,
  stateUnmarked: name => `${name}: not marked`,

  // Supporter's Today. Their copy is polled, not live -- saying so is the
  // difference between "nothing new" and "we stopped being able to check".
  updatedJustNow: 'Updated just now',
  updatedAgo: mins => `Updated ${mins} minute${mins === 1 ? '' : 's'} ago`,
  updatedNever: 'Could not check for updates',

  // Marking a dose for the person you are helping. Asked once per session,
  // and every row it writes records that the supporter wrote it.
  markOnBehalfTitle: 'Mark for them?',
  markOnBehalfBody: 'This records the dose on their phone too, and their screen will show that you marked it rather than them. You will not be asked again while the app is open.',
  markOnBehalfConfirm: 'Yes, mark for them',
  markedByHelper: 'Marked by your helper',

  // The supporter's nudge. Replaces phoning to ask "have you taken them?".
  nudge: 'Send a reminder',
  nudgeHint: 'Their phone will buzz. It does not say which medicine.',
  nudgeSent: 'Reminder sent',
  nudgeWait: mins => `Already sent. You can send another in ${mins} minute${mins === 1 ? '' : 's'}.`,
  nudgeNoSubscription: 'They have not turned reminders on yet, so nothing was sent.',
  /* Distinct from "sent". The edge function reports a delivery that reached
   * nobody, and reporting that as success is exactly the failure this button
   * exists to remove -- the supporter would sit waiting on a buzz that never
   * happened. */
  nudgeFailed: 'The reminder could not be delivered. Their phone may be switched off.',
  // Shown once at the top of the day rather than on every card: with six
  // medicines in a slot, six copies of the same hint is noise. Only rendered
  // once there is at least one medicine -- see js/views/today.js.
  tapForPhoto: 'Tap a medicine to see its photo.',
  closePhoto: 'Close',
  seePhotoFull: 'Tap the photo to see it full screen',

  // ---- calendar ---------------------------------------------------------
  calendarTitle: 'Calendar',
  monthPickerTitle: 'Go to month',
  today: 'Today',
  notYet: 'Not yet',
  notYetBody: 'This day has not arrived. You can mark medicines on the day itself.',
  lockedBody: 'This day is from before your last update, so it is kept as a record and cannot be changed.',
  dayNothing: 'No medicines were due on this day.',
  ofDoses: (taken, expected) => `${taken} of ${expected} taken`,
  ofSkipped: n => `${n} skipped`,
  someSkipped: 'Some skipped',
  nothingMarked: 'Nothing marked',
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
  /* Shown when a medicine is given its own time inside a slot. Marking is
   * keyed on the slot, so it is still marked together with everything else in
   * it -- that is a real constraint, and the form has to say so rather than
   * let someone discover it on the Today screen. */
  scheduleTimeOverride: (label, slotTime) =>
    `Due at its own time, but still marked together with the rest of ${label} (${slotTime}).`,
  scheduleTimeAddSlot: 'For a very different time, add a time of day',
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
  saving: 'Saving',
  saved: 'Saved',
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
  // Shown instead of the generic error when the medicine and its schedule
  // saved fine but the photo step itself failed -- see js/views/medicine-form.js.
  savedMedicineNoPhoto: 'Saved, but the photo could not be uploaded. Try adding it again from the medicine\u2019s page.',

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
  settingsAppearance: 'Appearance',
  settingsAppearanceHint: 'Dark colours are easier at night, when the last medicines are usually due.',
  themeSystem: 'Match my phone',
  themeLight: 'Light',
  themeDark: 'Dark',
  settingsAbout: 'About',
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
  /* Third state, not a second. Reporting "off" when the check itself failed is
   * how a household ran for weeks believing reminders were on -- a switch that
   * cannot be wrong is worse than one that admits it does not know. */
  notificationsUnknownLabel: 'Reminders could not be checked',
  notificationsUnknownHint: 'This usually means the app has not finished starting up. Turning them on again is safe.',

  // ---- misc ------------------------------------------------------------
  loading: 'Loading',
  errGeneric: 'Something went wrong.',
  errRetry: 'Close the app and open it again. Nothing you have recorded is lost.',
};
