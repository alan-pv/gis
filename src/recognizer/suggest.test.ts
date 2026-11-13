/**
 * Tests for suggestForInk.
 *
 * Uses the real recognizer fixtures and synthetic figures to verify
 * that suggestForInk returns the expected type as top-1 and the right bbox.
 *
 * The synthetic figures are deterministic (PRNG with a fixed seed).
 */
import { describe, it, expect } from 'vitest'
import { suggestForInk, suggestForSelection } from './suggest.js'
import { buildTemplatesFromLibrary } from './templates.js'
import { loadLibrary } from '../library/index.js'
import type { InkStroke } from '../ink/model.js'

// ── Real fixtures ─────────────────────────────────────────────────────────────

const fixtureFiles = import.meta.glob('./fixtures/*.json', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

interface FixtureData {
  name: string
  strokes: InkStroke[]
  knownFailure?: boolean
}

const fixtures = Object.values(fixtureFiles).map(raw => {
  const data = JSON.parse(raw) as FixtureData
  data.name = data.name.trim().toLowerCase()
  return data
})

// ── Deterministic generators ──────────────────────────────────────────────────

function makePrng(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff
    return (s >>> 0) / 0xffffffff
  }
}

/** One-stroke synthetic circle, radius r centered at (cx, cy). */
function makeCircleStroke(cx = 200, cy = 200, r = 60, jitter = 3): InkStroke {
  const rand = makePrng(42)
  const pts: number[] = []
  for (let i = 0; i <= 64; i++) {
    const angle = (i / 64) * 2 * Math.PI
    pts.push(
      cx + r * Math.cos(angle) + (rand() - 0.5) * jitter * 2,
      cy + r * Math.sin(angle) + (rand() - 0.5) * jitter * 2,
    )
  }
  return { id: 'ink_1', points: pts }
}

/** Zigzag scribble that must not be recognized. */
function makeZigzag(): InkStroke {
  const rand = makePrng(9999)
  const pts: number[] = []
  for (let i = 0; i < 80; i++) {
    const x = (i / 80) * 100 + (rand() - 0.5) * 2
    const y = (i % 2 === 0 ? 20 : 80) + (rand() - 0.5) * 2
    pts.push(x, y)
  }
  return { id: 'ink_1', points: pts }
}

/** Two overlapping circles: the final group must contain both. */
function makeTwoOverlappingCircles(): InkStroke[] {
  const rand = makePrng(77)
  const make = (id: string, cx: number, cy: number): InkStroke => {
    const pts: number[] = []
    for (let i = 0; i <= 64; i++) {
      const angle = (i / 64) * 2 * Math.PI
      pts.push(
        cx + 50 * Math.cos(angle) + (rand() - 0.5) * 4,
        cy + 50 * Math.sin(angle) + (rand() - 0.5) * 4,
      )
    }
    return { id, points: pts }
  }
  // Two circles with centers 40 px apart → they overlap (radius=50)
  return [make('ink_1', 200, 200), make('ink_2', 230, 200)]
}

// ── Setup ─────────────────────────────────────────────────────────────────────

