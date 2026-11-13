import type { ReactNode } from 'react'
import styles from './DevDock.module.css'

/**
 * DevDock — fixed container anchored to the right that stacks DevWindows.
 * Only visible in developer mode; App.tsx controls the condition.
 */
export interface DevDockProps {
  children: ReactNode
}

export function DevDock({ children }: DevDockProps) {
  return (
    <div className={styles.dock}>
      {children}
    </div>
  )
}
