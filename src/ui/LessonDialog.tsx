import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { LoadedSeed } from '@/demo/lessons.js'
import { REPO_URL } from '@/demo/demo-mode.js'
import styles from './Lessons.module.css'

export interface LessonDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  lessons: LoadedSeed[]
  onPick: (seedId: string) => void
  /** First-load card of the static demo: welcome text and a link to the repository. */
  welcome?: boolean
}

/** Picker of recorded lessons (File → Play a lesson…) and, in demo mode, the welcome card. */
export function LessonDialog({ open, onOpenChange, lessons, onPick, welcome = false }: LessonDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.dialog} aria-describedby={undefined}>
          <Dialog.Title className={styles.title}>{welcome ? 'Gis — smart blackboard' : 'Play a lesson'}</Dialog.Title>
          <p className={styles.intro}>
            {welcome
              ? 'Pick a lesson to watch Gis draw it live.'
              : 'Pick a recorded lesson to watch Gis draw it live, exactly as it does while a teacher speaks.'}
          </p>
          <ul className={styles.list}>
            {lessons.map(lesson => (
              <li key={lesson.id}>
                <button type="button" className={styles.lesson} onClick={() => onPick(lesson.id)}>
                  <span>{lesson.label}</span>
                  <span className={styles.turns}>{lesson.turns.length} turns</span>
                </button>
              </li>
            ))}
          </ul>
          {welcome && (
            <p className={styles.repo}>
              Free and open source — <a href={REPO_URL} target="_blank" rel="noreferrer">{REPO_URL}</a>
            </p>
          )}
          <Dialog.Close className={styles.close} aria-label="Close"><X size={16} /></Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
