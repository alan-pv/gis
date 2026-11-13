/**
 * Tests for PageThumbnails.tsx.
 *
 * Verifies that the thumbnail strip:
 *   1. Reflects the number and order of pages.
 *   2. Calls onSelect with the right index when a card is clicked.
 *   3. Calls onAdd when the "+" button is clicked.
 *   4. Calls onRemove with the right index when the × button is clicked.
 *   5. Does not show the × button when there is only one page.
 *   6. The active card has aria-current="page".
 *   7. The preview renders real SVG paths for library objects.
 *
 * No Konva, no animation: the component is plain SVG/HTML, compatible
 * with the vitest happy-dom environment. Uses react-dom/client + act
 * (without @testing-library/react, which requires @testing-library/dom, not installed).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act, createElement } from 'react'

// Tell React we are in a test environment (suppresses the act warning)
// @ts-expect-error — React global test property
globalThis.IS_REACT_ACT_ENVIRONMENT = true
import { PageThumbnails } from './PageThumbnails.js'
import type { PageThumbnailsProps } from './PageThumbnails.js'
import { emptyScene } from '@/scene/model.js'
import { emptyInk, addStroke } from '@/ink/index.js'
import type { Page } from '@/document/model.js'
import { loadLibrary } from '@/library/index.js'
import { defaultAreaTree } from '@/layout/index.js'

// Library loaded once at module level (synchronous, cached)
const library = loadLibrary()

// ── Fixture: test pages ───────────────────────────────────────────────────────

function makePage(number: number): Page {
  return { number, scene: emptyScene(), ink: emptyInk(), areaTree: defaultAreaTree(3) }
}

const THREE_PAGES: Page[] = [makePage(1), makePage(2), makePage(3)]
const ONE_PAGE: Page[] = [makePage(1)]

// ── Base props ────────────────────────────────────────────────────────────────

function baseProps(overrides: Partial<PageThumbnailsProps> = {}): PageThumbnailsProps {
  return {
    pages: THREE_PAGES,
    activeIndex: 0,
    canvasWidth: 1200,
    canvasHeight: 900,
    disabled: false,
    onSelect: vi.fn(),
    onAdd: vi.fn(),
    onRemove: vi.fn(),
    library,
    ...overrides,
  }
}

// ── Mount/unmount helpers ─────────────────────────────────────────────────────

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
})

/** Renders the component synchronously inside `act`. */
function renderComponent(props: PageThumbnailsProps): void {
  act(() => { root.render(createElement(PageThumbnails, props)) })
}

/** Returns all elements with the given text (exact textContent). */
function queryAllByText(text: string): Element[] {
  return Array.from(container.querySelectorAll('*')).filter(
    (el) => el.textContent?.trim() === text && el.children.length === 0,
  )
}

/** Returns all buttons (implicit or explicit role=button) with the given aria-label. */
function queryByAriaLabel(label: string): Element | null {
  return container.querySelector(`[aria-label="${label}"]`)
}

