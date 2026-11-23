import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isPackaged: true,
  saved: undefined as boolean | undefined,
  savedThrows: false
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mocks.isPackaged
    }
  }
}))
vi.mock('./appsFlag', () => ({
  isAppsFlagOn: async () => mocks.saved ?? false,
  savedAppsFlag: () => {
    if (mocks.savedThrows) throw new Error('unreadable')
    return mocks.saved
  }
}))

import { appsEnabledAtStart, areAppsEnabled } from './appsConfig'
import { _setLocalOnlyForTests } from '../lib/localOnly'

beforeEach(() => {
  mocks.isPackaged = true
  mocks.saved = undefined
  mocks.savedThrows = false
})

afterEach(() => {
  vi.unstubAllEnvs()
  _setLocalOnlyForTests(undefined)
})

describe('areAppsEnabled', () => {
  it('follows the Apps switch when local-only mode is off', async () => {
    _setLocalOnlyForTests(false)
    mocks.saved = true
    expect(await areAppsEnabled()).toBe(true)
  })

  it('turns Apps off in local-only mode, even when the switch is on', async () => {
    _setLocalOnlyForTests(true)
    mocks.saved = true
    expect(await areAppsEnabled()).toBe(false)
  })

  it('turns Apps off in local-only mode, even with a developer Apps URL', async () => {
    _setLocalOnlyForTests(true)
    mocks.isPackaged = false
    vi.stubEnv('COMFY_APPS_URL', 'http://localhost:4321/apps/')
    expect(await areAppsEnabled()).toBe(false)
  })
})

describe('appsEnabledAtStart, for comfy.desktop.session.started', () => {
  it.each([true, false])('is the Apps switch the last session saved: %s', (saved) => {
    mocks.saved = saved

    expect(appsEnabledAtStart()).toBe(saved)
  })

  it('is unknown when no session saved the switch yet', () => {
    expect(appsEnabledAtStart()).toBeUndefined()
  })

  it('is unknown, and does not throw, when the saved switch cannot be read', () => {
    mocks.savedThrows = true

    expect(appsEnabledAtStart()).toBeUndefined()
  })

  it('is on in a development build pointed at an apps site', () => {
    mocks.isPackaged = false
    mocks.saved = false
    vi.stubEnv('COMFY_APPS_URL', 'http://127.0.0.1:5173/apps/')

    expect(appsEnabledAtStart()).toBe(true)
  })

  it('ignores an apps site in a packaged build', () => {
    vi.stubEnv('COMFY_APPS_URL', 'http://127.0.0.1:5173/apps/')
    mocks.saved = false

    expect(appsEnabledAtStart()).toBe(false)
  })
})
