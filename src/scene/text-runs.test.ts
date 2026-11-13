import { describe, it, expect } from 'vitest'
import { displayText, layoutRuns, wordRangeInLayout } from './text-runs.js'
import { estimateTextSize, estimateSegmentMeasure } from './text-measure.js'

const m = estimateSegmentMeasure(18, false)

describe('text-runs — inline bold parser', () => {
  it('displayText applies list markers and strips the marks', () => {
    expect(displayText('**a** b\nc', 'lista')).toBe('• a b\n• c')
    expect(displayText('x **y**', 'cuerpo')).toBe('x y')
  })
})

describe('text-runs — layoutRuns', () => {
  it('markers do not count toward width or line wrapping', () => {
    const a = estimateTextSize('hello big world', 120, 'cuerpo')
    const b = estimateTextSize('hello **big** world', 120, 'cuerpo')
    // same number of lines; bold widens slightly (real weight)
    expect(b.height).toBe(a.height)
    expect(b.width).toBeGreaterThanOrEqual(a.width)
  })

  it('bold measures wider than normal weight (synthetic)', () => {
    const normal = layoutRuns('word', 'cuerpo', 1000, m).maxLineWidth
    const bold = layoutRuns('**word**', 'cuerpo', 1000, m).maxLineWidth
    expect(bold).toBeGreaterThan(normal)
  })

  it('segment indices refer to the plain text (break spaces keep their index)', () => {
    const l = layoutRuns('aa **bb** cc', 'cuerpo', 20, m)
    expect(l.plain).toBe('aa bb cc')
    expect(l.lines.map((ln) => ln.segments.map((s) => s.text).join('|'))).toEqual(['aa', 'bb', 'cc'])
    expect(l.lines[1]!.segments[0]).toMatchObject({ bold: true, start: 3 })
    expect(l.lines[2]!.segments[0]!.start).toBe(6)
  })

  it('text without marks: same lines as the classic algorithm (one segment per line)', () => {
    const l = layoutRuns('uno dos tres cuatro', 'cuerpo', 100, m)
    for (const ln of l.lines) expect(ln.segments).toHaveLength(1)
  })

  it('wordRangeInLayout finds the word without the ** and with the real weight', () => {
    const l = layoutRuns('the **water** cycle', 'cuerpo', 1000, m)
    const r = wordRangeInLayout(l, 'water', m)!
    expect(r.line).toBe(0)
    expect(r.x0).toBeCloseTo(m('the ', false), 5)
    expect(r.x1 - r.x0).toBeCloseTo(m('water', true), 5)
    expect(wordRangeInLayout(l, '**water**', m)).toBeUndefined()
  })

  it('wordRangeInLayout: word on a later line', () => {
    const l = layoutRuns('aa bb cc dd', 'cuerpo', 40, m)
    const r = wordRangeInLayout(l, 'dd', m)!
    expect(r.line).toBeGreaterThan(0)
    expect(r.x0).toBe(0)
  })
})
