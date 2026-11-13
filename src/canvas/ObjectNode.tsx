/** ObjectNode — one scene object on the Konva board (a text or a concept). */
import { Group, Path, Rect } from 'react-konva'
import type { SceneObject } from '@/scene/index.js'
import type { BBox } from '@/layout/index.js'
import { roughenPath, hashId } from './rough.js'
import { INK_COLOR, textInkColor, textBackgroundFor, conceptStrokeColor, type SectionColor } from './board-colors.js'
import { RunsText } from './RunsText.js'
import { layoutTextForRender, layoutConceptForRender, conceptCirclePath } from './runs-layout.js'
import { ROLE_STYLE } from '@/scene/text-measure.js'
import { STROKE_WIDTH } from './canvas-style.js'
import Konva from 'konva'

interface ObjectNodeProps {
  obj: SceneObject
  reg: (key: string, node: Konva.Node | null) => void
  /** Set of already revealed keys; determines the initial opacity of animatable nodes. */
  revealed: Set<string>
  /** Color of the object's section (group), or null if it belongs to none. */
  section: SectionColor | null
  /** true while editing in place: the text is hidden (the HTML editor covers it). */
  editing?: boolean
  onMoved?: (id: string, newBox: BBox) => void
}

export function ObjectNode({ obj, reg, revealed, section, editing = false, onMoved }: ObjectNodeProps) {
  // Draggable only if there is a move callback (select tool active)
  const draggable = onMoved !== undefined
  const box = obj.box
  const seed = hashId(obj.id)

  // Commit of the move from the current node position. Used both in
  // onDragMove (live tracking: arrows and backgrounds are recomputed
  // while dragging) and in onDragEnd (final commit). OBJECT_MOVED only
  // updates the box (no reflow), so box.x/box.y stays equal to the node
  // position and the re-render causes no jumps (same pattern as the live
  // resize in SceneCanvas pointermove).
  const handleDrag = (e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target
    onMoved?.(obj.id, {
      x: node.x(),
      y: node.y(),
      width: box.width,
      height: box.height,
    })
  }

  // Concept: a hand-drawn circle with its free-form name inside. It is still a live
  // object: the Group is registered under the object id (selectable, movable,
  // connectable; the circle stroke spans 5–95 % of the box, see `conceptCirclePath`).
  // The animation reveals the stroke (`id/circle`) and then writes the name letter by
  // letter (`id__label`). Outline in the dark tone of the section; the name in ink.
  if (obj.object === 'concepto') {
    const label = obj.label ?? ''
    const cl = layoutConceptForRender(label, box.width)
    const circleKey = `${obj.id}/circle`
    const labelKey = `${obj.id}__label`
    return (
      <Group
        ref={node => reg(obj.id, node)}
        x={box.x} y={box.y}
        draggable={draggable}
        onDragMove={handleDrag}
        onDragEnd={handleDrag}
      >
        <Rect width={box.width} height={box.height} fill="black" opacity={0} />
        <Path
          ref={node => reg(circleKey, node)}
          data={roughenPath(conceptCirclePath(box.width, box.height), seed)}
          stroke={conceptStrokeColor(section)}
          strokeWidth={STROKE_WIDTH}
          lineCap="round"
          lineJoin="round"
          fillEnabled={false}
          opacity={revealed.has(circleKey) ? 1 : 0}
        />
        <RunsText
          nodeRef={node => reg(labelKey, node)}
          lines={cl.lines}
          fontSize={cl.fontSize}
          roleBold={false}
          color={INK_COLOR}
          centerWidth={box.width}
          centerHeight={box.height}
          opacity={revealed.has(labelKey) ? 1 : 0}
        />
      </Group>
    )
  }

  // Text object: the animatable node is the Text (type_text reveals it letter by letter).
  // The outer Group is NOT registered: React refs run child->parent, so also
  // registering the Group would overwrite the Text under the same key, and
  // pulse/type_text would receive a Group without a .text() method -> TypeError.
  // Style by semantic role. Default 'cuerpo'.
  const roleStyle = ROLE_STYLE[obj.role ?? 'cuerpo']
  // Honor the computed fontSize (title auto-fit) if defined.
  const effectiveFontSize = obj.fontSize ?? roleStyle.fontSize
  // Title: a single line on the left, natural width, no word-wrap.
  // The lines (with inline bold runs) come from `layoutRuns`, the same function as
  // the measurement, and are drawn with a single node (see RunsText.tsx).
  const layout = layoutTextForRender(obj.text ?? '', obj.role, box.width, effectiveFontSize, obj.listStart)
  // Paragraph split across columns: one Group per fragment, each with its range of
  // lines. They all share the text character indices, so the letter-by-letter
  // animation continues from one fragment to the next (the player writes the same
  // `revealChars` on `<id>` and on `<id>/f1`, `<id>/f2`…). Only the first is draggable.
  const fragments = obj.fragments
  if (fragments !== undefined && fragments.length > 1) {
    return (
      <>
        {fragments.map((fr, n) => (
          <Group
            key={n}
            x={fr.box.x}
            y={fr.box.y}
            draggable={n === 0 && draggable}
            onDragMove={handleDrag}
            onDragEnd={handleDrag}
          >
            <Rect width={fr.box.width} height={fr.box.height} fill="black" opacity={0} />
            <RunsText
              nodeRef={node => reg(n === 0 ? obj.id : `${obj.id}/f${n}`, node)}
              lines={n === fragments.length - 1 ? layout.lines.slice(fr.fromLine) : layout.lines.slice(fr.fromLine, fr.toLine)}
              fontSize={effectiveFontSize}
              roleBold={roleStyle.fontStyle === 'bold'}
              color={textInkColor(obj.role, section)}
              opacity={revealed.has(obj.id) && !editing ? 1 : 0}
            />
          </Group>
        ))}
      </>
    )
  }
  // Only title/subtitle have a background: the subtitle's is the light tone of its
  // section (the title keeps the yellow); body text is written directly on the board.
  const background = textBackgroundFor(obj.role, section)
  // The subtitle text is the dark tone of its section; the rest is ink.
  const textColor = textInkColor(obj.role, section)
  return (
    <Group x={box.x} y={box.y} draggable={draggable} onDragMove={handleDrag} onDragEnd={handleDrag}>
      {/* bbox hit area: the Group is not registered here
          (text-type invariant: only the text node is registered). */}
      <Rect width={box.width} height={box.height} fill="black" opacity={0} />
      {/* Color background per role, under the text.
          Same opacity as the text so it appears together with it in the animation.
          listening=false so it does not interfere with the existing hit area. */}
      {background !== null && (
        <Rect
          width={box.width}
          height={box.height}
          fill={background}
          cornerRadius={6}
          listening={false}
          opacity={revealed.has(obj.id) ? 1 : 0}
        />
      )}
      <RunsText
        nodeRef={node => reg(obj.id, node)}
        lines={layout.lines}
        fontSize={effectiveFontSize}
        roleBold={roleStyle.fontStyle === 'bold'}
        color={textColor}
        opacity={revealed.has(obj.id) && !editing ? 1 : 0}
      />
    </Group>
  )
}
