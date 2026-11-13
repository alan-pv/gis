import type { ComponentType } from 'react'
import { MousePointer2, Pencil, Eraser, Undo2 } from 'lucide-react'
import * as Tooltip from '@radix-ui/react-tooltip'
import * as Popover from '@radix-ui/react-popover'
import type { CanvasTool } from '@/canvas/SceneCanvas.js'
import type { Color } from '@/ink/index.js'
import { PALETTE_HEX } from '@/canvas/palette.js'
import styles from './Toolbar.module.css'

/**
 * Toolbar — toolbar with icons: tools as lucide icons with a tooltip (name +
 * shortcut) and the pen color in a popover. Presentation only.
 */
export interface ToolbarProps {
  tool: CanvasTool
  onSetTool: (t: CanvasTool) => void
  penColor: Color
  onSetPenColor: (c: Color) => void
  canUndo: boolean
  onUndo: () => void
}

/** Icon button with a Radix tooltip (name + shortcut). */
function ToolButton({
  icon: Icon, label, active, disabled, onClick,
}: {
  icon: ComponentType<{ size?: number; strokeWidth?: number }>
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          className={styles.iconBtn}
          data-active={active ? 'true' : undefined}
          disabled={disabled}
          onClick={onClick}
          aria-label={label}
        >
          <Icon size={18} strokeWidth={1.75} />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className={styles.tooltip} sideOffset={6}>
          {label}
          <Tooltip.Arrow className={styles.tooltipArrow} />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

/** Pen color popover, anchored to a swatch showing the active color. */
/** English display names for the contract's color literals (UI only; the literals are untouched). */
const COLOR_NAME: Record<Color, string> = {
  negro: 'Black', azul: 'Blue', rojo: 'Red', verde: 'Green',
  amarillo: 'Yellow', naranja: 'Orange', café: 'Brown', gris: 'Gray',
}

function ColorPopover({ penColor, onSetPenColor }: { penColor: Color; onSetPenColor: (c: Color) => void }) {
  return (
    <Popover.Root>
      <Tooltip.Root>
        <Popover.Trigger asChild>
          <Tooltip.Trigger asChild>
            <button type="button" className={styles.swatchTrigger} aria-label="Pen color">
              <span className={styles.swatchDot} style={{ background: PALETTE_HEX[penColor] }} />
            </button>
          </Tooltip.Trigger>
        </Popover.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className={styles.tooltip} sideOffset={6}>
            Pen color
            <Tooltip.Arrow className={styles.tooltipArrow} />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
      <Popover.Portal>
        <Popover.Content className={styles.popover} sideOffset={8} align="start">
          <div className={styles.swatchGrid}>
            {(Object.entries(PALETTE_HEX) as [Color, string][]).map(([color, hex]) => (
              <Popover.Close asChild key={color}>
                <button
                  type="button"
                  title={COLOR_NAME[color]}
                  aria-label={COLOR_NAME[color]}
                  className={styles.swatch}
                  data-selected={penColor === color ? 'true' : undefined}
                  style={{ background: hex }}
                  onClick={() => onSetPenColor(color)}
                />
              </Popover.Close>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

export function Toolbar({
  tool, onSetTool, penColor, onSetPenColor, canUndo, onUndo,
}: ToolbarProps) {
  return (
    <Tooltip.Provider delayDuration={300} skipDelayDuration={500}>
      <div className={styles.bar}>
        <ToolButton icon={MousePointer2} label="Move · V" active={tool === 'select'} onClick={() => onSetTool('select')} />
        <ToolButton icon={Pencil} label="Pen · P" active={tool === 'pen'} onClick={() => onSetTool('pen')} />
        {tool === 'pen' && <ColorPopover penColor={penColor} onSetPenColor={onSetPenColor} />}
        <ToolButton icon={Eraser} label="Eraser · E" active={tool === 'eraser'} onClick={() => onSetTool('eraser')} />
        <div className={styles.divider} />
        <ToolButton icon={Undo2} label="Undo stroke · Ctrl+Z" disabled={!canUndo} onClick={onUndo} />
      </div>
    </Tooltip.Provider>
  )
}
