/**
 * Tests for trailingGroup.
 *
 * Verifies the grouping of contiguous final strokes for the $P recognizer.
 * All tests are deterministic (no Math.random).
 */
import { describe, it, expect } from 'vitest'
import { trailingGroup } from './grouping.js'
import type { InkStroke } from './model.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Creates a square stroke (bbox) centered at (cx, cy) with half-side `half`. */
function makeSquareStroke(id: string, cx: number, cy: number, half: number): InkStroke {
  return {
    id,
    points: [
      cx - half, cy - half,
      cx + half, cy - half,
      cx + half, cy + half,
      cx - half, cy + half,
    ],
  }
}

/** Creates a two-point stroke (a line). */
function makeLine(id: string, x1: number, y1: number, x2: number, y2: number): InkStroke {
  return { id, points: [x1, y1, x2, y2] }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('trailingGroup', () => {

  it('empty list → []', () => {
    expect(trailingGroup([])).toEqual([])
  })

  it('a single stroke → [that stroke]', () => {
    const s = makeLine('ink_1', 10, 10, 50, 50)
    const result = trailingGroup([s])
    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe('ink_1')
  })

  it('two overlapping strokes form a group', () => {
    // Stroke 1: bbox [0,0]-[50,50]; stroke 2: bbox [30,30]-[80,80]
    // They overlap directly → same group
    const s1 = makeSquareStroke('ink_1', 25, 25, 25)   // [0,0]-[50,50]
    const s2 = makeSquareStroke('ink_2', 55, 55, 25)   // [30,30]-[80,80]
    const result = trailingGroup([s1, s2])
    expect(result).toHaveLength(2)
    expect(result.map(s => s.id)).toEqual(['ink_1', 'ink_2'])
  })

  it('a distant stroke is NOT included in the group (breaks the chain)', () => {
    // s1 at (25,25), s2 at (300,300): very far apart
    const s1 = makeSquareStroke('ink_1', 25, 25, 25)
    const s2 = makeSquareStroke('ink_2', 300, 300, 25)
    const result = trailingGroup([s1, s2])
    // Only the last stroke (s2) is in the group
    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe('ink_2')
  })

  it('three consecutive overlapping strokes form a group', () => {
    // s1 at (25,25), s2 at (75,25), s3 at (125,25): each touches the next
    const s1 = makeLine('ink_1', 0, 0, 50, 50)       // bbox [0,0]-[50,50]
    const s2 = makeLine('ink_2', 50, 0, 100, 50)     // bbox [50,0]-[100,50]
    const s3 = makeLine('ink_3', 100, 0, 150, 50)    // bbox [100,0]-[150,50]
    const result = trailingGroup([s1, s2, s3])
    expect(result).toHaveLength(3)
    expect(result.map(s => s.id)).toEqual(['ink_1', 'ink_2', 'ink_3'])
  })

  it('overlapping strokes with a chain broken in the middle: only the final segment', () => {
    // s1 and s2 are together, s3 is far away, s4 is next to s3
    const s1 = makeLine('ink_1', 0, 0, 50, 50)
    const s2 = makeLine('ink_2', 30, 0, 80, 50)
    const s3 = makeLine('ink_3', 500, 500, 550, 550)  // lejos
    const s4 = makeLine('ink_4', 520, 500, 570, 550)  // cerca de s3
    const result = trailingGroup([s1, s2, s3, s4])
    // The chain breaks at s3; the final group is [s3, s4]
    expect(result.map(s => s.id)).toEqual(['ink_3', 'ink_4'])
  })

  it('margin respected: a stroke just inside the margin is included', () => {
    // s1 bbox [0,0]-[50,50], s2 bbox [74,0]-[124,50]
    // Horizontal distance between the bboxes = 74 - 50 = 24 px → exactly the margin
    const s1 = makeLine('ink_1', 0, 0, 50, 50)
    const s2 = makeLine('ink_2', 74, 0, 124, 50)
    const result = trailingGroup([s1, s2], 24)
    // With margin=24, the expanded bbox of s1 reaches x=74 → intersects the start of s2
    expect(result).toHaveLength(2)
  })

  it('margin respected: a stroke just outside the margin is NOT included', () => {
    // s1 bbox [0,0]-[50,50], s2 bbox [75,0]-[125,50]
    // Horizontal distance = 25 px > margin 24 → no intersection
    const s1 = makeLine('ink_1', 0, 0, 50, 50)
    const s2 = makeLine('ink_2', 75, 0, 125, 50)
    const result = trailingGroup([s1, s2], 24)
    // Only the last stroke is included
    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe('ink_2')
  })

  it('returns the strokes in drawing order (not reversed)', () => {
    // Three overlapping strokes; the result must be [s1, s2, s3], not [s3, s2, s1]
    const s1 = makeLine('ink_1', 0, 0, 50, 50)
    const s2 = makeLine('ink_2', 30, 0, 80, 50)
    const s3 = makeLine('ink_3', 60, 0, 110, 50)
    const result = trailingGroup([s1, s2, s3])
    expect(result.map(s => s.id)).toEqual(['ink_1', 'ink_2', 'ink_3'])
  })

})
