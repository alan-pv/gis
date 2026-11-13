/**
 * Tests for the $P figure recognition module.
 *
 * All tests are deterministic: synthetic figures are generated with
 * parametric functions + seeded jitter (no unseeded Math.random).
 *
 * Sections:
 *  1. Normalization (resample, invariance)
 *  2. Templates (buildTemplatesFromLibrary with the real library)
 *  3. Synthetic recognition (circle, triangle, rectangle, multistroke sun)
 *  4. Scribble (must return [] with DEFAULT_THRESHOLD)
 *  5. Latency (<50ms average for ~500 points against the whole library)
 *  6. Degenerate cases (never throws)
 *  7. Real fixtures (skipped if the folder is empty)
 */
import { describe, it, expect } from 'vitest'
import {
  normalize, N_POINTS, resample,
  recognize, DEFAULT_THRESHOLD,
  buildTemplatesFromLibrary,
} from './index.js'
import type { CloudPoint, RecognizerTemplate } from './index.js'
import { loadLibrary } from '../library/index.js'
import type { InkStroke } from '../ink/index.js'

// ── Deterministic generators of synthetic figures ─────────────────────────────

/** Linear congruential PRNG — fixed seed for reproducibility. */
function makePrng(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff
    return (s >>> 0) / 0xffffffff
  }
}

/** One-stroke circle: N equidistant points on the perimeter + jitter. */
function makeCirle(r = 50, cx = 50, cy = 50, n = 64, jitter = 3): InkStroke {
  const rand = makePrng(42)
  const pts: number[] = []
  for (let i = 0; i <= n; i++) {
    const angle = (i / n) * 2 * Math.PI
    pts.push(
      cx + r * Math.cos(angle) + (rand() - 0.5) * jitter * 2,
      cy + r * Math.sin(angle) + (rand() - 0.5) * jitter * 2,
    )
  }
  return { id: 'ink_1', points: pts }
}

/** One-stroke triangle: 3 vertices with interpolation + jitter. */
function makeTriangle(size = 80, jitter = 2): InkStroke {
  const rand = makePrng(13)
  const cx = 50, cy = 50
  const verts = [
    [cx, cy - size / 2],
    [cx + size / 2, cy + size / 2],
    [cx - size / 2, cy + size / 2],
  ] as const
  const pts: number[] = []
  const steps = 20
  for (let vi = 0; vi < 3; vi++) {
    const [ax, ay] = verts[vi]!
    const [bx, by] = verts[(vi + 1) % 3]!
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      pts.push(
        ax + t * (bx - ax) + (rand() - 0.5) * jitter * 2,
        ay + t * (by - ay) + (rand() - 0.5) * jitter * 2,
      )
    }
  }
  return { id: 'ink_1', points: pts }
}

/**
 * One-stroke rectangle: 4 sides with interpolation + jitter.
 * Uses a square shape (x0=5, y0=5, x1=95, y1=95) like rectangulo.svg
 * which has viewBox 0 0 100 100 with path "M 5 5 L 95 5 L 95 95 L 5 95 Z".
 * A rectangle with proportions far from 1:1 normalizes differently
 * and may be confused with other shapes in the point cloud.
 */
function makeRectangle(jitter = 2): InkStroke {
  const rand = makePrng(7)
  const x0 = 5, y0 = 5, x1 = 95, y1 = 95
  const verts = [
    [x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0],
  ] as const
  const pts: number[] = []
  const steps = 20
  for (let vi = 0; vi + 1 < verts.length; vi++) {
    const [ax, ay] = verts[vi]!
    const [bx, by] = verts[vi + 1]!
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      pts.push(
        ax + t * (bx - ax) + (rand() - 0.5) * jitter * 2,
        ay + t * (by - ay) + (rand() - 0.5) * jitter * 2,
      )
    }
  }
  return { id: 'ink_1', points: pts }
}

/**
 * Multistroke sun: uses the real coordinates of the library SVG with jitter.
 * sol.svg viewBox 0 0 120 120: body (circle ~center 60,55 radius 25) + 10 rays.
 * This geometric fidelity is what validates the native multistroke of $P:
 * the reason $P was chosen over $1.
 */
