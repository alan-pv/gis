// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { REPO_URL, isDemoMode, isDemoValue } from './demo-mode.js'

afterEach(() => { vi.unstubAllEnvs() })

describe('demo mode gating', () => {
  it('is on only for VITE_GIS_DEMO=1 / true', () => {
    expect(isDemoValue('1')).toBe(true)
    expect(isDemoValue('true')).toBe(true)
    expect(isDemoValue('0')).toBe(false)
    expect(isDemoValue(undefined)).toBe(false)
    expect(isDemoValue('')).toBe(false)
  })

  it('reads the env at call time', () => {
    vi.stubEnv('VITE_GIS_DEMO', '')
    expect(isDemoMode()).toBe(false)
    vi.stubEnv('VITE_GIS_DEMO', '1')
    expect(isDemoMode()).toBe(true)
  })

  it('exposes the repo URL placeholder in one place', () => {
    expect(REPO_URL).toBe('https://github.com/alan-pv/gis')
  })
})
