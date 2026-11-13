import { Pause, Play, SkipForward, Square } from 'lucide-react'
import type { PlayerState } from '@/demo/lesson-player.js'
import styles from './Lessons.module.css'

export interface LessonPlayerBarProps {
  state: PlayerState
  title: string
  caption: string
  canNext: boolean
  onPause: () => void
  onResume: () => void
  onNext: () => void
  onStop: () => void
}

/** Subtitle bar + controls shown at the bottom while a recorded lesson plays. */
export function LessonPlayerBar({ state, title, caption, canNext, onPause, onResume, onNext, onStop }: LessonPlayerBarProps) {
  const finished = state.status === 'finished'
  const paused = state.status === 'paused'
  return (
    <div className={styles.bar} role="region" aria-label="Lesson player">
      <p className={styles.caption} aria-live="polite">{caption || ' '}</p>
      <div className={styles.controls}>
        {!finished && (paused ? (
          <button type="button" className={styles.ctl} onClick={onResume} aria-label="Resume"><Play size={14} /> Resume</button>
        ) : (
          <button type="button" className={styles.ctl} onClick={onPause} aria-label="Pause"><Pause size={14} /> Pause</button>
        ))}
        <button type="button" className={styles.ctl} onClick={onNext} disabled={!canNext} aria-label="Next turn">
          <SkipForward size={14} /> Next
        </button>
        <button type="button" className={styles.ctl} onClick={onStop} aria-label={finished ? 'Close' : 'Stop'}>
          <Square size={14} /> {finished ? 'Close' : 'Stop'}
        </button>
        <span className={styles.progress}>
          {title} · {finished ? 'finished' : `turn ${Math.max(state.shown + 1, 0)} of ${state.total}`}
        </span>
      </div>
    </div>
  )
}