function makeSun(jitter = 2): InkStroke[] {
  const rand = makePrng(99)
  const strokes: InkStroke[] = []

  // Stroke 0: circular body (approx. center 60,55, radius 25)
  const cx = 60, cy = 55, r = 25
  const circPts: number[] = []
  for (let i = 0; i <= 40; i++) {
    const angle = (i / 40) * 2 * Math.PI
    circPts.push(
      cx + r * Math.cos(angle) + (rand() - 0.5) * jitter * 2,
      cy + r * Math.sin(angle) + (rand() - 0.5) * jitter * 2,
    )
  }
  strokes.push({ id: 'ink_1', points: circPts })

  // Strokes 1-10: ray coordinates taken from the real SVG
  const rayCoords: readonly [number, number, number, number][] = [
    [60, 5, 60, 22],
    [87.4, 17.6, 76.0, 30.4],
    [107, 44, 90, 49],
    [107, 66, 90, 61],
    [87.4, 92.4, 76.0, 79.6],
    [60, 115, 60, 88],
    [32.6, 92.4, 44.0, 79.6],
    [13, 66, 30, 61],
    [13, 44, 30, 49],
    [32.6, 17.6, 44.0, 30.4],
  ]
  for (let ri = 0; ri < rayCoords.length; ri++) {
    const [x1, y1, x2, y2] = rayCoords[ri]!
    const rayPts = [
      x1 + (rand() - 0.5) * jitter * 2,
      y1 + (rand() - 0.5) * jitter * 2,
      x2 + (rand() - 0.5) * jitter * 2,
      y2 + (rand() - 0.5) * jitter * 2,
    ]
    strokes.push({ id: `ink_${ri + 2}`, points: rayPts })
  }

  return strokes
}

/** Dense zigzag: a scribble that must not be recognized. */
function makeZigzag(n = 80, jitter = 1): InkStroke {
  const rand = makePrng(1234)
  const pts: number[] = []
  for (let i = 0; i < n; i++) {
    const x = (i / n) * 100 + (rand() - 0.5) * jitter * 2
    const y = (i % 2 === 0 ? 20 : 80) + (rand() - 0.5) * jitter * 2
    pts.push(x, y)
  }
  return { id: 'ink_1', points: pts }
}

// ── 1. Normalization ──────────────────────────────────────────────────────────

describe('$P normalization', () => {

  it('resample returns exactly N_POINTS points', () => {
    const pts: CloudPoint[] = []
    for (let i = 0; i < 100; i++) {
      pts.push({ x: i, y: Math.sin(i * 0.1) * 20, strokeId: 0 })
    }
    const result = resample(pts, N_POINTS)
    expect(result).toHaveLength(N_POINTS)
  })

  it('resample does not interpolate between distinct strokes', () => {
    // Two separated strokes: the gap must not generate interpolated points between strokeId 0 and strokeId 1
    const pts: CloudPoint[] = [
      { x: 0, y: 0, strokeId: 0 },
      { x: 10, y: 0, strokeId: 0 },
      // gap: strokeId changes to 1 (far-apart coordinates)
      { x: 100, y: 0, strokeId: 1 },
      { x: 110, y: 0, strokeId: 1 },
    ]
    const result = resample(pts, N_POINTS)
    // No point of strokeId 0 may have x > 10 (it cannot have interpolated up to strokeId 1)
    for (const p of result) {
      if (p.strokeId === 0) {
        expect(p.x).toBeLessThanOrEqual(10.5) // numeric tolerance of interpolation
      }
    }
    expect(result).toHaveLength(N_POINTS)
  })

  it('invariance: the same gesture translated +500,+300 and scaled ×3 produces an almost identical cloud', () => {
    // Base gesture: circle of radius 30 centered at (50,50)
    const base: CloudPoint[] = []
    for (let i = 0; i < 60; i++) {
      const angle = (i / 60) * 2 * Math.PI
      base.push({ x: 50 + 30 * Math.cos(angle), y: 50 + 30 * Math.sin(angle), strokeId: 0 })
    }

    // Same gesture translated +500,+300 and scaled ×3
    const transformed: CloudPoint[] = base.map(p => ({
      x: (p.x + 500) * 3,
      y: (p.y + 300) * 3,
      strokeId: 0,
    }))

    const n1 = normalize(base)
    const n2 = normalize(transformed)

    expect(n1).toHaveLength(N_POINTS)
    expect(n2).toHaveLength(N_POINTS)

    // Compare point by point with numeric tolerance
    for (let i = 0; i < N_POINTS; i++) {
      expect(n1[i]!.x).toBeCloseTo(n2[i]!.x, 5)
      expect(n1[i]!.y).toBeCloseTo(n2[i]!.y, 5)
    }
  })

})

