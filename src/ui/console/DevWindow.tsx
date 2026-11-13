import type { ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import styles from './DevWindow.module.css'

/**
 * DevWindow — independent collapsible card for the DevDock.
 * Each window is self-contained: it has its own collapsed state (managed by App).
 * The dock stacks them; they cannot be dragged (anchored to the right).
 * Accessibility: the header is a <button> with aria-expanded.
 */
export interface DevWindowProps {
  title: string
  icon?: ReactNode
  collapsed: boolean
  onToggleCollapse: () => void
  children: ReactNode
}

export function DevWindow({ title, icon, collapsed, onToggleCollapse, children }: DevWindowProps) {
  return (
    <div className={styles.window}>
      <button
        className={styles.header}
        onClick={onToggleCollapse}
        aria-expanded={!collapsed}
      >
        <span className={styles.headerLeft}>
          {icon && <span className={styles.icon}>{icon}</span>}
          <span className={styles.title}>{title}</span>
        </span>
        <span className={styles.chevron} aria-label={collapsed ? 'Expand' : 'Collapse'}>
          {collapsed ? <ChevronRight size={14} strokeWidth={1.75} /> : <ChevronDown size={14} strokeWidth={1.75} />}
        </span>
      </button>
      {!collapsed && (
        <div className={styles.body}>
          {children}
        </div>
      )}
    </div>
  )
}
