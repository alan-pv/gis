/**
 * parse-envelope-text.ts — pure helper for the dev text box.
 *
 * Turns a string pasted by the user into a candidate envelope object. It only
 * does shallow parsing: valid JSON and a non-null, non-array object. Schema
 * validation is left to the validator (inside applyEnvelope) to avoid duplicating it.
 */

export type ParseResult =
  | { ok: true; envelope: unknown }
  | { ok: false; error: string }

/**
 * Parses the text of the dev text box.
 *
 * Returns `{ ok: true, envelope }` if the text is valid JSON and the result is a
 * non-null, non-array object; otherwise `{ ok: false, error }` with a message.
 */
export function parseEnvelopeText(text: string): ParseResult {
  let parsed: unknown

  try {
    parsed = JSON.parse(text)
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    return { ok: false, error: `Invalid JSON: ${detail}` }
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'The value must be a JSON object (not null, not an array)' }
  }

  return { ok: true, envelope: parsed }
}