// ── 2. Templates ──────────────────────────────────────────────────────────────

describe('buildTemplatesFromLibrary', () => {
  const library = loadLibrary()
  const templates = buildTemplatesFromLibrary(library)

  it('produces at least 10 templates (one per SVG object)', () => {
    // The library has 13 objects, 1 is text → 12 SVG templates
    expect(templates.length).toBeGreaterThanOrEqual(10)
  })

  it('includes sol, nube, circulo', () => {
    const names = new Set(templates.map(t => t.name))
    expect(names.has('sol')).toBe(true)
    expect(names.has('nube')).toBe(true)
    expect(names.has('circulo')).toBe(true)
  })

  it('excludes texto (render:"text", null svg)', () => {
    const names = templates.map(t => t.name)
    expect(names.includes('texto')).toBe(false)
  })

  it('every template has exactly N_POINTS points', () => {
    for (const t of templates) {
      expect(t.points, `plantilla "${t.name}"`).toHaveLength(N_POINTS)
    }
  })

  it('every template has a centroid ≈ (0,0)', () => {
    for (const t of templates) {
      let cx = 0, cy = 0
      for (const p of t.points) { cx += p.x; cy += p.y }
      cx /= t.points.length
      cy /= t.points.length
      expect(cx, `centroid x of "${t.name}"`).toBeCloseTo(0, 5)
      expect(cy, `centroid y of "${t.name}"`).toBeCloseTo(0, 5)
    }
  })

})

// ── 3. Synthetic recognition ──────────────────────────────────────────────────

describe('synthetic recognition', () => {
  const library = loadLibrary()
  const templates = buildTemplatesFromLibrary(library)

  it('one-stroke circle → top-1 is "circulo"', () => {
    const candidates = recognize([makeCirle()], templates)
    expect(candidates.length).toBeGreaterThan(0)
    expect(candidates[0]!.name).toBe('circulo')
  })

  it('triangle → top-1 is "triangulo"', () => {
    const candidates = recognize([makeTriangle()], templates)
    expect(candidates.length).toBeGreaterThan(0)
    expect(candidates[0]!.name).toBe('triangulo')
  })

  it('rectangle → top-1 is "rectangulo"', () => {
    const candidates = recognize([makeRectangle()], templates)
    expect(candidates.length).toBeGreaterThan(0)
    expect(candidates[0]!.name).toBe('rectangulo')
  })

  it('multistroke sun (body + 10 rays with real SVG coordinates) → top-1 is "sol"', () => {
    // Validates native multistroke: the reason $P was chosen over $1.
    // The strokes replicate the geometry of the library's sol.svg.
    const candidates = recognize(makeSun(), templates)
    expect(candidates.length).toBeGreaterThan(0)
    expect(candidates[0]!.name).toBe('sol')
  })

})

// ── 4. Scribble ───────────────────────────────────────────────────────────────

describe('scribble', () => {
  const library = loadLibrary()
  const templates = buildTemplatesFromLibrary(library)

  it('dense random zigzag (fixed seed) → [] with DEFAULT_THRESHOLD', () => {
    const candidates = recognize([makeZigzag()], templates, { threshold: DEFAULT_THRESHOLD })
    expect(candidates).toHaveLength(0)
  })

})

// ── 5. Latency ────────────────────────────────────────────────────────────────

