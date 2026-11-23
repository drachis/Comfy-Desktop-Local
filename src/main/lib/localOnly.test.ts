import { afterEach, describe, expect, it } from 'vitest'
import { _setLocalOnlyForTests, isHiddenByLocalOnly, readLocalOnly } from './localOnly'

afterEach(() => {
  _setLocalOnlyForTests(undefined)
})

describe('readLocalOnly', () => {
  it('is off without the flag or the environment variable', () => {
    expect(readLocalOnly(['electron', '.'], {})).toBe(false)
  })

  it('turns on with --local-only on the command line', () => {
    expect(readLocalOnly(['electron', '.', '--local-only'], {})).toBe(true)
  })

  it.each(['1', 'true', 'TRUE', ' true '])('turns on with COMFY_LOCAL_ONLY=%s', (value) => {
    expect(readLocalOnly([], { COMFY_LOCAL_ONLY: value })).toBe(true)
  })

  it.each(['0', 'false', ''])('stays off with COMFY_LOCAL_ONLY=%s', (value) => {
    expect(readLocalOnly([], { COMFY_LOCAL_ONLY: value })).toBe(false)
  })
})

describe('isHiddenByLocalOnly', () => {
  it('hides the Cloud build only while local-only is on', () => {
    _setLocalOnlyForTests(true)
    expect(isHiddenByLocalOnly({ sourceId: 'cloud' })).toBe(true)
    expect(isHiddenByLocalOnly({ sourceId: 'git' })).toBe(false)

    _setLocalOnlyForTests(false)
    expect(isHiddenByLocalOnly({ sourceId: 'cloud' })).toBe(false)
  })
})
