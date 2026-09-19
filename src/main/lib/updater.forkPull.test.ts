import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const forkMocks = vi.hoisted(() => ({
  findSourceCheckout: vi.fn<() => string | null>(),
  isAutoCheckEnabled: vi.fn<() => boolean>(),
  runForkUpdate: vi.fn(async () => ({ available: true, version: 'abc12345' }))
}))
const todesktopMocks = vi.hoisted(() => ({
  checkForUpdates: vi.fn(async () => ({})),
  on: vi.fn()
}))

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '', getVersion: () => '1.0.0' },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}))
vi.mock('@todesktop/runtime', () => ({
  default: { autoUpdater: todesktopMocks }
}))
vi.mock('electron-updater', () => ({ autoUpdater: { autoInstallOnAppQuit: true } }))
vi.mock('../settings', () => ({ get: vi.fn(), set: vi.fn() }))
vi.mock('./quit-state', () => ({
  clearQuitReason: vi.fn(),
  setQuitReason: vi.fn(),
  getQuitReason: vi.fn(() => 'none'),
  isSessionEnding: vi.fn(() => false)
}))
vi.mock('./startup-attempt-marker', () => ({
  readStartupAttemptMarker: vi.fn(() => ({ state: 'absent' })),
  recordStartupAttempt: vi.fn(() => true),
  recordStartupAttemptOutcome: vi.fn(),
  clearStartupAttemptMarker: vi.fn()
}))
vi.mock('./forkUpdate', () => forkMocks)

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  forkMocks.findSourceCheckout.mockReturnValue('/repo')
  forkMocks.isAutoCheckEnabled.mockReturnValue(false)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('runCheck from a source checkout', { timeout: 30_000 }, () => {
  it.each(['manual-check', 'global-settings', 'app-menu'])(
    'pulls the configured repository for an explicit %s click',
    async (source) => {
      const updater = await import('./updater')

      const result = await updater.runCheck(source)

      expect(forkMocks.runForkUpdate).toHaveBeenCalledWith('/repo')
      expect(todesktopMocks.checkForUpdates).not.toHaveBeenCalled()
      expect(result).toEqual({ available: true, version: 'abc12345' })
    }
  )

  it('does not pull for a background check', async () => {
    const updater = await import('./updater')

    await updater.runCheck('auto-check')

    expect(forkMocks.runForkUpdate).not.toHaveBeenCalled()
  })

  it('uses the ToDesktop updater when there is no source checkout', async () => {
    forkMocks.findSourceCheckout.mockReturnValue(null)
    const updater = await import('./updater')

    await updater.runCheck('manual-check')

    expect(forkMocks.runForkUpdate).not.toHaveBeenCalled()
    expect(todesktopMocks.checkForUpdates).toHaveBeenCalledOnce()
  })
})

describe('background update checks are opt-in', { timeout: 30_000 }, () => {
  async function bootWithTimers() {
    vi.useFakeTimers()
    const updater = await import('./updater')
    updater.register()
    return updater
  }

  it('does not check on startup or on the interval by default', async () => {
    await bootWithTimers()

    await vi.advanceTimersByTimeAsync(11 * 60 * 1000)

    expect(todesktopMocks.checkForUpdates).not.toHaveBeenCalled()
  })

  it('checks once the user opts in, without needing a restart', async () => {
    await bootWithTimers()
    forkMocks.isAutoCheckEnabled.mockReturnValue(true)

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 100)

    expect(todesktopMocks.checkForUpdates).toHaveBeenCalled()
  })
})
