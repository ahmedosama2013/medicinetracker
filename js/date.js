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
  return toStr(new Date());
}

export function nowIso() {
  return new Date().toISOString();
}

/** Current wall clock as "HH:MM". */
export function nowTime() {
  const dt = new Date();
  return `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
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

/** "2026-08-30" -> "30 August 2026". */
export function formatDate(str, monthNames) {
  const { y, m, d } = parse(str);
  return `${d} ${monthNames[m - 1]} ${y}`;
}
