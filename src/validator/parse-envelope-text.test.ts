/**
 * Tests of the parseEnvelopeText helper.
 */
import { describe, it, expect } from 'vitest'
import { parseEnvelopeText } from './parse-envelope-text.js'

describe('parseEnvelopeText', () => {
  // ── Success cases ─────────────────────────────────────────────────────────

  it('accepts a valid JSON object', () => {
    const text = JSON.stringify({ schema_version: '1.0', operations: [] })
    const result = parseEnvelopeText(text)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.envelope).toEqual({ schema_version: '1.0', operations: [] })
    }
  })

  it('accepts a JSON object with whitespace and line breaks (pretty-printed)', () => {
    const text = JSON.stringify({ schema_version: '1.0', operations: [] }, null, 2)
    const result = parseEnvelopeText(text)
    expect(result.ok).toBe(true)
  })

  it('accepts an empty object {}', () => {
    const result = parseEnvelopeText('{}')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.envelope).toEqual({})
    }
  })

  // ── Malformed JSON ────────────────────────────────────────────────────────

  it('rejects malformed JSON (trailing comma)', () => {
    const result = parseEnvelopeText('{ "a": 1, }')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/Invalid JSON/i)
    }
  })

  it('rejects an empty string', () => {
    const result = parseEnvelopeText('')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/Invalid JSON/i)
    }
  })

  it('rejects plain text that is not JSON', () => {
    const result = parseEnvelopeText('this is not json')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/Invalid JSON/i)
    }
  })

  // ── Non-object literals ───────────────────────────────────────────────────

  it('rejects a number', () => {
    const result = parseEnvelopeText('42')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/JSON object/i)
    }
  })

  it('rejects an array', () => {
    const result = parseEnvelopeText('[1, 2, 3]')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/JSON object/i)
    }
  })

  it('rejects null', () => {
    const result = parseEnvelopeText('null')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/JSON object/i)
    }
  })

  it('rejects a boolean', () => {
    const result = parseEnvelopeText('true')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/JSON object/i)
    }
  })

  it('rejects a JSON string', () => {
    const result = parseEnvelopeText('"hello"')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/JSON object/i)
    }
  })
})
