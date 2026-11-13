/**
 * usePages — page navigation of the document: select / add / remove pages and the
 * page thumbnails taken from the real canvas render.
 */
import { useCallback, useState } from 'react'
import { activePage } from '@/document/index.js'
import type { GisDocument } from '@/document/index.js'

export interface UsePagesOptions {
  document: GisDocument
  /** Cancels/ends the running animation (it belongs to the page that generated it). */
  setIsRunning: (running: boolean) => void
  /** Hides the shape menu and the selection. */
  clearTransient: () => void
  setSelectedId: (id: string | null) => void
  dispatchSetActivePage: (index: number) => void
  dispatchAddPage: () => void
  dispatchRemovePage: (index: number) => void
}

export function usePages({
  document, setIsRunning, clearTransient, setSelectedId,
  dispatchSetActivePage, dispatchAddPage, dispatchRemovePage,
}: UsePagesOptions) {
  // Page thumbnails taken from the real canvas render, by page number.
  const [pageSnapshots, setPageSnapshots] = useState<Record<number, string>>({})

  const activePageNumber = activePage(document).number
  const handleSnapshot = useCallback((url: string) => {
    setPageSnapshots(prev => (prev[activePageNumber] === url ? prev : { ...prev, [activePageNumber]: url }))
  }, [activePageNumber])

  const clearSnapshots = useCallback(() => setPageSnapshots({}), [])

  /** Switches to the page at the given index; no-op if it is already active.
   * setIsRunning(false) BEFORE dispatching cancels the running animation; the real
   * cancel is the unmount of SceneCanvas. */
  const handleSelectPage = useCallback((index: number) => {
    if (index === document.activeIndex) return
    setIsRunning(false)
    clearTransient()
    dispatchSetActivePage(index)
  }, [document.activeIndex, dispatchSetActivePage, setIsRunning, clearTransient])

  /** Adds an empty page at the end and makes it active. */
  const handleAddPage = useCallback(() => {
    setIsRunning(false)
    setSelectedId(null)
    dispatchAddPage()
  }, [dispatchAddPage, setIsRunning, setSelectedId])

  /** Removes the page at the given index; asks for confirmation if it has content. */
  const handleRemovePage = useCallback((index: number) => {
    const page = document.pages[index]
    if (!page) return
    const { scene } = page
    const hasContent = scene.objects.size + scene.connections.size + scene.groups.size > 0
    if (hasContent) {
      const ok = window.confirm(`Page ${page.number} has content. Delete it?`)
      if (!ok) return
    }
    setIsRunning(false)
    setSelectedId(null)
    dispatchRemovePage(index)
  }, [document.pages, dispatchRemovePage, setIsRunning, setSelectedId])

  return { pageSnapshots, clearSnapshots, handleSnapshot, handleSelectPage, handleAddPage, handleRemovePage }
}
