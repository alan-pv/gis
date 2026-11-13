/**
 * Open question (hatsumon) of the board.
 *
 * The big question DOES exist in the scene and in the state the agent sees (the model expects
 * the question to follow the title; if it never reached the state, it would repeat the subtitle
 * on every turn), but the app does NOT draw it: it takes no layout space, cannot be selected,
 * does not appear in thumbnails or animations, and arrows/highlights touching it are not drawn.
 *
 * Criterion (mirrors the sidecar rule): a text with role `subtitulo`, no group, whose text ends
 * in "?" (tolerating trailing quotes/closers). It is the FIRST one in the scene (stable: the
 * sidecar lets only one through).
 *
 * Pure: no Konva, no React, no DOM.
 */
import type { BoardItem } from '@/layout/index.js'
import type { Scene } from './model.js'

const ENDS_IN_QUESTION = /\?[\s"'»)\]*]*$/

/** Does a text with this role/group/content meet the open-question criterion? */
export function matchesOpenQuestion(role: string | null | undefined, group: string | null, text: string | null | undefined): boolean {
  return role === 'subtitulo' && group === null && ENDS_IN_QUESTION.test((text ?? '').trim())
}

/** Flags (hidden) the first open question among the items; `textOf` returns the text by id. */
export function flagOpenQuestion(items: BoardItem[], textOf: (id: string) => string | null | undefined): BoardItem[] {
  const i = items.findIndex((it) => it.isText && matchesOpenQuestion(it.role, it.group, textOf(it.id)))
  if (i < 0) return items
  return items.map((it, k) => (k === i ? { ...it, hidden: true } : it))
}

/** Id of the scene's open question, or null. */
export function findOpenQuestionId(scene: Scene): string | null {
  for (const [id, obj] of scene.objects) {
    if (obj.object !== 'texto') continue
    let group: string | null = null
    for (const [gid, g] of scene.groups) {
      if (g.members.includes(id)) {
        group = gid
        break
      }
    }
    if (matchesOpenQuestion(obj.role, group, obj.text ?? obj.label)) return id
  }
  return null
}

/**
 * Scene for drawing/selecting: without the hidden question nor the connections/highlights that
 * touch it (nor the highlights of those connections). Returns the SAME scene if there is nothing to hide.
 */
export function sceneForDisplay(scene: Scene): Scene {
  const hid = findOpenQuestionId(scene)
  if (hid === null) return scene
  const objects = new Map(scene.objects)
  objects.delete(hid)
  const connections = new Map(Array.from(scene.connections).filter(([, c]) => c.from !== hid && c.to !== hid))
  const highlights = new Map(
    Array.from(scene.highlights).filter(([, h]) => h.ref !== hid && (scene.connections.has(h.ref) ? connections.has(h.ref) : true)),
  )
  return { ...scene, objects, connections, highlights }
}
