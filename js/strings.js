/* Every user-visible string in the app's own screens.
 *
 * One file so Urdu can be added later without hunting through views: the plan
 * is a second object of the same shape and a language setting.
 *
 * The wording follows the CarePair redesign handoff and its copy rules:
 *   - Plain language, no jargon, no medical advice.
 *   - The elder's marking button always states the CURRENT true fact, in
 *     second person, never the action a tap performs: "You have not taken
 *     these yet" while unmarked, "You have already taken these" once it is --
 *     tapping flips the medicine's state AND the button's own label together,
 *     so the two are never seen out of step. Never "Confirm dose", never
 *     "Undo". Both used to be first person ("I have taken these") describing
 *     the action rather than the fact, which real elder testers read as the
 *     app telling them something false the moment it did not match what was
 *     actually true yet -- and "Undo" itself was simply not a word every
 *     elder recognised as software jargon for "change your answer".
 *   - Skipping is "Leave this one out today", never "Skip", and it is always
 *     reversible with "Put it back on the list" -- the same "name the actual
 *     opposite state" idea the marking copy above now follows too.
 *   - Errors say what happened, that nothing was lost, and what to do next.
 *   - Nobody's pronouns are assumed: the helper acts "on their behalf".
 *
 * The one exception, and it is not a leak: push notification bodies live in
 * `supabase/functions/_shared/messages.ts`. Those are built server-side in
 * Deno and never reach the browser.
 */

export const APP_VERSION = '2.0.0';

/** "Umer Butt" -> "Umer". The stored household name is first + last; every
 * screen that greets someone by name shows only the first. */
export function firstNameOf(fullName) {
  return fullName ? fullName.trim().split(/\s+/)[0] : '';
}

