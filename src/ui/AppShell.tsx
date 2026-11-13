import type { ReactNode } from 'react'
import styles from './AppShell.module.css'

/**
 * AppShell — layout scaffold of the UI.
 * Pure presentational component: it receives each region as a slot and places it
 * in a CSS grid. It has no state or logic; App.tsx owns all the state and the
 * handlers. The developer windows (DevDock + DevWindow) go in the overlays slot.
 */
export interface AppShellProps {
  /** Top bar with the menu bar. */
  menubar: ReactNode
  /** Toolbar (select/pen/eraser, etc.). */
  toolbar: ReactNode
  /** Error/info/warning banners (full width). Only visible in developer mode. */
  banners?: ReactNode
  /** Left vertical rail (page thumbnails). */
  rail: ReactNode
  /** Central stage: the canvas and its anchored overlays. */
  stage: ReactNode
  /** App-level overlays (modals, DevDock in developer mode). Rendered outside the grid. */
  overlays?: ReactNode
}

export function AppShell({ menubar, toolbar, banners, rail, stage, overlays }: AppShellProps) {
  return (
    <div className={styles.shell}>
      <div className={styles.menubar}>{menubar}</div>
      <div className={styles.toolbar}>{toolbar}</div>
      <div className={styles.banners}>{banners}</div>
      <div className={styles.rail}>{rail}</div>
      <div className={styles.stage}>{stage}</div>
      {overlays}
    </div>
  )
}
