import { useState } from 'react'
import * as Menubar from '@radix-ui/react-menubar'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Check } from 'lucide-react'
import styles from './MenuBar.module.css'

/**
 * MenuBar — top menu bar on top of Radix Menubar: the View → Developer mode
 * checkbox, File entries (import JSON, play a lesson) and the provider badge
 * (visible only in developer mode). Every entry does something.
 */
export interface MenuBarProps {
  onNew: () => void
  onUndo: () => void
  canUndo: boolean
  onInsertPage: () => void
  devMode: boolean
  onToggleDevMode: () => void
  onImportJson: () => void
  providerBadge: string
  providerTone: 'loading' | 'none' | 'ok'
  /** Opens the lesson picker (File → Play a lesson…). */
  onOpenLessons: () => void
  /** Static demo build: hides the entries that need the local middleware / developer tools. */
  demo?: boolean
}

export function MenuBar({
  onNew, onUndo, canUndo, onInsertPage,
  devMode, onToggleDevMode, onImportJson, providerBadge, providerTone,
  onOpenLessons, demo = false,
}: MenuBarProps) {
  const [dialog, setDialog] = useState<null | 'shortcuts' | 'about'>(null)

  return (
    <>
      <Menubar.Root className={styles.bar}>
        <span className={styles.brand}>Gis</span>

        <Menubar.Menu>
          <Menubar.Trigger className={styles.trigger}>File</Menubar.Trigger>
          <Menubar.Portal>
            <Menubar.Content className={styles.content} align="start" sideOffset={4}>
              <Menubar.Item className={styles.item} onSelect={onNew}>New board</Menubar.Item>
              <Menubar.Item className={styles.item} onSelect={onOpenLessons}>Play a lesson…</Menubar.Item>
              {!demo && <Menubar.Item className={styles.item} onSelect={onImportJson}>Import JSON…</Menubar.Item>}
            </Menubar.Content>
          </Menubar.Portal>
        </Menubar.Menu>

        <Menubar.Menu>
          <Menubar.Trigger className={styles.trigger}>Edit</Menubar.Trigger>
          <Menubar.Portal>
            <Menubar.Content className={styles.content} align="start" sideOffset={4}>
              <Menubar.Item className={styles.item} disabled={!canUndo} onSelect={onUndo}>
                Undo stroke <span className={styles.shortcut}>Ctrl+Z</span>
              </Menubar.Item>
            </Menubar.Content>
          </Menubar.Portal>
        </Menubar.Menu>

        {!demo && <Menubar.Menu>
          <Menubar.Trigger className={styles.trigger}>View</Menubar.Trigger>
          <Menubar.Portal>
            <Menubar.Content className={styles.content} align="start" sideOffset={4}>
              <Menubar.CheckboxItem
                className={styles.item}
                checked={devMode}
                onCheckedChange={onToggleDevMode}
              >
                <Menubar.ItemIndicator className={styles.itemIndicator}>
                  <Check size={14} />
                </Menubar.ItemIndicator>
                Developer mode
              </Menubar.CheckboxItem>
            </Menubar.Content>
          </Menubar.Portal>
        </Menubar.Menu>}

        <Menubar.Menu>
          <Menubar.Trigger className={styles.trigger}>Insert</Menubar.Trigger>
          <Menubar.Portal>
            <Menubar.Content className={styles.content} align="start" sideOffset={4}>
              <Menubar.Item className={styles.item} onSelect={onInsertPage}>Page</Menubar.Item>
            </Menubar.Content>
          </Menubar.Portal>
        </Menubar.Menu>

        <Menubar.Menu>
          <Menubar.Trigger className={styles.trigger}>Help</Menubar.Trigger>
          <Menubar.Portal>
            <Menubar.Content className={styles.content} align="start" sideOffset={4}>
              <Menubar.Item className={styles.item} onSelect={() => setDialog('shortcuts')}>Keyboard shortcuts</Menubar.Item>
              <Menubar.Item className={styles.item} onSelect={() => setDialog('about')}>About Gis</Menubar.Item>
            </Menubar.Content>
          </Menubar.Portal>
        </Menubar.Menu>

        <span className={styles.spacer} />

        {devMode && !demo && (
          <span className={styles.provider} data-tone={providerTone}>
            {providerBadge}
          </span>
        )}
      </Menubar.Root>

      <Dialog.Root open={dialog === 'shortcuts'} onOpenChange={(o) => { if (!o) setDialog(null) }}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.overlay} />
          <Dialog.Content className={styles.dialog} aria-describedby={undefined}>
            <Dialog.Title className={styles.dialogTitle}>Keyboard shortcuts</Dialog.Title>
            <table className={styles.shortcutsTable}>
              <tbody>
                <tr><td>V</td><td>Move tool</td></tr>
                <tr><td>P</td><td>Pen tool</td></tr>
                <tr><td>E</td><td>Eraser tool</td></tr>
                <tr><td>Ctrl+Z</td><td>Undo the last ink stroke</td></tr>
                <tr><td>Delete / Backspace</td><td>Delete the selected object</td></tr>
              </tbody>
            </table>
            <Dialog.Close className={styles.dialogClose} aria-label="Close"><X size={16} /></Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={dialog === 'about'} onOpenChange={(o) => { if (!o) setDialog(null) }}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.overlay} />
          <Dialog.Content className={styles.dialog} aria-describedby={undefined}>
            <Dialog.Title className={styles.dialogTitle}>About Gis</Dialog.Title>
            <div className={styles.about}>
              <p>Gis is a free, open source smart blackboard for teachers: while you talk, it writes and draws on the board — structured text, concepts, arrows and emphasis — as if a hand were writing live. It doesn't replace the teacher; it helps them.</p>
              <p>MIT licensed. No ads, ever.</p>
            </div>
            <Dialog.Close className={styles.dialogClose} aria-label="Close"><X size={16} /></Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}
