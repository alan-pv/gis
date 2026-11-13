/**
 * useStageSnapshot — page thumbnail taken from the REAL render of the Stage: a JPEG
 * data URL of the whole board, emitted with a debounce after the scene, the view or
 * the selection change (the running animation triggers its own capture when it ends).
 * Skipped while there is a selection or a marquee, so their handles are not captured.
 */
import { useRef, useCallback, useEffect } from 'react'
import type { Viewport } from './viewport.js'
import { } from 'react-konva'
import type { Scene } from '@/scene/index.js'
import type { SelectionRect } from '@/ink/index.js'
import { SNAPSHOT_WIDTH, SNAPSHOT_DEBOUNCE_MS } from './canvas-style.js'
import Konva from 'konva'

interface UseStageSnapshotOptions {
  scene: Scene
  onSnapshot?: (dataUrl: string) => void
  width: number
  height: number
  view: Viewport
  selectedId?: string | null
  marqueeRect: SelectionRect | null
}

export function useStageSnapshot({ scene, onSnapshot, width, height, view, selectedId, marqueeRect }: UseStageSnapshotOptions) {
  const stageRef = useRef<Konva.Stage | null>(null)
  const snapshotTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const captureRef = useRef<() => void>(() => {})
  // Latest version of the capture (reads the current view/selection when the timer fires).
  useEffect(() => { captureRef.current = () => {
    const stage = stageRef.current
    if (!onSnapshot || !stage || selectedId || marqueeRect) return
    const w = width * view.scale
    const h = height * view.scale
    if (w <= 0 || h <= 0) return
    try {
      onSnapshot(stage.toDataURL({
        x: view.x, y: view.y, width: w, height: h,
        pixelRatio: SNAPSHOT_WIDTH / w, mimeType: 'image/jpeg', quality: 0.8,
      }))
    } catch { /* canvas without support (e.g. tests): no thumbnail */ }
  } })
  const snapshotSoon = useCallback((delay: number) => {
    if (snapshotTimer.current) clearTimeout(snapshotTimer.current)
    snapshotTimer.current = setTimeout(() => { snapshotTimer.current = null; captureRef.current() }, delay)
  }, [])
  // The scene, view or selection changed: recapture with a debounce (the running animation
  // also triggers its own capture when it ends).
  useEffect(() => {
    if (onSnapshot) snapshotSoon(SNAPSHOT_DEBOUNCE_MS)
  }, [scene, view.scale, view.x, view.y, selectedId, marqueeRect, onSnapshot, snapshotSoon])
  useEffect(() => () => { if (snapshotTimer.current) clearTimeout(snapshotTimer.current) }, [])

  return { stageRef, snapshotSoon }
}
