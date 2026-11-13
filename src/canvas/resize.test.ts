/**
 * Tests for resize.ts: resizing objects on the canvas.
 */
import { describe, it, expect } from 'vitest'
import { resizeBox, resizeHandles, handleAtPoint, cursorFor, MIN_OBJECT_SIZE } from './resize.js'
import type { BBox } from '@/layout/index.js'

// ── Reference box ──────────────────────────────────────────────────────────────

const BOX: BBox = { x: 100, y: 200, width: 80, height: 60 }
// right = 180, bottom = 260, cx = 140, cy = 230

// ── resizeBox: each handle moves the right edge(s) ────────────────────────────

describe('resizeBox', () => {

  describe('side handles', () => {

    it('e: only changes right/width; x and y stay fixed', () => {
      const result = resizeBox(BOX, 'e', 220, 230)
      expect(result.x).toBe(BOX.x)
      expect(result.y).toBe(BOX.y)
      expect(result.width).toBe(220 - BOX.x)   // right=220 → width=120
      expect(result.height).toBe(BOX.height)
    })

    it('w: changes x and width; right and y stay fixed', () => {
      const result = resizeBox(BOX, 'w', 80, 230)
      expect(result.x).toBe(80)
      expect(result.width).toBe(BOX.x + BOX.width - 80)  // right=180 → width=100
      expect(result.y).toBe(BOX.y)
      expect(result.height).toBe(BOX.height)
    })

    it('s: only changes height; x, y and width stay fixed', () => {
      const result = resizeBox(BOX, 's', 140, 300)
      expect(result.x).toBe(BOX.x)
      expect(result.y).toBe(BOX.y)
      expect(result.width).toBe(BOX.width)
      expect(result.height).toBe(300 - BOX.y)  // bottom=300 → height=100
    })

    it('n: changes y and height; bottom, x and width stay fixed', () => {
      const result = resizeBox(BOX, 'n', 140, 180)
      expect(result.x).toBe(BOX.x)
      expect(result.y).toBe(180)
      expect(result.width).toBe(BOX.width)
      expect(result.height).toBe(BOX.y + BOX.height - 180)  // bottom=260 → height=80
    })

  })

  describe('corner handles', () => {

    it('se: changes width and height; x and y stay fixed', () => {
      const result = resizeBox(BOX, 'se', 200, 280)
      expect(result.x).toBe(BOX.x)
      expect(result.y).toBe(BOX.y)
      expect(result.width).toBe(200 - BOX.x)   // 100
      expect(result.height).toBe(280 - BOX.y)  // 80
    })

    it('nw: changes x, y, width and height; right and bottom stay fixed', () => {
      const result = resizeBox(BOX, 'nw', 90, 190)
      expect(result.x).toBe(90)
      expect(result.y).toBe(190)
      // right=180, bottom=260 stay fixed
      expect(result.width).toBe(180 - 90)   // 90
      expect(result.height).toBe(260 - 190) // 70
    })

    it('ne: changes right and top; left and bottom stay fixed', () => {
      const result = resizeBox(BOX, 'ne', 200, 190)
      expect(result.x).toBe(BOX.x)           // left fixed
      expect(result.y).toBe(190)
      expect(result.width).toBe(200 - BOX.x) // 100
      expect(result.height).toBe(260 - 190)  // 70
    })

    it('sw: changes left and bottom; right and top stay fixed', () => {
      const result = resizeBox(BOX, 'sw', 90, 290)
      expect(result.x).toBe(90)
      expect(result.y).toBe(BOX.y)           // top fixed
      expect(result.width).toBe(180 - 90)    // 90
      expect(result.height).toBe(290 - BOX.y) // 90
    })

  })

  describe('float values: no rounding or snapping', () => {

    it('dragging e to a decimal position gives exactly width 137.4', () => {
      // BOX.x = 100; target right = 237.4 → width = 137.4
      const result = resizeBox(BOX, 'e', 237.4, 230)
      expect(result.width).toBe(137.4)
      expect(result.x).toBe(BOX.x)
    })

    it('dragging s to a decimal position gives exactly height 73.5', () => {
      // BOX.y = 200; target bottom = 273.5 → height = 73.5 (exactly representable in IEEE 754)
      const result = resizeBox(BOX, 's', 140, 273.5)
      expect(result.height).toBe(73.5)
    })

    it('dragging nw to a decimal position gives exact x and y', () => {
      const result = resizeBox(BOX, 'nw', 83.5, 191.2)
      expect(result.x).toBe(83.5)
      expect(result.y).toBe(191.2)
    })

  })

  describe('minimum floor: does not invert the box', () => {

    it('dragging e past the opposite edge leaves width at minSize', () => {
      // Drag e behind left (x=100); left+minSize=112
      const result = resizeBox(BOX, 'e', 50, 230)
      expect(result.width).toBe(MIN_OBJECT_SIZE)
      expect(result.x).toBe(BOX.x)
    })

    it('dragging w past the opposite edge leaves width at minSize', () => {
      // Drag w past right (x+w=180); right-minSize=168
      const result = resizeBox(BOX, 'w', 200, 230)
      expect(result.width).toBe(MIN_OBJECT_SIZE)
    })

    it('dragging s past the top edge leaves height at minSize', () => {
      // BOX.y=200; top+minSize=212
      const result = resizeBox(BOX, 's', 140, 100)
      expect(result.height).toBe(MIN_OBJECT_SIZE)
      expect(result.y).toBe(BOX.y)
    })

    it('dragging n past the bottom edge leaves height at minSize', () => {
      // bottom=260; bottom-minSize=248
      const result = resizeBox(BOX, 'n', 140, 300)
      expect(result.height).toBe(MIN_OBJECT_SIZE)
    })

    it('width is never negative or zero', () => {
      const result = resizeBox(BOX, 'e', BOX.x - 100, 230)
      expect(result.width).toBeGreaterThanOrEqual(MIN_OBJECT_SIZE)
    })

    it('height is never negative or zero', () => {
      const result = resizeBox(BOX, 's', 140, BOX.y - 100)
      expect(result.height).toBeGreaterThanOrEqual(MIN_OBJECT_SIZE)
    })

  })

})