function queryAllByAriaLabelPattern(pattern: RegExp): Element[] {
  return Array.from(container.querySelectorAll('[aria-label]')).filter(
    (el) => pattern.test(el.getAttribute('aria-label') ?? ''),
  )
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PageThumbnails', () => {

  describe('reflects the number and order of pages', () => {

    it('shows the labels "Page 1", "Page 2" and "Page 3" in order', () => {
      renderComponent(baseProps())
      const labels = queryAllByText('Page 1')
        .concat(queryAllByText('Page 2'))
        .concat(queryAllByText('Page 3'))
      expect(labels).toHaveLength(3)
      // Check they appear in order by DOM position
      const allSpans = Array.from(container.querySelectorAll('span')).filter(
        (el) => /^Page \d+$/.test(el.textContent?.trim() ?? ''),
      )
      expect(allSpans[0]?.textContent?.trim()).toBe('Page 1')
      expect(allSpans[1]?.textContent?.trim()).toBe('Page 2')
      expect(allSpans[2]?.textContent?.trim()).toBe('Page 3')
    })

    it('with a single page shows only "Page 1"', () => {
      renderComponent(baseProps({ pages: ONE_PAGE }))
      const allSpans = Array.from(container.querySelectorAll('span')).filter(
        (el) => /^Page \d+$/.test(el.textContent?.trim() ?? ''),
      )
      expect(allSpans).toHaveLength(1)
      expect(allSpans[0]?.textContent?.trim()).toBe('Page 1')
    })

  })

  describe('selecting a page', () => {

    it('click on the card at index 2 calls onSelect(2)', () => {
      const onSelect = vi.fn()
      renderComponent(baseProps({ onSelect }))
      const card = queryByAriaLabel('Page 3')
      expect(card).not.toBeNull()
      act(() => { card!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
      expect(onSelect).toHaveBeenCalledOnce()
      expect(onSelect).toHaveBeenCalledWith(2)
    })

    it('click on the card at index 0 calls onSelect(0)', () => {
      const onSelect = vi.fn()
      renderComponent(baseProps({ onSelect, activeIndex: 1 }))
      const card = queryByAriaLabel('Page 1')
      expect(card).not.toBeNull()
      act(() => { card!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
      expect(onSelect).toHaveBeenCalledWith(0)
    })

    it('with disabled=true, click on a card does NOT call onSelect', () => {
      const onSelect = vi.fn()
      renderComponent(baseProps({ onSelect, disabled: true }))
      const card = queryByAriaLabel('Page 1')
      expect(card).not.toBeNull()
      act(() => { card!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
      expect(onSelect).not.toHaveBeenCalled()
    })

  })

  describe('creating a page', () => {

    it('click on "+" calls onAdd', () => {
      const onAdd = vi.fn()
      renderComponent(baseProps({ onAdd }))
      const addBtn = queryByAriaLabel('Add page')
      expect(addBtn).not.toBeNull()
      act(() => { addBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
      expect(onAdd).toHaveBeenCalledOnce()
    })

    it('with disabled=true, click on "+" does NOT call onAdd', () => {
      const onAdd = vi.fn()
      renderComponent(baseProps({ onAdd, disabled: true }))
      const addBtn = queryByAriaLabel('Add page')
      expect(addBtn).not.toBeNull()
      act(() => { addBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
      expect(onAdd).not.toHaveBeenCalled()
    })

  })

  describe('deleting a page', () => {

    it('with >1 page, click on × of page 2 calls onRemove(1)', () => {
      const onRemove = vi.fn()
      renderComponent(baseProps({ onRemove }))
      const removeBtn = queryByAriaLabel('Delete page 2')
      expect(removeBtn).not.toBeNull()
      act(() => { removeBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
      expect(onRemove).toHaveBeenCalledOnce()
      expect(onRemove).toHaveBeenCalledWith(1)
    })

    it('with a single page NO × button is shown', () => {
      renderComponent(baseProps({ pages: ONE_PAGE }))
      const removeBtns = queryAllByAriaLabelPattern(/^Delete page/)
      expect(removeBtns).toHaveLength(0)
    })

  })

  describe('active page indicator', () => {

    it('the active card has aria-current="page"', () => {
      renderComponent(baseProps({ activeIndex: 1 }))
      const activeCard = queryByAriaLabel('Page 2')
      expect(activeCard?.getAttribute('aria-current')).toBe('page')
    })

    it('inactive cards do NOT have aria-current', () => {
      renderComponent(baseProps({ activeIndex: 0 }))
      const inactiveCard = queryByAriaLabel('Page 2')
      expect(inactiveCard?.getAttribute('aria-current')).toBeNull()
    })

  })

  describe('real SVG render', () => {

    /** Builds a page with a 'sol' object (library hit). */
    function makePageWithSol(): Page {
      const scene = emptyScene()
      scene.objects.set('sol_1_a', {
        id: 'sol_1_a', object: 'sol', label: null, text: null,
        role: null, box: { x: 100, y: 100, width: 200, height: 200 },
      })
      return { number: 1, scene, ink: emptyInk(), areaTree: defaultAreaTree(3) }
    }

    it('the preview of a page with a "sol" object contains at least one real <path>', () => {
      renderComponent(baseProps({ pages: [makePageWithSol()] }))
      // With a healthy library, 'sol' resolves to SVG → there must be real paths
      expect(container.querySelectorAll('path').length).toBeGreaterThan(0)
    })

    it('the preview of a page with a "sol" object does NOT use the bbox fallback rect', () => {
      renderComponent(baseProps({ pages: [makePageWithSol()] }))
      // The fallback rect only appears when the library is broken (resolved = undefined).
      // With a healthy library, 'sol' resolves correctly → there must be no rect with width="200".
      const fallbackRects = Array.from(container.querySelectorAll('rect')).filter(
        (el) => el.getAttribute('width') === '200' && el.getAttribute('height') === '200',
      )
      expect(fallbackRects).toHaveLength(0)
    })

  })

  describe('mute ink in the thumbnail', () => {

    /** Builds a page with no objects but with a mute ink stroke. */
    function makePageWithInk(): Page {
      const ink = addStroke(emptyInk(), [10, 10, 200, 200, 300, 100])
      return { number: 1, scene: emptyScene(), ink, areaTree: defaultAreaTree(3) }
    }

    it('the preview shows one polyline per mute ink stroke', () => {
      renderComponent(baseProps({ pages: [makePageWithInk()] }))
      expect(container.querySelectorAll('polyline').length).toBeGreaterThan(0)
    })

    it('pages without mute ink produce no ink polylines', () => {
      renderComponent(baseProps({ pages: ONE_PAGE }))
      // ONE_PAGE uses emptyInk() → no strokes → no ink polylines
      // (there are no objects with inkGeometry either in emptyScene)
      expect(container.querySelectorAll('polyline').length).toBe(0)
    })

  })

  describe('capture of the real render', () => {

    it('with a capture for the page it uses <img> instead of the fallback SVG', () => {
      renderComponent(baseProps({ pages: ONE_PAGE, snapshots: { 1: 'data:image/jpeg;base64,AAAA' } }))
      const img = container.querySelector('img[data-testid="page-snapshot"]')
      expect(img).not.toBeNull()
      expect(img?.getAttribute('src')).toBe('data:image/jpeg;base64,AAAA')
      expect(container.querySelector('svg')).toBeNull()
    })

    it('only pages with a capture use an image; the others use the fallback SVG', () => {
      renderComponent(baseProps({ pages: THREE_PAGES, snapshots: { 2: 'data:image/jpeg;base64,BBBB' } }))
      expect(container.querySelectorAll('img[data-testid="page-snapshot"]')).toHaveLength(1)
      expect(container.querySelectorAll('svg').length).toBe(2)
    })

  })

})
