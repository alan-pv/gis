import { describe, it, expect } from 'vitest'
import { domSegmentMeasure } from './measure-text.js'

describe('domSegmentMeasure: no stale cache in a shared ctx', () => {
  it('sets the font even if another measurer changed ctx.font between calls', () => {
    // fake ctx: the width depends on the current font (size × number of characters).
    const ctx = {
      font: '',
      measureText(t: string): { width: number } {
        const px = Number(/(\d+)px/.exec(this.font)![1])
        return { width: t.length * px }
      },
    } as { font: string; measureText(t: string): { width: number } } as unknown as CanvasRenderingContext2D
    const a = domSegmentMeasure(ctx, 18, 'normal')
    const b = domSegmentMeasure(ctx, 12, 'normal')
    expect(a('abcd', false)).toBe(72)
    expect(b('abcd', false)).toBe(48)
    // a measures again: it used to keep the font of b (48).
    expect(a('abcd', false)).toBe(72)
  })
})