// ── resizeHandles: positions of the 8 handles ─────────────────────────────────

describe('resizeHandles', () => {

  it('returns 8 handles', () => {
    expect(resizeHandles(BOX)).toHaveLength(8)
  })

  it('handles at the right positions', () => {
    const pts = resizeHandles(BOX)
    const map = new Map(pts.map(p => [p.handle, p]))

    const cx = BOX.x + BOX.width  / 2  // 140
    const cy = BOX.y + BOX.height / 2  // 230
    const r  = BOX.x + BOX.width       // 180
    const b  = BOX.y + BOX.height      // 260

    expect(map.get('nw')).toMatchObject({ x: BOX.x, y: BOX.y })
    expect(map.get('n') ).toMatchObject({ x: cx,    y: BOX.y })
    expect(map.get('ne')).toMatchObject({ x: r,     y: BOX.y })
    expect(map.get('e') ).toMatchObject({ x: r,     y: cy    })
    expect(map.get('se')).toMatchObject({ x: r,     y: b     })
    expect(map.get('s') ).toMatchObject({ x: cx,    y: b     })
    expect(map.get('sw')).toMatchObject({ x: BOX.x, y: b     })
    expect(map.get('w') ).toMatchObject({ x: BOX.x, y: cy    })
  })

})

// ── handleAtPoint: hit-test ───────────────────────────────────────────────────

describe('handleAtPoint', () => {

  const RADIUS = 8

  it('hits the nw handle within the radius', () => {
    // nw = (100, 200); within the radius
    expect(handleAtPoint(BOX, 100, 200, RADIUS)).toBe('nw')
  })

  it('hits the se handle within the radius', () => {
    // se = (180, 260)
    expect(handleAtPoint(BOX, 180, 260, RADIUS)).toBe('se')
  })

  it('hits the n handle within the radius', () => {
    // n = (140, 200)
    expect(handleAtPoint(BOX, 140, 200, RADIUS)).toBe('n')
  })

  it('hits the e handle within the radius', () => {
    // e = (180, 230)
    expect(handleAtPoint(BOX, 180, 230, RADIUS)).toBe('e')
  })

  it('returns null far from all handles', () => {
    // Box center: (140, 230): no handle is there
    expect(handleAtPoint(BOX, 140, 230, RADIUS)).toBeNull()
  })

  it('returns null completely outside the box', () => {
    expect(handleAtPoint(BOX, 0, 0, RADIUS)).toBeNull()
  })

  it('prioritizes corners over sides when they overlap', () => {
    // nw = (100, 200) y w = (100, 230); n = (140, 200)
    // A large radius would make nw and n overlap with w; the corner must win
    const bigRadius = 40
    // Point at (100, 200) → nw (corner) must win over w (side)
    expect(handleAtPoint(BOX, 100, 200, bigRadius)).toBe('nw')
  })

})

// ── cursorFor: CSS cursors ────────────────────────────────────────────────────

describe('cursorFor', () => {

  it('nw → nwse-resize', () => expect(cursorFor('nw')).toBe('nwse-resize'))
  it('se → nwse-resize', () => expect(cursorFor('se')).toBe('nwse-resize'))
  it('ne → nesw-resize', () => expect(cursorFor('ne')).toBe('nesw-resize'))
  it('sw → nesw-resize', () => expect(cursorFor('sw')).toBe('nesw-resize'))
  it('n  → ns-resize',   () => expect(cursorFor('n')).toBe('ns-resize'))
  it('s  → ns-resize',   () => expect(cursorFor('s')).toBe('ns-resize'))
  it('e  → ew-resize',   () => expect(cursorFor('e')).toBe('ew-resize'))
  it('w  → ew-resize',   () => expect(cursorFor('w')).toBe('ew-resize'))

})
