/**
 * Animation timeline builder (pure module).
 *
 * Converts SceneEvent[] into AnimationStep[]: atomic steps with durations,
 * organic pauses and highlights ALWAYS sequential.
 *
 * No Konva, no DOM: fully testable headless.
 */
import type { SceneEvent } from '@/scene/index.js'
import type { Scene } from '@/scene/index.js'
import {
  PEN_SPEED_PX_PER_S,
  STROKE_MIN_MS,
  STROKE_MAX_MS,
  LETTER_MS,
  PATH_PAUSE_MS,
  MICRO_PAUSE_MS,
  PULSE_MS,
  FADE_MS,
  MOVE_MS,
} from './constants.js'
import { extensionSuffix } from '@/scene/text-extend.js'
import { displayText, stripBold } from '@/scene/text-runs.js'

// ── Public type ───────────────────────────────────────────────────────────────

/**
 * An atomic animation step.
 *
 * The player (useAnimationPlayer) interprets each step
 * on the corresponding Konva nodes.
 */
export type AnimationStep =
  | { kind: 'stroke';    targetId: string; pathId?: string; durationMs: number }
  /** `prefix`: already written text that stays visible; `text` is only what is typed (extend). */
  | { kind: 'type_text'; targetId: string; text: string; prefix?: string; durationMs: number }
  | { kind: 'pause';                                          durationMs: number }
  | { kind: 'fade_out';  targetIds: string[];                durationMs: number }
  | { kind: 'move';      targetId: string;                   durationMs: number }
  | { kind: 'appear';    targetId: string }

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Clamps the duration of a stroke between STROKE_MIN_MS and STROKE_MAX_MS.
 */
function strokeDuration(lengthPx: number): number {
  const raw = (lengthPx / PEN_SPEED_PX_PER_S) * 1000
  return Math.min(STROKE_MAX_MS, Math.max(STROKE_MIN_MS, raw))
}

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Builds the timeline from the scene event script.
 *
 * Each scene-engine event is translated into one or more AnimationSteps
 * plus organic pauses between them.
 *
 * @param events  Animation script (same order as the accepted ops).
 * @param scene   Resulting scene (to look up labels, texts, etc.).
 * @returns       Ordered list of AnimationStep.
 */
