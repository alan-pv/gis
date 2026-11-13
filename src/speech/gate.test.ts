/**
 * gate.test.ts — tests for the deterministic heuristic gate.
 */

import { describe, expect, it } from 'vitest'
import { gateClause } from './gate.js'

describe('gateClause', () => {
  // 1. A drawable clause passes with reason ok.
  it('drawable clause passes with reason ok', () => {
    const result = gateClause('the sun heats the sea')
    expect(result.pass).toBe(true)
    expect(result.reason).toBe('ok')
    // 'sun', 'heats', 'sea' — articles are ignored
    expect(result.contentWords).toBe(3)
  })

  // 2. Empty or whitespace-only text → empty.
  it('empty or whitespace-only text → empty', () => {
    const r1 = gateClause('')
    expect(r1.pass).toBe(false)
    expect(r1.reason).toBe('empty')

    const r2 = gateClause('   ')
    expect(r2.pass).toBe(false)
    expect(r2.reason).toBe('empty')
  })

  // 3. Only fillers → no-content.
  // Every token ("uh", "this", "well", "um") is in the list.
  it('only fillers → no-content', () => {
    const result = gateClause('uh, this, well, um')
    expect(result.pass).toBe(false)
    expect(result.reason).toBe('no-content')
    expect(result.contentWords).toBe(0)
  })

  // 4. A lone interjection → no-content.
  it('lone interjection → no-content', () => {
    const result = gateClause('hmm')
    expect(result.pass).toBe(false)
    expect(result.reason).toBe('no-content')
  })

  // 5. A single content word passes.
  it('a single content word passes', () => {
    const result = gateClause('clouds')
    expect(result.pass).toBe(true)
    expect(result.contentWords).toBe(1)
  })

  // 6. A phrase with a motion verb passes.
  it('phrase with a motion verb passes', () => {
    // 'and' is ignored; 'rises' is content
    const result = gateClause('and rises')
    expect(result.pass).toBe(true)
  })

  // 7. ASR noise passes and is NOT modified.
  it('ASR noise passes and is NOT modified', () => {
    const t = 'eva poration'
    const result = gateClause(t)
    expect(result.pass).toBe(true)
    // The input must not have been mutated
    expect(t).toBe('eva poration')
    // 'eva' and 'poration' count as content (they are not in the list)
  })

  // 8. Case normalization on fillers.
  it('case normalization on fillers', () => {
    const result = gateClause('WELL, OKAY')
    expect(result.pass).toBe(false)
    expect(result.reason).toBe('no-content')
  })

  // 9. A single-letter token does not count as content.
  it('single-letter token does not count as content', () => {
    // 'x' has length 1 < minContentChars 2: not in the ignore list but too short
    const result = gateClause('x')
    expect(result.pass).toBe(false)
    expect(result.reason).toBe('no-content')
  })

  // 10. The water-cycle clauses in a row all pass.
  it('water-cycle clauses in a row all pass', () => {
    const clauses = [
      'the sun heats the sea',
      'the water evaporates and rises',
      'forms clouds',
    ]
    for (const c of clauses) {
      expect(gateClause(c).pass, `expected clause to pass: "${c}"`).toBe(true)
    }
  })

  // 11. Custom options: minContentChars override.
  it('custom options: minContentChars override', () => {
    // 'ab' has 2 chars; with minContentChars: 3 it must fail
    const result = gateClause('ab', { minContentChars: 3 })
    expect(result.pass).toBe(false)
  })
})
