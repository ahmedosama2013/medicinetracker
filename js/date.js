/* Local-calendar date maths on "YYYY-MM-DD" strings.
 *
 * Two rules, and every off-by-one-day bug in an app like this comes from
 * breaking one of them:
 *
 *   1. Never `new Date("2026-08-30")`. A bare date string is parsed as UTC, so
 *      west of Greenwich it lands on the previous day.
 *   2. Never do day arithmetic by adding 86400000 to a timestamp. DST makes
 *      some local days 23 or 25 hours long.
 *
 * Instead: split into calendar parts, work on the parts, and only build a Date
 * with the (year, month, day) constructor, which is local by definition.
 */

const pad = n => String(n).padStart(2, '0');

/* ---- whose "today"? -------------------------------------------------------
 *
 * The household's, not the device's. A supporter in Chicago looking at an
 * elder in Karachi must see the elder's day: at 8pm Sunday in Chicago it is
 * already Monday morning where the medicines are, and showing Sunday would be
 * showing a day that is over.
 *
 * This is also what the server already does. `local_date` on every dose row
 * and `app.household_local_date` are computed in the household's timezone, so
 * aligning both clients to it makes the three agree -- and it fixes the same
 * problem for an elder who travels, whose device clock moves while their
 * routine does not.
 *
 * Set once at boot from `settings.timezone`, and again whenever a sync brings
 * a newer one. Null means "use this device", which is the correct answer
 * before a household is known and the right fallback if the zone is unusable.
 */
let householdTz = null;

export function setTimezone(tz) {
  if (!tz) { householdTz = null; return; }
  try {
    // Throws on a zone this browser does not know; better to find out here
    // than on every date read for the rest of the session.
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    householdTz = tz;
  } catch {
    householdTz = null;
  }
}

export const getTimezone = () => householdTz;

/** Calendar parts of `dt` in the household's zone, or the device's. */
function partsNow(dt = new Date()) {
  if (!householdTz) {
    return {
      y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate(),
      hh: dt.getHours(), mm: dt.getMinutes(), ss: dt.getSeconds(),
    };
  }
  const parts = {};
  for (const p of new Intl.DateTimeFormat('en-US', {
    timeZone: householdTz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(dt)) parts[p.type] = p.value;
  return {
    y: Number(parts.year), m: Number(parts.month), d: Number(parts.day),
    // Some engines render midnight as hour 24 rather than 00.
    hh: Number(parts.hour) % 24, mm: Number(parts.minute), ss: Number(parts.second),
  };
}

/** "YYYY-MM-DD" -> { y, m, d } with m being 1-12. */
export function parse(str) {
  const [y, m, d] = String(str).split('-').map(Number);
  return { y, m, d };
}

export function isDateStr(str) {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const { y, m, d } = parse(str);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/** Date object (local) -> "YYYY-MM-DD". */
export function toStr(dt) {
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

/** Local Date at noon, which keeps DST transitions from shifting the day. */
export function toDate(str) {
  const { y, m, d } = parse(str);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function todayStr() {
  const { y, m, d } = partsNow();
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * Milliseconds until just after the next local midnight.
 *
 * Built with the (year, month, day) constructor and a day added by `setDate`,
 * so it is right across a DST boundary where "24 hours from now" is not. The
 * few seconds of margin keep a timer that fires a hair early from waking up
 * on the same date it started on.
 */
export function msUntilTomorrow() {
  if (!householdTz) {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5, 0);
    return Math.max(1000, next.getTime() - now.getTime());
  }
  /* Counted from the household's wall clock rather than constructed as a
   * local Date, because the target midnight is in another zone. A DST shift
   * there can make this an hour out; that is tolerable because the timer only
   * asks "has the date changed?" and js/main.js re-asks on every wake and
   * focus anyway. Capped at six hours so a wrong answer is re-checked rather
   * than believed until tomorrow. */
  const { hh, mm, ss } = partsNow();
  const elapsed = ((hh * 60 + mm) * 60 + ss) * 1000;
  return Math.min(6 * 3600_000, Math.max(1000, 86_400_000 - elapsed + 5000));
}

export function nowIso() {
  return new Date().toISOString();
}

/** Current wall clock as "HH:MM", in the household's zone. */
export function nowTime() {
  const { hh, mm } = partsNow();
  return `${pad(hh)}:${pad(mm)}`;
}

/** Minutes since the household's midnight. Used for the `Now` marker. */
export function nowMinutes() {
  const { hh, mm } = partsNow();
  return hh * 60 + mm;
}

export function addDays(str, n) {
  const dt = toDate(str);
  dt.setDate(dt.getDate() + n);
  return toStr(dt);
}

/** Whole days from `a` to `b`. Negative when b is before a. */
export function daysBetween(a, b) {
  const A = parse(a), B = parse(b);
  // Treating local calendar parts as UTC makes every day exactly 24h long,
  // which is what we want for counting days. No timezone is implied.
  const ms = Date.UTC(B.y, B.m - 1, B.d) - Date.UTC(A.y, A.m - 1, A.d);
  return Math.round(ms / 86400000);
}

/** 0 = Sunday. */
export function dayOfWeek(str) {
  return toDate(str).getDay();
}

export const isBefore = (a, b) => a < b;   // safe: ISO date strings sort lexically
export const isAfter = (a, b) => a > b;
export const min = (a, b) => (a <= b ? a : b);
export const max = (a, b) => (a >= b ? a : b);

export function startOfMonth(year, month /* 1-12 */) {
  return `${year}-${pad(month)}-01`;
}

export function daysInMonth(year, month /* 1-12 */) {
  return new Date(year, month, 0).getDate();
}

/**
 * Six weeks of dates covering the given month, always starting on a Sunday, so
 * the calendar grid never reflows between months.
 * Returns [{ date, inMonth }].
 */
export function monthGrid(year, month /* 1-12 */) {
  const first = startOfMonth(year, month);
  const lead = dayOfWeek(first);
  const cells = [];
  let cursor = addDays(first, -lead);
  for (let i = 0; i < 42; i += 1) {
    cells.push({ date: cursor, inMonth: parse(cursor).m === month });
    cursor = addDays(cursor, 1);
  }
  return cells;
}

/** "08:00" -> minutes since midnight, for sorting slots. */
export function timeToMinutes(time) {
  const [h, m] = String(time).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** "08:00" -> "8:00 am". Kept simple and explicit rather than Intl-dependent. */
export function formatTime(time) {
  const [h, m] = String(time).split(':').map(Number);
  const suffix = h < 12 ? 'am' : 'pm';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${pad(m)} ${suffix}`;
}

/** "2026-08-30" -> "Sunday 30 August". */
export function formatLong(str, monthNames, weekdayNames) {
  const { m, d } = parse(str);
  return `${weekdayNames[dayOfWeek(str)]} ${d} ${monthNames[m - 1]}`;
}