export function buildTimeline(
  events: SceneEvent[],
  scene: Scene,
): AnimationStep[] {
  const steps: AnimationStep[] = []

  for (let eventIdx = 0; eventIdx < events.length; eventIdx++) {
    const event = events[eventIdx]
    if (!event) continue

    // Micro-pause between events (except before the first one)
    if (eventIdx > 0) {
      steps.push({ kind: 'pause', durationMs: MICRO_PAUSE_MS })
    }

    switch (event.type) {

      // ── draw_object ──────────────────────────────────────────────────────────
      case 'draw_object': {
        const obj = scene.objects.get(event.id)
        if (!obj) break

        // A concept is a circle with its name. The circle is traced (node
        // `<id>/circle`) and then the name is written letter by letter (`<id>__label`).
        if (obj.object === 'concepto') {
          const circumference = Math.PI * Math.max(obj.box.width, obj.box.height) * 0.9
          steps.push({ kind: 'stroke', targetId: event.id, pathId: 'circle', durationMs: strokeDuration(circumference) })
          const name = stripBold(obj.label ?? '')
          if (name.length > 0) {
            steps.push({ kind: 'pause', durationMs: PATH_PAUSE_MS })
            steps.push({ kind: 'type_text', targetId: `${event.id}__label`, text: name, durationMs: name.length * LETTER_MS })
          }
          break
        }

        // Text: letter by letter over the VISIBLE text (no `**`, with the list
        // marker), so bold marks never appear on screen.
        const text = displayText(obj.text ?? obj.label ?? '', obj.role, obj.listStart)
        const durationMs = text.length * LETTER_MS
        steps.push({ kind: 'type_text', targetId: event.id, text, durationMs })
        break
      }

      // ── draw_connection ──────────────────────────────────────────────────────
      case 'draw_connection': {
        const conn = scene.connections.get(event.id)
        if (!conn) break

        const fromObj = scene.objects.get(conn.from)
        const toObj = scene.objects.get(conn.to)

        // Approximate length = distance between box centers
        let lengthPx = 200 // fallback
        if (fromObj && toObj) {
          const fx = fromObj.box.x + fromObj.box.width / 2
          const fy = fromObj.box.y + fromObj.box.height / 2
          const tx = toObj.box.x + toObj.box.width / 2
          const ty = toObj.box.y + toObj.box.height / 2
          const dx = tx - fx
          const dy = ty - fy
          lengthPx = Math.sqrt(dx * dx + dy * dy)
        }

        const durationMs = strokeDuration(lengthPx)
        steps.push({ kind: 'stroke', targetId: event.id, pathId: 'line', durationMs })

        // Arrowheads: emitted unconditionally; the player skips
        // steps whose node does not exist (resolver returns undefined -> advance()).
        steps.push({ kind: 'pause', durationMs: PATH_PAUSE_MS })
        steps.push({ kind: 'stroke', targetId: event.id, pathId: 'arrowTo', durationMs: STROKE_MIN_MS })
        steps.push({ kind: 'pause', durationMs: PATH_PAUSE_MS })
        steps.push({ kind: 'stroke', targetId: event.id, pathId: 'arrowFrom', durationMs: STROKE_MIN_MS })

        // Connection label (if any)
        if (conn.label) {
          steps.push({ kind: 'pause', durationMs: PATH_PAUSE_MS })
          const labelMs = conn.label.length * LETTER_MS
          steps.push({
            kind: 'type_text',
            targetId: `${event.id}__label`,
            text: conn.label,
            durationMs: labelMs,
          })
        }
        break
      }

      // ── set_label ────────────────────────────────────────────────────────────
      case 'set_label': {
        // Animate the label of the referenced object/connection/group
        let text = ''

        const obj = scene.objects.get(event.ref)
        if (obj) {
          text = stripBold(obj.label ?? '')
        } else {
          const conn = scene.connections.get(event.ref)
          if (conn) {
            text = conn.label ?? ''
          } else {
            const grp = scene.groups.get(event.ref)
            if (grp) text = grp.label ?? ''
          }
        }

        if (text) {
          const durationMs = text.length * LETTER_MS
          steps.push({
            kind: 'type_text',
            targetId: `${event.ref}__label`,
            text,
            durationMs,
          })
        }
        break
      }

      // ── highlight ────────────────────────────────────────────────────────────
      case 'highlight': {
        // ALWAYS SEQUENTIAL:
        // one stroke per highlight created, with a micro-pause between them.
        // The player reveals the highlight Path (registered by its id) via dashOffset.
        for (let ri = 0; ri < event.highlights.length; ri++) {
          const hl = event.highlights[ri]
          if (!hl) continue

          if (ri > 0) {
            steps.push({ kind: 'pause', durationMs: MICRO_PAUSE_MS })
          }

          steps.push({ kind: 'stroke', targetId: hl.id, durationMs: PULSE_MS })
        }
        break
      }

      // ── group / ungroup ──────────────────────────────────────────────────────
      case 'group': {
        // The group appears as a visual indicator with no stroke animation
        steps.push({ kind: 'appear', targetId: event.id })
        break
      }
      case 'ungroup': {
        steps.push({ kind: 'appear', targetId: event.id })
        break
      }

      // ── remove ───────────────────────────────────────────────────────────────
      case 'remove': {
        steps.push({ kind: 'fade_out', targetIds: event.ids, durationMs: FADE_MS })
        break
      }

      // ── update ───────────────────────────────────────────────────────────────
      case 'update': {
        // "extend": the paragraph grows; ONLY the suffix is written and the
        // already written prefix is left intact.
        const newText = scene.objects.get(event.id)?.text ?? null
        const suf = event.extendedFrom !== undefined && newText !== null
          ? extensionSuffix(event.extendedFrom, newText)
          : null
        if (suf !== null && newText !== null) {
          // Prefix and suffix are computed over the visible text (no `**`): the
          // already written prefix stays intact and only the addition is typed.
          const role = scene.objects.get(event.id)?.role
          const listStart = scene.objects.get(event.id)?.listStart
          const visibleNew = displayText(newText, role, listStart)
          const visiblePrev = displayText(event.extendedFrom!, role, listStart).trimEnd()
          if (visibleNew.startsWith(visiblePrev) && visibleNew.length > visiblePrev.length) {
            const typed = visibleNew.slice(visiblePrev.length)
            steps.push({
              kind: 'type_text',
              targetId: event.id,
              text: typed,
              prefix: visiblePrev,
              durationMs: typed.length * LETTER_MS,
            })
            break
          }
        }
        steps.push({ kind: 'move', targetId: event.id, durationMs: MOVE_MS })
        break
      }

      // ── clear ────────────────────────────────────────────────────────────────
      case 'clear': {
        // Fade out everything: the ids are resolved at render time
        steps.push({ kind: 'fade_out', targetIds: ['__all__'], durationMs: FADE_MS })
        break
      }
    }
  }

  return steps
}
