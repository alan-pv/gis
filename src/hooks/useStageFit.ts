/**
 * useStageFit — fits the board to the visible area (fixed board: no pan, no zoom).
 *
 * The Konva <Stage> is cropped/scaled to the free space of its container;
 * CANVAS_W/CANVAS_H stay the logical size for everything else (background,
 * anchors, layout, agent state, applyEnvelope).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { fitViewport, IDENTITY_VIEWPORT } from '@/canvas/viewport.js'
import type { Viewport } from '@/canvas/viewport.js'
import { CANVAS_W, CANVAS_H } from '@/canvas/board-size.js'

export function useStageFit() {
  /** DOM node of the Stage container; its size is observed with a ResizeObserver. */
  const stageContainerRef = useRef<HTMLDivElement>(null)
  /** Size in px of the visible area of the container; null until the first measurement. */
  const [stageRect, setStageRect] = useState<{ width: number; height: number } | null>(null)

  // Measures the available space of the Stage container.
  useEffect(() => {
    const el = stageContainerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      setStageRect({ width, height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // The view derives from the available space: the logical canvas is scaled to fit,
  // centered, with symmetric margins.
  const view: Viewport = useMemo(
    () => (stageRect ? fitViewport(stageRect, { width: CANVAS_W, height: CANVAS_H }) : IDENTITY_VIEWPORT),
    [stageRect],
  )

  return { stageContainerRef, stageRect, view }
}