export const S = {
  appName: 'CarePair',
  tagline: 'Medicines, kept simple — for the person taking them and the person helping.',

  // ---- welcome / role picker --------------------------------------------
  roleSimple: 'I take the medicines',
  roleSupporter: 'I help someone with their medicines',
  roleChangeLater: 'You can change this later in Settings.',

  // ---- how it works (4-panel carousel) ----------------------------------
  howItWorks: 'How it works',
  howCount: (current, total) => `${current} of ${total}`,
  howNote: 'Reading this changes nothing in the app. No medicines are added.',
  howClose: 'Close',
  howBack: 'Back',
  howNext: 'Next',
  howDone: 'Done',
  howPages: [
    {
      title: 'Pick who you are',
      body: 'One phone belongs to the person taking the medicines. The other belongs to whoever helps them. Each phone shows only what that person needs.',
      art: 'role',
    },
    {
      title: 'The helper sets things up',
      body: 'The helper adds each medicine with a photo of the pill and the packet, what it is for, and the times of day it is taken.',
      art: 'setup',
    },
    {
      title: 'Follow the day',
      body: 'The person taking the medicines sees one screen: Morning, Evening, Bedtime. Tap a time to see the medicines, tap a medicine to see the pill.',
      art: 'today',
    },
    {
      title: 'Fill the weekly box',
      body: 'Once a week, whoever fills the plastic pill box is walked through it one medicine at a time. Filling the box never marks anything as taken.',
      art: 'box',
    },
  ],

  // ---- sign in (elder) --------------------------------------------------
  signInTitle: 'Sign in so your helper can reach you',
  signInIntro: 'One sign-in keeps your medicine list safe and lets your helper add medicines from their own phone.',
  signInGoogle: 'Continue with Google',
  signInNote: 'No new password to remember.',
  signInLoading: 'Signing you in…',
  signInLoadingNote: 'Setting up your household and your sharing code.',
  signInErrorTitle: 'Sign-in did not finish',
  signInErrorBody: 'The connection dropped. Nothing was changed. You can try again.',
  tryAgain: 'Try again',

  // ---- organizer box question (both roles' Settings, and sign-in) -------
  organizerQuestion: 'Do you use a pill organizer box?',
  organizerQuestionNote: 'This decides whether "Fill the Organizer" shows up in the menu.',
  organizerYes: 'Yes, I use one',
  organizerYesHint: 'Show a weekly "Fill the Organizer" reminder.',
  organizerNo: 'No',
  organizerNoHint: 'Take medicines straight from their packets instead.',
  settingsOrganizerSection: 'Pill organizer',
  organizerRefreshTitle: 'Refresh to update your menu',
  organizerRefreshBody: 'The "Fill the Organizer" tab will show this change once the page refreshes.',
  organizerRefreshConfirm: 'Refresh now',
  organizerRefreshLater: 'Later',

  // ---- pairing (helper) -------------------------------------------------
  pairKicker: 'Helper setup',
  pairTitle: 'Enter the code from their phone',
  pairIntro: 'Ask them to open Settings on their phone and read you the six-character code. No account needed for you.',
  pairCodeLabel: 'Household code',
  pairCodePlaceholder: '– – – – – –',
  pairPasteButton: 'Paste code',
  pairPasteFormatError: 'That doesn’t look like a 6-character code.',
  pairPasteReadError: 'Could not read the clipboard.',
  pairInvalidTitle: 'That code was not found',
  pairInvalidBody: 'Codes are six characters, letters and numbers. Check it with them and try again — or ask them to make a new code in Settings.',
  pairFailedTitle: 'Could not connect',
  pairFailedBody: 'The code looks right but we could not reach the household. Check your internet and retry.',
  pairConnecting: 'Connecting…',
  pairDoneTitle: name => `Connected to ${name || 'their household'}`,
  pairDoneBody: 'You can now add medicines, set times, and follow the day. Marking a dose will always say you are doing it on their behalf.',
  pairConnect: 'Connect',
  pairGoToToday: 'Go to Today',
  pairRetry: 'Retry',
  /* The short form of pairFailedBody, for the places that report a failed
   * code-gated call in one line: the medicine list, the form and Times of day
   * all reach the same RPC and fail the same way. */
  pairConnectionError: 'Could not connect. Check your internet and try again.',

  // ---- navigation -------------------------------------------------------
  navToday: 'Today',
  navCalendar: 'Calendar',
  navSettings: 'Settings',
  navMedicines: 'Medicines',
  navFillTheBox: 'Fill the Organizer box',
  navBox: 'Pill Organizer',

  // ---- elder Today (E1) -------------------------------------------------
  todayFlag: 'Today',
  welcomeElder: name => (name ? `Welcome, ${name}!` : 'Welcome!'),
  offlineBanner: 'No internet — your taps are saved here.',
  loadingToday: 'Getting today ready…',
  emptyTitle: 'No medicines here yet',
  emptyBody: 'Your helper adds your medicines from their own phone. Give them the code below and they can start.',
  emptyCheckButton: 'Check if my medicines have been added',
  emptyCheckChecking: 'Checking…',
  emptyCheckNoneYet: 'Nothing yet — ask your helper to check they saved it.',
  yourCode: 'Your code',
  copyCode: 'Copy',
  sendCode: 'Send it',
  noneDueTitle: 'Nothing to take today',
  noneDueBody: 'There are no medicines set for today. Your next one is on the next day something is due.',

  // ---- elder's "See yesterday" (a read-only peek, not the helper's Calendar)
  yesterdayButton: 'See yesterday',
  yesterdayEyebrow: 'Yesterday',
  yesterdayEmpty: 'Nothing was due yesterday.',

  takeThese: 'You have not taken these yet',
  takeThis: 'You have not taken it yet',
  undoThese: 'You have already taken these',
  undoThis: 'You have already taken it',
  seeThePills: 'See the pills',

  statusAllTaken: 'All taken',
  statusAllDealtWith: n => `All dealt with · ${n} not taken`,
  statusPartial: (done, total) => `${done} of ${total} dealt with`,
  statusNotTakenYet: 'Not taken yet',
  statusStillToCome: 'Still to come',
  statusNotMarked: 'Not marked',

  /* Medicine names collapse to one line. Two join with "and"; three or more
   * become "{first} and N more". Never wraps, never clips mid-word.
   *
   * The length guard is the third rule, and it is not optional: two names can
   * be long on their own -- "Atorvastatin and Latanoprost drops" is 33
   * characters -- and joining them overflows the card at 21px on any phone,
   * where the CSS ellipsis then cuts a word in half. Past the budget the pair
   * takes the "and 1 more" form instead, which is exactly the handoff's own
   * worked example. A character count rather than a measurement because this
   * runs in a selector with no layout to ask, and 30 characters is the width
   * of the narrowest card this app supports. */
  medNamesSummary: names => {
    if (!names.length) return '';
    if (names.length === 1) return names[0];
    if (names.length === 2) {
      const pair = `${names[0]} and ${names[1]}`;
      if (pair.length <= 30) return pair;
    }
    return `${names[0]} and ${names.length - 1} more`;
  },

  // ---- elder slot detail (E2) -------------------------------------------
  backToToday: 'Today',
  biggerPicture: 'Bigger picture and notes',
  takeThisOne: 'You have not taken this yet',
  undoNotTaken: 'You have already taken this',
  leaveOutToday: 'Leave this one out today',
  putBackOnList: 'Put it back on the list',
  markAllOfSlot: (takeLabel, slot) => `${takeLabel} — all of ${slot}`,
  undoAllOfSlot: (undoLabel, slot) => `${undoLabel} — all of ${slot}`,
  stateTakenLabel: 'Taken',
  stateSkippedLabel: 'Not taking today',
  stateUnmarkedLabel: 'Not marked yet',
  pillPhoto: 'The pill',
  packetPhoto: 'The packet',
  noPacketPhotoYet: 'No packet photo yet',
  makeItBigger: 'Make it bigger',
  whatItIsFor: 'What it is for',
  notesLabel: 'Notes',
  whenLabel: 'When',
  formLabel: 'Form',
  notTakingToday: 'Not taking this today',
  undoNotTakenLong: 'You have already taken it',
  putThisBack: 'Put this back on the list',

  // ---- elder settings (E4) ----------------------------------------------
  settingsTitle: 'Settings',
  settingsYourAccount: 'Your account',
  settingsCodeForHelper: 'Code for your helper',
  settingsMakeNewCode: 'Make a new code…',
  settingsRemindersSection: 'Reminders',
  remindersOn: 'Reminders are on',
  remindersOff: 'Reminders are off',
  remindersBlocked: 'Reminders are not available',
  remindersOnNote: 'Your phone will show a reminder at each medicine time.',
  remindersOffNote: 'Turn them on and your phone will remind you at each medicine time.',
  remindersBlockedNote: 'This phone has blocked notifications for CarePair. Allow them in your phone settings, then come back.',
  remindersTurnOn: 'Turn reminders on',
  remindersTurnOff: 'Turn reminders off',
  remindersTest: 'Send me a test reminder',
  remindersTestSent: 'Test reminder sent to this phone',
  remindersTestFailed: 'Could not send the test reminder — check your internet',
  remindersAllowTitle: 'Allow reminders?',
  remindersAllowBody: 'Your phone will ask permission to show CarePair reminders. Choose Allow on the next message.',
  remindersAllowConfirm: 'Ask my phone',
  remindersNotNow: 'Not now',

  settingsHowItLooks: 'How it looks',
  themeSystem: 'Match system',
  themeLight: 'Light',
  themeDark: 'Dark',

  settingsAboutSection: 'About',
  aboutDisclaimer: 'CarePair helps you remember and recognise your medicines. It does not give medical advice. Ask your doctor or pharmacist about your medicines.',
  aboutDisclaimerSupporter: 'CarePair records what you and the person you help tell it. It does not check doses, interactions or give medical advice.',
  aboutBuild: version => `CarePair ${version}`,

  settingsSignOutAction: 'Sign out…',
  signOutTitle: 'Sign out of CarePair?',
  signOutBody: 'Your medicines stay safe. You will need to sign in with Google again to see your day, and reminders will stop until you do.',
  signOutConfirm: 'Sign out',
  signOutCancel: 'Stay signed in',

  rotateTitle: 'Make a new code?',
  rotateBody: code => `Your current code ${code} stops working straight away. Anyone helping you now will be disconnected and will need the new code.`,
  rotateConfirm: 'Make a new code',
  rotateCancel: 'Keep this code',

  // ---- share sheet ------------------------------------------------------
  shareSheetTitle: 'Send your code to your helper',
  shareWhatsapp: 'WhatsApp',
  shareTextMessage: 'Text message',
  shareCopyCode: 'Copy the code',

  // ---- fill the box -----------------------------------------------------
  fillTitle: 'Fill the box',
  fillSubtitle: "Putting next week's pills into the plastic box.",
  fillNotDoses: 'This only fills the plastic box. It does not mean you have taken anything.',
  fillWeekLabel: 'Week',
  fillChange: 'Change',
  fillCompartmentsLabel: 'Compartments in the box',
  fillCompartmentsNone: 'None chosen',
  fillNoSlotsTitle: 'No compartments chosen yet',
  fillNoSlotsBody: 'Choose at least one time of day that lives in the physical box — usually morning and bedtime.',
  fillChooseCompartments: 'Choose compartments',
  fillNothingTitle: 'Nothing to put in the box this week',
  fillNothingBody: 'No medicine in the list falls on these days. Try another week, or ask the helper to check the medicine list.',
  fillCount: n => `${n} ${n === 1 ? 'medicine goes' : 'medicines go'} in the box`,
  fillCountNote: 'We will show them one at a time, with the pill photo.',
  fillResumeTitle: 'You stopped part way',
  fillResumeBody: (done, total) => `${done} of ${total} medicines were already put in the box.`,
  fillCarryOn: 'Carry on',
  fillStartAgain: 'Start again',
  fillStart: 'Start filling the box',
  fillOutsideButton: n => `${n} ${n === 1 ? 'medicine stays' : 'medicines stay'} outside the box — see them`,
  fillOutsideTitle: 'These stay out of the box',
  fillOutByForm: 'Taken from the packet, not the box',
  fillOutBySlot: labels => `${labels.join(' and ')} — not in the box`,

  fillProgress: (i, n) => `Medicine ${i} of ${n}`,
  fillDoneCount: (done, total) => `${done} of ${total} put in the box`,
  fillProgressNote: 'This is how far through the job you are, nothing else.',
  fillWeekQty: text => `${text} for the whole week`,
  fillHowManyEachDay: 'How many go in each day',
  fillTapToEnlarge: 'Tap to enlarge',
  fillInTheBox: 'It is in the box',
  fillIsInTheBox: 'In the box',
  fillUndo: 'Undo',
  fillBack: 'Back',
  fillNextMedicine: 'Next medicine',
  fillCheckTheBox: 'Check the box',
  fillPutIn: name => `${name} put in the box`,
  fillUnmarked: name => `${name} unmarked`,
  fillNoPhotos: 'No photos yet. Ask whoever adds the medicines to take one.',

  fillCheckTitle: 'Check the box',
  fillCheckBackToMedicines: 'Back to the medicines',
  fillCheckIntro: 'Compare each compartment with the tray in front of you. We cannot see the tray, so the last word is yours.',
  fillCheckTapHint: 'Tap a box to see which pills go in it. “–” means leave it empty.',
  fillCheckDone: 'I have finished filling the box',
  fillCheckToast: 'Box marked as prepared for this week',
  fillCompartmentNote: 'This is what belongs in that compartment. Putting it there does not mark anything as taken.',
  fillCompartmentEmpty: 'Nothing goes in this one.',

  boxTimesTitle: 'Which compartments does the box have?',
  boxTimesBody: 'Tick the times of day that exist as compartments in the plastic box.',
  boxTimesKeepOne: 'Keep at least one time in the box',
  done: 'Done',

  // ---- supporter Today --------------------------------------------------
  helpingWhom: name => (name ? `Helping ${name}` : 'Helping'),
  nudge: 'Send a reminder',
  nudgeSent: 'Reminder sent to their phone',
  nudgeWait: mins => `Already sent. You can send another in ${mins} minute${mins === 1 ? '' : 's'}.`,
  nudgeNoSubscription: 'They have not turned reminders on yet, so nothing was sent.',
  nudgeFailed: 'The reminder could not be delivered. Their phone may be switched off.',

  checkNow: 'Check now',
  updatedJustNow: 'Updated just now',
  updatedAgo: mins => `Updated ${mins} minute${mins === 1 ? '' : 's'} ago`,
  updatedNever: 'Not checked yet',
  dateDiffNotice: (yours, theirs) =>
    `Your phone says ${yours}, but their day is still ${theirs}. You are looking at their day.`,
  syncFailTitle: 'Could not get the latest',
  syncFailBody: 'You are seeing what was saved earlier. Marks you make now are saved and sent when the connection is back.',
  syncFailBodyAged: when => `You are seeing what was saved ${when}. Marks you make now are saved and sent when the connection is back.`,
  onBehalfChip: name => `Marking on ${name ? `${name}'s` : 'their'} behalf this session`,

  slotOpen: 'Open',
  slotHide: 'Hide',
  slotCount: n => `${n} ${n === 1 ? 'medicine' : 'medicines'}`,
  markTaken: 'Mark taken',
  clearMark: 'Clear',
  markWholeSlot: 'Mark the whole slot',
  undoWholeSlot: 'Undo the whole slot',

  markOnBehalfTitle: name => `Mark this for ${name || 'them'}?`,
  markOnBehalfBody: 'You are recording this on their behalf. It will show on their phone as already dealt with. We will not ask again while you are in the app.',
  markOnBehalfConfirm: 'Yes, mark on their behalf',
  markOnBehalfCancel: 'Not now',
  markAllOnBehalfTitle: (slot, name) => `Mark all of ${slot.toLowerCase()} for ${name || 'them'}?`,
  markAllOnBehalfBody: n => `You are recording ${n} ${n === 1 ? 'medicine' : 'medicines'} on their behalf. We will not ask again while you are in the app.`,
  markedByHelper: 'Marked by your helper',

  // ---- calendar ---------------------------------------------------------
  monthPickerTitle: 'Jump to a month',
  calLoading: 'Loading the record…',
  calErrorTitle: 'The record could not be loaded',
  calErrorBody: 'Nothing was lost. This is a reading problem, not a saving problem.',
  calEmptyTitle: 'Nothing recorded yet',
  calEmptyBody: 'Once medicines are added and the first day is marked, it will appear here. Days stay readable forever; recent days can still be corrected.',
  calAddFirst: 'Add the first medicine',
  calLegendTitle: 'What the marks mean',
  calLegendLine1: '✓ every medicine dealt with · ○ something still unmarked · — something not taken · · nothing was due',
  calLegendLine2: '▣ before the mark = a read-only record, no longer editable · plain with no mark = a future day, not markable',
  calLegendLine3: 'No scores, no streaks — just what happened.',
  today: 'Today',
  lockedBody: 'Kept as a record. Older days cannot be changed — you can still read everything and open the medicines.',
  futureBody: 'This day has not happened yet. You can see what is planned, but nothing can be marked.',
  editableBody: 'You can still correct this day.',
  dayNothing: 'No medicines were due',
  dayNothingBody: 'Nothing was scheduled on this day, so there is nothing to mark.',
  dayChange: 'Change',
  ofDoses: (taken, expected) => `${taken} of ${expected} taken`,
  ofSkipped: n => `${n} skipped`,
  weekdayShort: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
  weekdayShort3: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  monthNames: ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'],

  // ---- medicines (supporter) -------------------------------------------
  medicinesTitle: 'Medicines',
  addMedicine: 'Add medicine',
  addFirstMedicine: 'Add the first medicine',
  editMedicine: 'Edit medicine',
  newMedicine: 'Add medicine',
  medsLoading: 'Loading medicines…',
  medicinesEmpty: 'No medicines yet',
  medicinesEmptyBody: 'Add the first medicine with a photo of the pill and the packet. Their Today screen stays empty until then, and it tells them you are setting things up.',
  showArchived: 'Show archived',
  hideArchived: 'Hide archived',
  archived: 'Archived',
  archive: 'Archive',
  archiveEllipsis: 'Archive this medicine…',
  unarchive: 'Restore',
  archiveTitle: name => `Archive ${name}?`,
  archiveBody: 'It disappears from Today and from the pill box, but the past record stays in the calendar. You can restore it at any time.',
  archiveKeep: 'Keep it',
  archivedToast: name => `${name} archived`,
  restoredToast: name => `${name} restored`,
  archivedNote: 'Archived medicines stay out of Today and out of the pill box, but their past record is kept.',
  photoStateBoth: 'Pill + packet photo',
  photoStatePill: 'Pill photo only',
  photoStatePacket: 'Packet photo only',
  photoStateNone: 'No photos yet',

  // ---- medicine form ---------------------------------------------------
  formSectionWhat: 'What it is',
  formSectionPhotos: 'Photos',
  formSectionWhen: 'When they take it',
  fieldName: 'Name',
  fieldNamePlaceholder: 'As written on the packet',
  fieldStrength: 'Strength',
  fieldStrengthPlaceholder: 'e.g. 500 mg',
  fieldDosage: 'How many',
  fieldDosageHint: 'A number. The unit comes from the form below.',
  fieldPurpose: 'What it is for (they see this)',
  fieldPurposePlaceholder: 'e.g. Blood pressure',
  purposeHint: 'One short line, for whoever fills the pill box.',
  fieldForm: 'Form',
  fieldNotes: 'Notes',
  fieldNotesPlaceholder: 'e.g. take with food',
  notesHint: 'Write only what helps them take it. CarePair does not check doses or interactions.',
  fieldPhoto: 'Pill photo',
  fieldPacketPhoto: 'Packet photo',
  takePhoto: 'Add a photo',
  addPacketPhoto: 'Add packet photo',
  photoGuidance: 'Use a close, well-lit photo of the actual pill.',
  removePhoto: 'Remove photo',
  noPacketPhoto: 'No packet photo yet',
  photoUploading: 'Uploading…',
  photoFailedTitle: 'Photo failed',
  formErrorsTitle: n => `${n === 1 ? 'One thing needs' : `${n} things need`} fixing before this can be saved`,
  forms: {
    tablet: 'Tablet', capsule: 'Capsule', liquid: 'Liquid', drops: 'Drops',
    injection: 'Injection', inhaler: 'Inhaler', other: 'Other',
  },

  doseUnits: {
    tablet: ['tablet', 'tablets'],
    capsule: ['capsule', 'capsules'],
    liquid: ['ml', 'ml'],
    drops: ['drop', 'drops'],
    injection: ['injection', 'injections'],
    inhaler: ['puff', 'puffs'],
    other: ['dose', 'doses'],
  },
  doseFractions: { 0.25: '¼', 0.5: '½', 0.75: '¾' },

  addSchedule: 'Add another time',
  removeSchedule: 'Remove',
  scheduleSlot: 'Time of day',
  scheduleTime: 'Exact time (optional)',
  scheduleTimeDefault: slotTime => `Uses the slot time (${slotTime})`,
  scheduleTimeOverride: (label, slotTime) =>
    `Due at its own time, but still marked together with the rest of ${label} (${slotTime}).`,
  scheduleTimeAddSlot: 'The time of day I need is not in the list',
  scheduleFrequency: 'How often',
  freqDaily: 'Every day',
  freqEveryNDays: 'Every few days',
  freqWeekly: 'Certain weekdays',
  freqInterval: 'Every',
  freqIntervalUnit: 'days',
  freqAnchor: 'Starting date',
  freqDaysOfWeek: 'On these days',
  weekdayNames: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],

  save: 'Save',
  saving: 'Saving…',
  saved: 'Saved',
  savedMedicineToast: name => `${name} saved`,

  busyAddingMedicine: 'Adding the medicine',
  busySavingChanges: 'Saving the changes',
  busyLoadingMedicine: 'Getting the medicine details',
  busyUploadingPhoto: 'Uploading the photo',
  busyRemovingPhoto: 'Removing the old photo',
  busyFinishing: 'Nearly done',
  busyHint: 'This can take a moment on a slow connection.',
  cancel: 'Cancel',
  back: 'Back',
  close: 'Close',
  confirm: 'Confirm',
  keepIt: 'Keep it',

  errNameRequired: 'A name is needed — this is what they will read.',
  errDosageRequired: 'The dose must be a number above zero.',
  errNoSchedule: 'At least one time is needed. A medicine with no time set would never appear on the Today screen.',
  errAnchorRequired: 'Choose the day it starts from, otherwise we cannot work out which days it falls on.',
  errDaysRequired: 'Pick at least one weekday.',
  errPhotoFailed: 'That photo could not be read. Try taking it again.',
  savedMedicine: 'Saved',
  savedMedicineNoPhoto: 'Saved, but the photo could not be uploaded. Try adding it again from the medicine’s page.',

  // ---- times of day (supporter) ----------------------------------------
  slotsTitle: 'Times of day',
  slotsIntro: 'These are the words they see on their Today screen, and the compartments in the pill box. Keep them few and obvious.',
  slotLabel: 'Name',
  slotTime: 'Time',
  addSlot: 'Add a time of day',
  removeSlot: 'Remove',
  slotKeepOne: 'At least one time of day must stay.',
  slotUses: n => (n === 0
    ? 'Not used by any medicine'
    : `${n} ${n === 1 ? 'medicine uses' : 'medicines use'} this`),
  slotRemoveTitle: label => `Remove ${label}?`,
  slotRemoveBody: (label, n) => (n
    ? `${n} medicine ${n === 1 ? 'schedule uses' : 'schedules use'} ${label}. They will need a new time of day before they appear on Today again.`
    : `No medicines use ${label}, so nothing else changes.`),
  slotRemoveConfirm: label => `Remove ${label}`,
  slotRemovedToast: label => `${label} removed`,
  slotAddedToast: 'Time of day added',
  slotsSavedToast: 'Times of day saved',
  errSlotLabel: 'Give this time of day a name.',

  // ---- supporter settings ----------------------------------------------
  settingsConnection: 'Connection',
  settingsConnectedTo: name => (name ? `${name}\u2019s household` : 'Their household'),
  settingsConnectedWith: code => `Connected with code ${code}.`,
  settingsDisconnect: 'Disconnect…',
  settingsDisconnectTitle: name => `Disconnect from ${name ? `${name}'s` : 'this'} household?`,
  settingsDisconnectBody: 'You will stop seeing their medicines and stop getting alerts. Their medicines and history are not deleted. You would need their code again to reconnect.',
  settingsDisconnectConfirm: 'Disconnect',
  settingsDisconnectCancel: 'Stay connected',

  settingsYourAlerts: 'Your alerts',
  settingsHousehold: 'Household',
  settingsAppearance: 'Appearance',
  supporterNotificationsLabel: 'Tell me if a medicine is not marked',
  supporterNotificationsHint: 'Only for medicines that were due — never a summary or a score.',
  supporterNotificationsChange: 'Change',
  supporterNotificationsOn: 'On',
  supporterNotificationsOff: 'Off',
  supporterNotificationsUnknown: 'Could not check',
  escalationDelayLabel: 'How long to wait first',
  escalationDelay30m: '30 minutes',
  escalationDelay1h: '1 hour',
  escalationDelay2h: '2 hours',
  escalationDelay3h: '3 hours',

  // ---- community -------------------------------------------------------
  communityTitle: 'Shared medicine list',
  communityLookUp: 'Look it up in the shared list',
  communityLookUpHint: 'Optional. It only ever fills in the name, strength and photos — you can ignore it and type everything yourself.',
  communityUse: 'Use',
  communityNoThanks: 'No thanks, I will type it myself',
  communityExplain: 'Using an entry only fills in the name, strength and photos. You still choose the dose, the purpose and the times — and you can change anything afterwards.',
  communityUsing: 'Using a shared reference. Check it matches the packet you have.',
  communitySearchPhotos: count => (count === 2 ? 'pill and packet photo' : count === 1 ? 'pill photo only' : 'no photos'),
  communitySearchFailed: 'The shared list is unavailable right now.',
  communitySuggestPhoto: 'Share with others',
  communitySuggestTitle: 'Suggest this photo to others?',
  communitySuggestBody: 'Your photo replaces the shared one for everyone who uses it. No other information is shared.',
  communitySuggestConfirm: 'Suggest photo',
  communitySuggestCancel: 'Keep it private',
  communitySuggestSent: 'Photo suggested — thank you',
  communityAdded: 'Added to the shared list.',
  communityDuplicate: 'A matching reference already exists. Choose it from the suggestions above.',
  communityPhotosAdded: count => (count === 1 ? '1 missing shared photo added.' : count > 1 ? `${count} missing shared photos added.` : ''),
  communityReviewNeeded: 'The existing shared photo was sent for review; your photo remains private.',
  communityShareLabel: 'Share missing photos with the shared list',
  communityShareHint: 'Name and strength are shared with the photo. The schedule, notes and personal details are never shared.',
  communityFilled: 'Name, strength and photos filled in',

  // ---- share code ------------------------------------------------------
  codeCopied: 'Code copied',
  shareCodeMessage: code => `Here's my CarePair code: ${code}. Enter it in the app to help me with my medicines.`,

  // ---- misc ------------------------------------------------------------
  loading: 'Loading',
  noPhoto: 'No photo',
  closePhoto: 'Close',
  errGeneric: 'Something went wrong.',
  errRetry: 'Close the app and open it again. Nothing you have recorded is lost.',
  settingsAbout: 'About',
  settingsSignOut: 'Sign out',
};
