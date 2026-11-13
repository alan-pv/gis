/**
 * App.test.tsx — checks that the REALLY rendered `MicButton` (the floating one,
 * always visible in the teacher view; NOT the debug push-to-talk button of the dev
 * console, which only mounts with developer mode on) drives the continuous Web
 * Speech session.
 *
 * The integration lives in `handleToggleContinuous` (the main MicButton's handler
 * in App.tsx), so the test exercises it from the visible button inward.
 *
 * It isolates `<App/>` from its external dependencies:
 *   - global `fetch` stubbed to reject: every initialization call is wrapped in
 *     try/catch in the real code and falls back to its defaults without breaking
 *     the render.
 *   - `SceneCanvas` mocked to `null`: it uses react-konva/Konva, which has no real
 *     canvas implementation in happy-dom; irrelevant here (nothing about the canvas
 *     is tested).
 *   - `@/speech/index.js` partially mocked: `startWebSpeechContinuous` is spied on
 *     to verify that the click starts/stops it; the rest of the module stays intact
 *     via `importOriginal`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
import App from './App.js'
import type { WebSpeechContinuousCallbacks, WebSpeechContinuousHandle } from '@/speech/index.js'

// ── Mocks (vi.mock is hoisted above the imports; vi.hoisted exposes the spies) ──

const { mockHandleStop, mockStartContinuous, canvasProps, mockCheckSidecar } = vi.hoisted(() => {
  const canvasProps: { current: { onAnimationDone?: () => void } } = { current: {} }
  const mockCheckSidecar = vi.fn<() => Promise<boolean>>()
  const mockHandleStop = vi.fn()
  const mockStartContinuous = vi.fn(
    (_callbacks: WebSpeechContinuousCallbacks): WebSpeechContinuousHandle => ({ stop: mockHandleStop }),
  )
  return { mockHandleStop, mockStartContinuous, canvasProps, mockCheckSidecar }
})

// SceneCanvas is mocked; it exposes its props so tests can signal "animation done".
vi.mock('@/canvas/SceneCanvas.js', () => ({
  SceneCanvas: (props: { onAnimationDone?: () => void }) => { canvasProps.current = props; return null },
}))

vi.mock('@/sidecar/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/sidecar/index.js')>()
  return { ...actual, checkSidecar: mockCheckSidecar }
})

vi.mock('@/speech/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/speech/index.js')>()
  return {
    ...actual,
    startWebSpeechContinuous: mockStartContinuous,
  }
})

beforeEach(() => {
  mockHandleStop.mockClear()
  mockStartContinuous.mockClear()
  mockCheckSidecar.mockReset()
  mockCheckSidecar.mockResolvedValue(true)
  // No network in the test: all the initialization code that calls fetch() is
  // wrapped in try/catch in its real implementation (see the docstring).
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no network in the test')))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('App — main MicButton', () => {
  it('a click on the visible MicButton starts the continuous session; another click stops it', () => {
    render(<App />)

    const button = screen.getByRole('button', { name: /turn on microphone/i })
    expect(mockStartContinuous).not.toHaveBeenCalled()

    fireEvent.click(button)
    expect(mockStartContinuous).toHaveBeenCalledTimes(1)
    expect(mockHandleStop).not.toHaveBeenCalled()

    // After the first click the button reflects "listening" (aria-label changes:
    // MicButton derives the label from `active`, which App derives from isContinuous).
    const activeButton = screen.getByRole('button', { name: /mute microphone/i })
    fireEvent.click(activeButton)
    expect(mockHandleStop).toHaveBeenCalledTimes(1)
    // Stopping does not restart by itself (that is startWebSpeechContinuous's job
    // when the BROWSER closes the session, not this toggle's).
    expect(mockStartContinuous).toHaveBeenCalledTimes(1)

    // And the button goes back to "Turn on microphone" (getByRole throws if missing).
    screen.getByRole('button', { name: /turn on microphone/i })
  })

  it('startWebSpeechContinuous is called with the expected callbacks contract (onPhrase/onPartial/onError/onFatal)', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /turn on microphone/i }))

    expect(mockStartContinuous).toHaveBeenCalledTimes(1)
    const callbacks = mockStartContinuous.mock.calls[0]![0]
    expect(typeof callbacks.onPhrase).toBe('function')
    expect(typeof callbacks.onPartial).toBe('function')
    expect(typeof callbacks.onError).toBe('function')
    expect(typeof callbacks.onFatal).toBe('function')

    // Delivering a final phrase must not throw: enqueuePhrase (same path as the
    // STT's `onClause`) accepts it like any continuous-mode phrase. Checking the
    // effect on the queue would require opening developer mode, out of scope for
    // this test (it only covers the wiring of the real MicButton).
    // act(): onPhrase triggers setState (enqueuePhrase) outside a DOM event.
    expect(() => act(() => { callbacks.onPhrase('draw the sun', { sttMs: 12, sttFirstPartialMs: 340 }) })).not.toThrow()
  })

  it('onFatal (permission denied / too many consecutive errors) leaves the MicButton muted', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /turn on microphone/i }))

    const callbacks = mockStartContinuous.mock.calls[0]![0]
    // act(): onFatal triggers several setStates outside a DOM event (the real
    // caller is startWebSpeechContinuous, not a React handler).
    act(() => { callbacks.onFatal('Web Speech API: microphone permission denied.') })

    // The button goes back to "muted" without the teacher clicking again
    // (getByRole throws if it does not exist).
    screen.getByRole('button', { name: /turn on microphone/i })
  })
})

describe('App — offline sidecar message', () => {
  it('shows a clear message instead of failing silently when the sidecar is offline', async () => {
    mockCheckSidecar.mockResolvedValue(false)
    render(<App />)
    // Let the initial sidecar check settle.
    await act(async () => { await Promise.resolve() })

    fireEvent.click(screen.getByRole('button', { name: /turn on microphone/i }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain("The local model isn't running. Start it with `npm start`.")
    expect(mockStartContinuous).not.toHaveBeenCalled()
  })
})

describe('App — static demo mode', () => {
  beforeEach(() => { vi.stubEnv('VITE_GIS_DEMO', '1') })

  it('makes no sidecar or middleware calls and disables the microphone', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('no network'))
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    await act(async () => { await Promise.resolve() })

    expect(mockCheckSidecar).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    const mic = screen.getByRole('button', { name: /voice input needs the local version/i, hidden: true })
    expect((mic as HTMLButtonElement).disabled).toBe(true)
    // The cloud-STT privacy badge does not apply (no voice in the demo).
    expect(screen.queryByText(/STT: Google/)).toBeNull()
  })

  it('opens the welcome card with the lessons and the repo link on first load', () => {
    render(<App />)
    expect(screen.getByText('Gis — smart blackboard')).toBeTruthy()
    expect(screen.getByText(/Pick a lesson to watch Gis draw it live/)).toBeTruthy()
    expect(screen.getByText('The food chain')).toBeTruthy()
    expect(screen.getByRole('link', { name: /github\.com\/alan-pv\/gis/ })).toBeTruthy()
  })

  it('plays a chosen lesson: caption of turn 1, then advances to turn 2 after the animation', async () => {
    render(<App />)
    fireEvent.click(screen.getByText('The food chain'))

    // Welcome card closed, player bar visible; first turn starts after a short beat.
    const player = await screen.findByRole('region', { name: /lesson player/i })
    await waitFor(() => expect(player.textContent).toMatch(/turn 1 of/), { timeout: 3000 })

    // The turn is animating (steps > 0): no auto-advance until the animation ends.
    act(() => { canvasProps.current.onAnimationDone?.() })
    // Next skips the reading pause.
    const next = screen.getByRole('button', { name: /next turn/i }) as HTMLButtonElement
    await waitFor(() => expect(next.disabled).toBe(false))
    fireEvent.click(next)
    await waitFor(() => expect(player.textContent).toMatch(/turn 2 of/), { timeout: 3000 })

    // Pause / resume / stop controls.
    fireEvent.click(screen.getByRole('button', { name: /^pause$/i }))
    screen.getByRole('button', { name: /^resume$/i })
    fireEvent.click(screen.getByRole('button', { name: /^stop$/i }))
    expect(screen.queryByRole('region', { name: /lesson player/i })).toBeNull()
  })
})

describe('App — lessons are a normal feature (local mode)', () => {
  it('File → Play a lesson… lists the recorded lessons', async () => {
    render(<App />)
    const file = screen.getByRole('menuitem', { name: 'File' })
    act(() => { file.focus() })
    fireEvent.keyDown(file, { key: 'ArrowDown' })
    const item = await screen.findByRole('menuitem', { name: /play a lesson/i })
    fireEvent.click(item)
    expect(await screen.findByText('The food chain')).toBeTruthy()
  })
})
