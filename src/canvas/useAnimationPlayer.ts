/**
 * Animation playback hook: plays AnimationStep[] over Konva nodes.
 *
 * Pen speed, micro-pauses, letter-by-letter text, sequential highlight.
 * The nodes already exist in full in the scene graph (they are only revealed:
 * NEVER video).
 *
 * No render tests (Konva is not testable in happy-dom).
 */
import { useRef, useCallback } from 'react'
import Konva from 'konva'
import type { AnimationStep } from '@/animation/timeline.js'
import { approxPathLength } from '@/animation/path-length.js'
import { isRunsNode, REVEAL_ATTR } from './runs-layout.js'

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Function that resolves a Konva node by (targetId, pathId?).
 * - For objects: targetId = object id, pathId = id of the path inside the group.
 * - For labels: targetId = "<id>__label", pathId omitted.
 * - For connections: targetId = connection id, pathId = 'line' | 'arrowTo' | 'arrowFrom'.
 */
export type NodeResolver = (targetId: string, pathId?: string) => Konva.Node | undefined

export interface AnimationPlayer {
  /** Plays the list of steps in order. Calls onDone when finished. */
  play: (steps: AnimationStep[], resolver: NodeResolver, onDone?: () => void) => void
  /** Cancels the playback in progress. */
  cancel: () => void
  /** true if an animation is in progress. */
  isPlaying: boolean
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Hook that returns a stable `AnimationPlayer` object.
 * The player plays each AnimationStep in order, waiting for the corresponding
 * duration before moving on to the next one.
 */
export function useAnimationPlayer(): AnimationPlayer {
  const cancelRef = useRef(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isPlayingRef = useRef(false)

  const cancel = useCallback(() => {
    cancelRef.current = true
    isPlayingRef.current = false
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const play = useCallback(
    (steps: AnimationStep[], resolver: NodeResolver, onDone?: () => void) => {
      cancelRef.current = false
      isPlayingRef.current = true

      const runStep = (index: number) => {
        if (cancelRef.current || index >= steps.length) {
          isPlayingRef.current = false
          onDone?.()
          return
        }

        const step = steps[index]
        if (!step) {
          runStep(index + 1)
          return
        }

        const advance = () => {
          timeoutRef.current = setTimeout(() => runStep(index + 1), 0)
        }

        // Synchronous exceptions happen BEFORE tweens/timeouts are scheduled,
        // so the catch calls advance() with no risk of duplicating it.
        try {
          switch (step.kind) {

            // ── stroke: reveal path with dashOffset ───────────────────────────
            case 'stroke': {
              const node = resolver(step.targetId, step.pathId) as Konva.Path | undefined
              if (!node) { advance(); break }

              const d = (node as Konva.Path).data()
              const length = d ? approxPathLength(d) : 200
              const safeLen = Math.max(length, 1)

              node.dashEnabled(true)
              node.dash([safeLen, safeLen])
              node.dashOffset(safeLen)
              node.opacity(1)
              node.getLayer()?.batchDraw()

              const tween = new Konva.Tween({
                node,
                dashOffset: 0,
                duration: step.durationMs / 1000,
                easing: Konva.Easings.Linear,
                onFinish: () => {
                  tween.destroy()
                  node.dashEnabled(false)
                  node.getLayer()?.batchDraw()
                  advance()
                },
              })
              tween.play()
              break
            }

            // ── type_text: letter-by-letter text ──────────────────────────────
            case 'type_text': {
              const node = resolver(step.targetId)
              if (!node) { advance(); break }

              // extend: the already written prefix is kept; only the suffix is typed.
              const prefix = step.prefix ?? ''
              const fullText = step.text
              const totalMs = step.durationMs
              const perLetterMs = fullText.length > 0 ? totalMs / fullText.length : totalMs
              // A text node with runs (inline bold) reveals by character index of the
              // visible text (line wrapping does not change while typing and the `**`
              // are never seen); a Konva.Text (labels) changes its string.
              const runs = isRunsNode(node)
              // Paragraph split across columns: continuation fragments
              // (`<id>/f1`, `<id>/f2`…) share the character indices, so they get the
              // same counter and the typing continues from one fragment to the next.
              const nodes: Konva.Node[] = [node]
              if (runs) {
                for (let n = 1; ; n++) {
                  const extra = resolver(step.targetId, `f${n}`)
                  if (!extra) break
                  nodes.push(extra)
                }
              }
              const show = (chars: number): void => {
                for (const nd of nodes) {
                  if (runs) nd.setAttr(REVEAL_ATTR, prefix.length + chars)
                  else (nd as Konva.Text).text(prefix + fullText.slice(0, chars))
                }
                node.getLayer()?.batchDraw()
              }
              for (const nd of nodes) nd.opacity(1)
              show(0)

              let charIndex = 0
              const typeChar = () => {
                if (cancelRef.current) return
                charIndex++
                show(charIndex)
                if (charIndex < fullText.length) {
                  timeoutRef.current = setTimeout(typeChar, perLetterMs)
                } else {
                  if (runs) for (const nd of nodes) nd.setAttr(REVEAL_ATTR, undefined)
                  advance()
                }
              }

              if (fullText.length === 0) {
                if (runs) for (const nd of nodes) nd.setAttr(REVEAL_ATTR, undefined)
                advance()
              } else {
                timeoutRef.current = setTimeout(typeChar, perLetterMs)
              }
              break
            }

            // ── pause: wait ───────────────────────────────────────────────────
            case 'pause': {
              timeoutRef.current = setTimeout(() => runStep(index + 1), step.durationMs)
              break
            }

            // ── fade_out: opacity 1→0 ─────────────────────────────────────────
            case 'fade_out': {
              const targets = step.targetIds

              if (targets.length === 0 || targets.includes('__all__')) {
                // '__all__' is handled in the parent component (scene reset)
                advance()
                break
              }

              let finished = 0
              const total = targets.length

              for (const id of targets) {
                const node = resolver(id)
                if (!node) {
                  finished++
                  if (finished === total) advance()
                  continue
                }
                const tween = new Konva.Tween({
                  node,
                  opacity: 0,
                  duration: step.durationMs / 1000,
                  onFinish: () => {
                    tween.destroy()
                    finished++
                    if (finished === total) advance()
                  },
                })
                tween.play()
              }
              break
            }

            // ── move: opacity flash to indicate movement ──────────────────────
            case 'move': {
              const node = resolver(step.targetId)
              if (!node) { advance(); break }

              const halfDur = step.durationMs / 2000  // en segundos, mitad
              const tween = new Konva.Tween({
                node,
                opacity: 0.3,
                duration: halfDur,
                easing: Konva.Easings.EaseIn,
                onFinish: () => {
                  tween.destroy()
                  const tweenBack = new Konva.Tween({
                    node,
                    opacity: 1,
                    duration: halfDur,
                    easing: Konva.Easings.EaseOut,
                    onFinish: () => {
                      tweenBack.destroy()
                      advance()
                    },
                  })
                  tweenBack.play()
                },
              })
              tween.play()
              break
            }

            // ── appear: no animation ──────────────────────────────────────────
            case 'appear': {
              const node = resolver(step.targetId)
              if (node) {
                node.opacity(1)
                node.getLayer()?.batchDraw()
              }
              advance()
              break
            }
          }
        } catch (error) {
          console.warn('[gis] animation step failed, skipping:', step.kind, error)
          advance()
        }
      }

      runStep(0)
    },
    [],
  )

  return { play, cancel, get isPlaying() { return isPlayingRef.current } }
}