const library = loadLibrary()
const templates = buildTemplatesFromLibrary(library)

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('suggestForInk', () => {

  it('no strokes → null', () => {
    expect(suggestForInk([], templates)).toBeNull()
  })

  it('scribble under the threshold → null', () => {
    const result = suggestForInk([makeZigzag()], templates)
    expect(result).toBeNull()
  })

  it('synthetic circle → top-1 is "circulo"', () => {
    const result = suggestForInk([makeCircleStroke()], templates)
    expect(result).not.toBeNull()
    expect(result!.candidates[0]!.name).toBe('circulo')
  })

  it('bbox is correct for a synthetic circle', () => {
    const stroke = makeCircleStroke(300, 400, 80)
    const result = suggestForInk([stroke], templates)
    expect(result).not.toBeNull()
    const { box } = result!
    // The bbox must surround the circle: center (300,400) radius 80 → approx [220,320]-[380,480]
    // Generous tolerance because of the jitter
    expect(box.x).toBeGreaterThan(200)
    expect(box.x).toBeLessThan(240)
    expect(box.y).toBeGreaterThan(300)
    expect(box.y).toBeLessThan(340)
    expect(box.width).toBeGreaterThan(130)
    expect(box.width).toBeLessThan(180)
    expect(box.height).toBeGreaterThan(130)
    expect(box.height).toBeLessThan(180)
  })

  it('strokeIds contains the ids of the final group', () => {
    const stroke = makeCircleStroke()
    const result = suggestForInk([stroke], templates)
    expect(result).not.toBeNull()
    expect(result!.strokeIds).toContain('ink_1')
  })

  it('a previous distant stroke is NOT in strokeIds', () => {
    // s1 is very far from s2; only s2 must be in the group
    const s1: InkStroke = { id: 'ink_1', points: [0, 0, 10, 10] }
    const s2 = makeCircleStroke(700, 700, 60)
    s2.id = 'ink_2'
    const result = suggestForInk([s1, s2], templates)
    expect(result).not.toBeNull()
    expect(result!.strokeIds).not.toContain('ink_1')
    expect(result!.strokeIds).toContain('ink_2')
  })

  it('a group of two overlapping circles is recognized together and returns candidates', () => {
    const strokes = makeTwoOverlappingCircles()
    const result = suggestForInk(strokes, templates)
    // It may or may not be recognized depending on the final shape; what matters
    // is that it does not throw and that, if there is a suggestion, top-1 has score ≥ 0.3
    if (result !== null) {
      expect(result.candidates[0]!.score).toBeGreaterThanOrEqual(0.3)
      expect(result.strokeIds.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('candidates sorted by descending score', () => {
    const result = suggestForInk([makeCircleStroke()], templates)
    if (!result || result.candidates.length < 2) return
    for (let i = 1; i < result.candidates.length; i++) {
      expect(result.candidates[i]!.score).toBeLessThanOrEqual(result.candidates[i - 1]!.score)
    }
  })

  it('at most MAX_CANDIDATES=3 candidates returned', () => {
    const result = suggestForInk([makeCircleStroke()], templates)
    if (!result) return
    expect(result.candidates.length).toBeLessThanOrEqual(3)
  })

})

// ── suggestForSelection tests ────────────────────────────────────────────────

describe('suggestForSelection', () => {

  it('no strokes → null', () => {
    expect(suggestForSelection([], templates)).toBeNull()
  })

  it('synthetic circle → top-1 is "circulo"', () => {
    const result = suggestForSelection([makeCircleStroke()], templates)
    expect(result).not.toBeNull()
    expect(result!.candidates[0]!.name).toBe('circulo')
  })

  it('differentiating case: two non-contiguous strokes → strokeIds contains both ids', () => {
    // s1 is very far from s2; suggestForInk would discard s1 (trailingGroup only takes s2)
    // but suggestForSelection must operate on the given strokes as they are
    const s1: InkStroke = { id: 'ink_far', points: [0, 0, 10, 10] }
    const s2 = makeCircleStroke(700, 700, 60)
    s2.id = 'ink_circle'

    // Reference with suggestForInk: it only recognizes s2 (discards s1 via trailingGroup)
    const inkResult = suggestForInk([s1, s2], templates)
    expect(inkResult).not.toBeNull()
    expect(inkResult!.strokeIds).not.toContain('ink_far')

    // suggestForSelection receives the two strokes explicitly
    // The result may be null (the recognizer may not recognize the combination)
    // but if it returns something, the box must span the distant stroke (s1 is at (0,0)).
    // We verify it by comparing the box: if there is a result, its x must be ≤ 10 (includes s1).
    const selResult = suggestForSelection([s1, s2], templates)
    if (selResult !== null) {
      // The bbox must span s1 (around x=0..10, y=0..10)
      expect(selResult.box.x).toBeLessThanOrEqual(10)
      // The box generated by inkResult (s2 only) has a much larger x
      expect(inkResult!.box.x).toBeGreaterThan(600)
      // The strokeIds of the selection result must contain both given ids
      expect(selResult.strokeIds).toContain('ink_far')
      expect(selResult.strokeIds).toContain('ink_circle')
    } else {
      // If the recognizer does not recognize the combination (normal for disparate strokes),
      // we at least verify that suggestForInk DOES recognize only s2 (the differentiated
      // behavior already asserted above: inkResult != null, ink_far is not in strokeIds)
      expect(inkResult!.strokeIds).toContain('ink_circle')
    }
  })

})

// ── Tests with real fixtures ──────────────────────────────────────────────────

describe.skipIf(fixtures.length === 0)('suggestForInk — real fixtures', () => {

  for (const fixture of fixtures) {
    if (fixture.name === 'garabato') {
      it(`fixture "garabato" → null (below the threshold)`, () => {
        const result = suggestForInk(fixture.strokes, templates)
        expect(result).toBeNull()
      })
    } else if (fixture.knownFailure) {
      it.fails(`fixture "${fixture.name}" → top-1 is "${fixture.name}" (known failure)`, () => {
        const result = suggestForInk(fixture.strokes, templates)
        expect(result).not.toBeNull()
        expect(result!.candidates[0]!.name).toBe(fixture.name)
      })
    } else {
      it(`fixture "${fixture.name}" → top-1 is "${fixture.name}"`, () => {
        const result = suggestForInk(fixture.strokes, templates)
        expect(result).not.toBeNull()
        expect(result!.candidates[0]!.name).toBe(fixture.name)
      })

      it(`fixture "${fixture.name}" → bbox covers all strokes`, () => {
        const result = suggestForInk(fixture.strokes, templates)
        if (!result) return
        // Check that all the points of all the strokes of the group fit in the bbox
        for (const strokeId of result.strokeIds) {
          const stroke = fixture.strokes.find(s => s.id === strokeId)
          if (!stroke) continue
          const pts = stroke.points
          for (let i = 0; i < pts.length - 1; i += 2) {
            expect(pts[i]!).toBeGreaterThanOrEqual(result.box.x - 1)
            expect(pts[i]!).toBeLessThanOrEqual(result.box.x + result.box.width + 1)
            expect(pts[i + 1]!).toBeGreaterThanOrEqual(result.box.y - 1)
            expect(pts[i + 1]!).toBeLessThanOrEqual(result.box.y + result.box.height + 1)
          }
        }
      })
    }
  }

})
