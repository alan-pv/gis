/**
 * Paragraph-extension detection — pure module.
 *
 * A `set.text` `update` that only APPENDS text at the end (the new text starts with the
 * previous one, ignoring trailing spaces) is animated by writing only the suffix; the
 * prefix already written is left untouched.
 */

/**
 * Returns the appended suffix if `next` starts with `previous` (ignoring trailing spaces
 * of `previous`) and adds text; `null` if it is a real rewrite, if there is no previous
 * text, or if nothing is added.
 */
export function extensionSuffix(previous: string, next: string): string | null {
  const base = previous.trimEnd()
  if (base.length === 0) return null
  if (!next.startsWith(base)) return null
  const suffix = next.slice(base.length)
  return suffix.length > 0 ? suffix : null
}
