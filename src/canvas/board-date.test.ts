/**
 * Tests for board-date.ts: pure formatting of the automatic board date.
 */
import { describe, it, expect } from 'vitest'
import { formatBoardDate } from './board-date.js'

describe('formatBoardDate', () => {
  it('formats as "Weekday, Month day" in en-US (fixed date)', () => {
    expect(formatBoardDate(new Date(2026, 10, 10))).toBe('Tuesday, November 10')
  })

  it('does not zero-pad the day and has no year', () => {
    expect(formatBoardDate(new Date(2025, 11, 5))).toBe('Friday, December 5')
  })
})
