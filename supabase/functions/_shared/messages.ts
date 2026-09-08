/* Every word the app ever pushes to a lock screen.
 *
 * One file, at the top, so changing the wording never means reading a query.
 * `js/strings.js` is the equivalent for the app's own screens; these are
 * separate because push bodies are built server-side in Deno and never reach
 * the browser at all.
 *
 * FOUR RULES. Breaking any of them is a bug, not a style choice.
 *
 *   1. NEVER NAME A MEDICINE. Every string here travels through a
 *      third-party push service (Apple's, Google's, Mozilla's) and lands
 *      unencrypted-to-them on a lock screen anyone nearby can read. Slot
 *      labels are fine -- "Morning" identifies nothing about a person's
 *      health. A drug name does.
 *
 *   2. SAY "MARKED", NEVER "TAKEN". The app cannot tell the difference
 *      between a dose that was missed and one that was taken and simply not
 *      ticked. Wording that assumes the former accuses someone of forgetting
 *      their medicine when they did not, which is exactly the judgement
 *      docs/ui.md forbids everywhere else in the app.
 *
 *   3. THE SLOT NAME GOES IN THE TITLE, NEVER THE BODY. Labels are stored
 *      capitalised ("Morning") and are editable by the supporter, so
 *      `your ${label} medicines` renders as "your Morning medicines" today
 *      and would mangle a label like "After Breakfast" or a non-English one
 *      later. A title needs no grammatical agreement, and both iOS and
 *      Android always show it without expanding the notification.
 *
 *   4. VARIANT CHOICE MUST STAY DETERMINISTIC. A push that fails is retried
 *      up to three times. If the wording were random, attempt two would
 *      arrive worded differently and read as a second, separate reminder --
 *      the one thing a gentle nudge must never do. pick() below is a pure
 *      function of a key the caller derives from the notification's identity,
 *      so a retry is byte-identical while the words still vary day to day.
 *
 * A SUPPORTER-FACING MESSAGE NAMES THE ELDER, BY DESIGN. Every message above
 * is written to the elder and never identifies them -- there is no one else
 * it could be about. A message TO a supporter is different: it is already
 * about a specific person, `households.display_name`, which the supporter's
 * own Settings screen shows them today, so this is not a new exposure. Rule 3
 * still applies to the slot label -- it just now shares the title with the
 * name rather than owning it alone: `"<name> - <slot label> medicines"`. The
 * body stays as generic and gender-neutral as the elder's own copy ("their",
 * never "her"/"his" -- the app has no pronoun for the elder).
 */

// ---- the copy -------------------------------------------------------------

export const PUSH_COPY = {
  /** Stage 1: the slot's own time, anything in it still unmarked. */
  stage1: [
    '🌤️ Ready whenever you are.',
    '✨ These are ready for you.',
    '⏰ Time to grab these - no rush.',
  ],

  /** Stage 2: one hour later (per household), still unmarked. */
  stage2: [
    '🌸 Still here whenever you get a moment.',
    '💫 Just a gentle nudge - no rush.',
    '🌤️ These are still waiting for you.',
  ],

  /* The nightly catch-all. Names no slot and no medicine -- it covers the
   * whole day, and by this hour the useful message is "have a look", not
   * "here is what you owe". The third variant carries rule 2 out loud. */
  nightlyTitle: 'Before the day ends',
  nightly: [
    "🌙 A few things from today aren't marked yet - quick look?",
    '✨ Almost bedtime - anything left to mark off?',
    "🌟 If you've taken everything today, worth marking it off.",
  ],

  /* The supporter's manual nudge. Deliberately one wording rather than
   * three: it is occasional and person-initiated, so day-to-day variety buys
   * nothing, and a single string keeps rule 4 trivially satisfied. Kept
   * plain on purpose -- an earlier draft ("someone's thinking of you") read
   * as more intimate than a household utility app should ever sound. */
  nudgeTitle: 'Medicine Tracker',
  nudge: '👋 Someone is reminding you to take your medicines',

  // A deliberate one-off action from the elder's own Settings screen. It
  // confirms delivery without mentioning medicines on the lock screen.
  testTitle: 'Medicine Tracker',
  test: 'This is a test reminder. Check that it appeared on this phone.',

  /* Stage 3: a supporter's own escalation, some time after the SLOT's own
   * time (delay is per-subscription -- see 0020, which corrected this from
   * an earlier version anchored on the elder's own stage-2 delay instead).
   * Never "still hasn't taken it" -- the supporter can see this even less
   * than the elder's own notifications can, so rule 2 matters most here.
   * Elder-facing copy above stays calm on purpose (docs/ui.md); a
   * supporter's own copy can carry more energy since it's a check-in
   * between two people who both opted into it, not a reminder aimed at
   * someone who may already feel watched. */
  escalation: [
    '👀 Still not marked - worth a quick call?',
    '📞 Nothing logged yet! Maybe check in?',
    '💛 A little check-in could go a long way right now.',
  ],

  /* The nightly catch-all, addressed to a supporter instead of the elder. */
  nightlyForSupporter: [
    '📋 A few things today are still unmarked!',
    "🌙 Not everything's marked yet - worth a call before bed?",
    '💛 A quick check-in before the day wraps up?',
  ],
} as const;

// ---- assembling one notification ------------------------------------------

/* FNV-1a. Any stable string hash would do; this one is short enough to read
 * and has no dependencies. Math.imul keeps the multiply in 32-bit range --
 * a plain `*` overflows into a float and stops being a hash. */
function hash(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick(variants: readonly string[], key: string): string {
  return variants[hash(key) % variants.length];
}

export interface Notification {
  title: string;
  body: string;
}

/**
 * A slot reminder, stage 1 or stage 2.
 *
 * The key includes the stage so the two messages for one slot never land on
 * the same variant, and includes the date so the wording moves on tomorrow.
 */
export function slotNotification(
  stage: number,
  slotLabel: string,
  localDate: string,
  slotId: string,
): Notification {
  const variants = stage === 2 ? PUSH_COPY.stage2 : PUSH_COPY.stage1;
  return {
    title: `${slotLabel} medicines`,
    body: pick(variants, `${localDate}|${slotId}|${stage}`),
  };
}

/** The nightly catch-all. One per household per day, so that is the key. */
export function nightlyNotification(localDate: string, householdId: string): Notification {
  return {
    title: PUSH_COPY.nightlyTitle,
    body: pick(PUSH_COPY.nightly, `${localDate}|${householdId}`),
  };
}

/** The supporter's nudge. */
export function nudgeNotification(): Notification {
  return { title: PUSH_COPY.nudgeTitle, body: PUSH_COPY.nudge };
}

/** A device-specific test, requested by its signed-in owner. */
export function testNotification(): Notification {
  return { title: PUSH_COPY.testTitle, body: PUSH_COPY.test };
}

/**
 * A supporter's stage-3 escalation. Keyed without the subscription id: two
 * supporters watching the same slot should be free to land on the same
 * variant, since each only ever sees their own notification.
 */
export function escalationNotification(
  slotLabel: string,
  elderName: string,
  localDate: string,
  slotId: string,
): Notification {
  return {
    title: `${elderName} - ${slotLabel} medicines`,
    body: pick(PUSH_COPY.escalation, `${localDate}|${slotId}|escalation`),
  };
}

/** The nightly catch-all, for a supporter subscription. */
export function nightlyNotificationForSupporter(
  elderName: string,
  localDate: string,
  householdId: string,
): Notification {
  return {
    title: `${elderName} - today's medicines`,
    body: pick(PUSH_COPY.nightlyForSupporter, `${localDate}|${householdId}|supporter`),
  };
}
