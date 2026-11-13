/**
 * MicButton — floating microphone button of the teacher.
 *
 * The only voice control in the teacher view: toggles listening / muted (continuous
 * mode). No text feedback; that lives in the developer console.
 */
import { Mic, MicOff } from 'lucide-react'
import styles from './MicButton.module.css'

export interface MicButtonProps {
  /** true = listening in continuous mode; false = muted. */
  active: boolean
  /** true = speech unavailable or busy: inert button. */
  disabled: boolean
  /** Toggles listening / muted. */
  onClick: () => void
  /** Tooltip / accessible name when disabled (e.g. the demo build). */
  disabledReason?: string
}

export function MicButton({ active, disabled, onClick, disabledReason }: MicButtonProps) {
  const ariaLabel = disabled
    ? (disabledReason ?? 'Microphone unavailable')
    : active
      ? 'Mute microphone'
      : 'Turn on microphone'

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={`${styles.btn} ${active ? styles.listening : styles.muted}`}
        disabled={disabled}
        onClick={onClick}
        aria-label={ariaLabel}
        title={ariaLabel}
      >
        {active && !disabled
          ? <Mic size={24} strokeWidth={1.75} />
          : <MicOff size={24} strokeWidth={1.75} />
        }
      </button>
    </div>
  )
}
