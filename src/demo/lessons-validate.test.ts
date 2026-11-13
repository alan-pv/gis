/**
 * All recorded lessons validate cleanly: every turn of every lesson in
 * src/demo/lessons goes through validate → apply with ZERO rejected operations.
 */
import { describe, it, expect } from 'vitest'
import { loadLibrary } from '@/library/index.js'
import { validateAgentOutput } from '@/validator/index.js'
import { newDocument, applyToActivePage, activeScene } from '@/document/index.js'
import { allIds } from '@/scene/index.js'
import { domMeasureText, domMeasureConcept } from '@/canvas/measure-text.js'
import { loadSeeds } from './lessons.js'

const canvas = { width: 1200, height: 900 }
const library = loadLibrary()

describe('recorded lessons', () => {
  const lessons = loadSeeds()

  it('there are 40 lessons', () => {
    expect(lessons).toHaveLength(40)
  })

  it('every operation of every turn is accepted (0 rejected)', () => {
    let accepted = 0
    const problems: string[] = []
    for (const lesson of lessons) {
      let doc = newDocument()
      lesson.turns.forEach((turn, i) => {
        const result = validateAgentOutput(turn.envelope, { mode: 'live', pageIds: allIds(activeScene(doc)) })
        accepted += result.accepted.length
        for (const r of result.rejected) problems.push(`${lesson.id} turn ${i + 1}: ${r.rule} ${r.reason}`)
        if (result.accepted.length > 0) {
          doc = applyToActivePage(
            doc, result.accepted,
            { canvas, library, measureText: domMeasureText, measureConcept: domMeasureConcept }, 'live',
          ).document
        }
      })
    }
    expect(problems).toEqual([])
    expect(accepted).toBe(2142)
  }, 60_000)
})
