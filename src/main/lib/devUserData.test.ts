import { describe, expect, it, vi } from 'vitest'
import path from 'path'

// The module applies its result on import; a packaged app makes that a no-op here.
vi.mock('electron', () => ({
  app: { isPackaged: true, getPath: () => '/appdata', setPath: vi.fn() }
}))

import { resolveDevUserDataDir } from './devUserData'

const base = { isPackaged: false, platform: 'win32' as const, appDataDir: '/appdata' }

describe('resolveDevUserDataDir', () => {
  it("points an unpackaged run at the installed app's userData folder", () => {
    expect(resolveDevUserDataDir(base)).toBe(path.join('/appdata', 'Comfy Desktop'))
    expect(resolveDevUserDataDir({ ...base, platform: 'darwin' })).toBe(
      path.join('/appdata', 'Comfy Desktop')
    )
  })

  it('leaves a packaged app on its own default', () => {
    expect(resolveDevUserDataDir({ ...base, isPackaged: true })).toBeNull()
  })

  it('leaves Linux alone, where config paths are XDG-based and already shared', () => {
    expect(resolveDevUserDataDir({ ...base, platform: 'linux' })).toBeNull()
  })

  it('honors an explicit override for an isolated dev profile', () => {
    expect(resolveDevUserDataDir({ ...base, override: '/tmp/dev-profile' })).toBe(
      path.resolve('/tmp/dev-profile')
    )
  })

  it('ignores a blank override', () => {
    expect(resolveDevUserDataDir({ ...base, override: '   ' })).toBe(
      path.join('/appdata', 'Comfy Desktop')
    )
  })
})
