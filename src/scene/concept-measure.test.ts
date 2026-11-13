import { describe, it, expect } from 'vitest'
import { estimateConceptLayout, CONCEPT_DIAMETER, CONCEPT_MAX_LINES, CONCEPT_FONT_MIN } from './concept-measure.js'

describe('concept-measure — circle with its name inside', () => {
  it('the diameter is the same for any name and any cap', () => {
    for (const label of ['Sun', 'Water vapor', 'Precipitation', 'Photosynthesis in green plants and trees']) {
      expect(estimateConceptLayout(label, 400).diameter).toBe(CONCEPT_DIAMETER)
      expect(estimateConceptLayout(label, 100).diameter).toBe(CONCEPT_DIAMETER)
    }
  })

  it('the name wraps in ≤ 3 lines and the font shrinks before the box grows', () => {
    for (const label of ['Water vapor in the air', 'The big blue sea', 'Mountain', 'Precipitation']) {
      const l = estimateConceptLayout(label, 400)
      expect(l.lines.length).toBeLessThanOrEqual(CONCEPT_MAX_LINES)
      expect(l.fontSize).toBeGreaterThanOrEqual(CONCEPT_FONT_MIN)
    }
  })

  it('the text block fits inside the circle when the font is not at its minimum', () => {
    for (const label of ['Sun', 'Water cycle', 'Mountain range', 'Evaporation']) {
      const l = estimateConceptLayout(label, 400)
      if (l.fontSize === CONCEPT_FONT_MIN) continue
      expect(Math.hypot(l.textWidth, l.textHeight)).toBeLessThanOrEqual(l.diameter * 0.9)
    }
  })

  it('`**` markers are neither counted nor present in the plain text', () => {
    const l = estimateConceptLayout('The **Sun**', 400)
    expect(l.plain).toBe('The Sun')
  })

  it('is deterministic and the box is an integer', () => {
    const a = estimateConceptLayout('Cloud', 400)
    expect(estimateConceptLayout('Cloud', 400)).toEqual(a)
    expect(Number.isInteger(a.diameter)).toBe(true)
  })
})