describe('latency', () => {
  const library = loadLibrary()
  const templates = buildTemplatesFromLibrary(library)

  it('multistroke gesture of ~500 raw points against all templates, 10 repetitions, average < 50ms', () => {
    // Build a multistroke gesture with ~500 points: dense sun + extra strokes
    const sunStrokes = makeSun(1) // minimal jitter so it still looks like a sun

    // Add extra strokes with more points to reach ~500 in total
    const rand = makePrng(555)
    const extraStrokes: InkStroke[] = []
    for (let ri = 0; ri < 5; ri++) {
      const pts: number[] = []
      // Dense circles: 80 points each
      for (let i = 0; i < 80; i++) {
        const angle = (i / 80) * 2 * Math.PI
        pts.push(
          60 + 20 * Math.cos(angle) + (rand() - 0.5) * 2,
          60 + 20 * Math.sin(angle) + (rand() - 0.5) * 2,
        )
      }
      extraStrokes.push({ id: `extra_${ri}`, points: pts })
    }
    const allStrokes = [...sunStrokes, ...extraStrokes]

    const totalPts = allStrokes.reduce((sum, s) => sum + s.points.length / 2, 0)
    expect(totalPts).toBeGreaterThan(400) // check we have enough points

    const REPS = 10
    const start = performance.now()
    for (let i = 0; i < REPS; i++) {
      recognize(allStrokes, templates)
    }
    const elapsed = performance.now() - start
    const avgMs = elapsed / REPS

    // Generous bound for CI; the real budget is "do not freeze the canvas when the stroke is released"
    expect(avgMs).toBeLessThan(50)
  })

})

// ── 6. Degenerate cases ───────────────────────────────────────────────────────

describe('degenerate cases', () => {
  const templates: RecognizerTemplate[] = [
    { name: 'test', points: normalize([{ x: 0, y: 0, strokeId: 0 }, { x: 1, y: 1, strokeId: 0 }]) },
  ]

  it('[] with zero strokes → []', () => {
    expect(recognize([], templates)).toHaveLength(0)
  })

  it('a single-point stroke → []', () => {
    const stroke: InkStroke = { id: 'ink_1', points: [10, 20] }
    expect(recognize([stroke], templates)).toHaveLength(0)
  })

  it('a stroke of 2 identical points → does not throw', () => {
    const stroke: InkStroke = { id: 'ink_1', points: [5, 5, 5, 5] }
    expect(() => recognize([stroke], templates)).not.toThrow()
  })

  it('empty templates → []', () => {
    const stroke: InkStroke = { id: 'ink_1', points: [0, 0, 10, 10, 20, 0] }
    expect(recognize([stroke], [])).toHaveLength(0)
  })

})

// ── 7. Real fixtures ──────────────────────────────────────────────────────────

// Eager load of all the fixture JSONs (import.meta.glob as in library/loader.ts)
const fixtureFiles = import.meta.glob('./fixtures/*.json', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

interface FixtureData {
  name: string
  strokes: InkStroke[]
  /** If true, top-1 fails because of a known limitation of the recognizer. */
  knownFailure?: boolean
}

const fixtureEntries: FixtureData[] = Object.values(fixtureFiles).map(raw => {
  const data = JSON.parse(raw) as FixtureData
  // Normalize the name: trim spaces and lowercase so it
  // matches the library names (always lowercase).
  data.name = data.name.trim().toLowerCase()
  return data
})

describe.skipIf(fixtureEntries.length === 0)('real fixtures', () => {
  const library = loadLibrary()
  const templates = buildTemplatesFromLibrary(library)

  for (const fixture of fixtureEntries) {
    if (fixture.name === 'garabato') {
      it(`scribble (strokes: ${fixture.strokes.length}) → []`, () => {
        const candidates = recognize(fixture.strokes, templates, { threshold: DEFAULT_THRESHOLD })
        expect(candidates).toHaveLength(0)
      })
    } else if (fixture.knownFailure) {
      // Known limitation of $P: rays drawn in a single continuous stroke
      // produce a dense ring of connectors and the figure is confused with
      // `circulo`. If the recognizer improves and this test starts to pass,
      // vitest will fail, signaling that the `knownFailure` flag should be removed.
      it.fails(`fixture "${fixture.name}" → top-1 is "${fixture.name}" (known failure)`, () => {
        const candidates = recognize(fixture.strokes, templates)
        expect(candidates.length).toBeGreaterThan(0)
        expect(candidates[0]!.name).toBe(fixture.name)
      })
    } else {
      it(`fixture "${fixture.name}" → top-1 is "${fixture.name}"`, () => {
        const candidates = recognize(fixture.strokes, templates)
        expect(candidates.length).toBeGreaterThan(0)
        expect(candidates[0]!.name).toBe(fixture.name)
      })
    }
  }

})
