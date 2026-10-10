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
 *   4. ONE WORDING PER NOTIFICATION, NO VARIANTS. Plain and identical every
 *      time, so each kind is recognisable at a glance -- and a retried push
 *      is byte-identical by construction.
 *
 * A SUPPORTER-FACING MESSAGE NAMES THE ELDER AND STATES THE ELDER'S CLOCK.
 * Every elder message is written to the elder and never identifies them. A
 * message TO a supporter is about a specific person, so it carries their
 * first name (from `households.display_name`, which the supporter's own
 * Settings already shows). It also says what time it is "their time": a
 * supporter in another timezone otherwise reads an 11:50 pm summary arriving
 * at 8:50 pm their own time as a reminder fired on the wrong clock. "Their",
 * never "her"/"his" -- the app has no pronoun for the elder.
 */

// ---- the copy -------------------------------------------------------------

export const PUSH_COPY = {
  /** Stage 1: the slot's own time, anything in it still unmarked. */
  stage1: "It's time for your medicines.",

  /** Stage 2: one hour later (per household), still unmarked. */
  stage2: 'Not marked yet.',

  /** The nightly catch-all. Names no slot and no medicine. */
  nightlyTitle: 'End of the day',
  nightly: "Some of today's medicines are not marked yet.",

  /** The supporter's manual nudge. */
  nudgeTitle: 'CarePair',
  nudge: 'Your helper is reminding you to take your medicines.',

  /** A deliberate one-off from the elder's own Settings screen. */
  testTitle: 'CarePair',
  test: 'This is a test reminder.',

  /** Stage 3: a supporter's own escalation, after their chosen delay. */
  escalation: (time: string) => `Not marked yet. Due at ${time} their time.`,

  /** The nightly catch-all, addressed to a supporter. */
  nightlyForSupporterTitle: (name: string) => `${name} - end of day`,
  nightlyForSupporter: (time: string | null) => time
    ? `Some of today's medicines are not marked. It's ${time} their time.`
    : "Some of today's medicines are not marked.",
} as const;

// ---- helpers ---------------------------------------------------------------

/* "21:00" or "21:00:00" -> "9:00 pm", matching js/date.js's formatTime. */
export function formatTime(time: string): string {
  const [h, m] = String(time).split(':').map(Number);
  const suffix = h < 12 ? 'am' : 'pm';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m || 0).padStart(2, '0')} ${suffix}`;
}

/* First name for a supporter's title. Skips a leading honorific, so
 * "Dr Jawed Samejo" is "Jawed" rather than "Dr". Falls back to the whole
 * name if that is all there is. */
const HONORIFICS = new Set(['dr', 'mr', 'mrs', 'ms', 'miss', 'prof', 'sir']);
export function firstName(fullName: string | null | undefined): string {
  const words = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  const rest = words.filter((w, i) => !(i < words.length - 1 && HONORIFICS.has(w.toLowerCase().replace(/\.$/, ''))));
  return rest[0] || words[0] || 'Them';
}

// ---- assembling one notification ------------------------------------------

export interface Notification {
  title: string;
  body: string;
}

/** A slot reminder, stage 1 or stage 2. */
export function slotNotification(stage: number, slotLabel: string): Notification {
  return {
    title: `${slotLabel} medicines`,
    body: stage === 2 ? PUSH_COPY.stage2 : PUSH_COPY.stage1,
  };
}

/** The nightly catch-all, for the elder. */
export function nightlyNotification(): Notification {
  return { title: PUSH_COPY.nightlyTitle, body: PUSH_COPY.nightly };
}

/** The supporter's nudge. */
export function nudgeNotification(): Notification {
  return { title: PUSH_COPY.nudgeTitle, body: PUSH_COPY.nudge };
}

/** A device-specific test, requested by its signed-in owner. */
export function testNotification(): Notification {
  return { title: PUSH_COPY.testTitle, body: PUSH_COPY.test };
}

/** A supporter's stage-3 escalation. `slotTime` is the household's clock. */
export function escalationNotification(
  slotLabel: string,
  elderName: string,
  slotTime: string,
): Notification {
  return {
    title: `${firstName(elderName)} - ${slotLabel} medicines`,
    body: PUSH_COPY.escalation(formatTime(slotTime)),
  };
}

/** The nightly catch-all, for a supporter. `summaryTime` is the household's
 * clock; null only if the database predates 0029, which returns it. */
export function nightlyNotificationForSupporter(
  elderName: string,
  summaryTime: string | null,
): Notification {
  return {
    title: PUSH_COPY.nightlyForSupporterTitle(firstName(elderName)),
    body: PUSH_COPY.nightlyForSupporter(summaryTime ? formatTime(summaryTime) : null),
  };
}
