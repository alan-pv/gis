/**
 * Automatic board date.
 *
 * NOT a contract or scene object: it is app chrome, painted by SceneCanvas to
 * the right of the title band. This module only formats the date, purely and
 * testably; SceneCanvas calls it with `new Date()`.
 */

/**
 * Formats a date in US English as "Tuesday, November 10" (long weekday, long
 * month, day of month; no year — the board is a daily surface).
 *
 * Pure and deterministic: same date → same string. Uses the local date
 * components (the teacher's wall clock), via `Intl` with an explicit `en-US`
 * locale so the result does not depend on the browser language.
 *
 * @param date  Date to format (e.g. `new Date()`).
 */
export function formatBoardDate(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}
