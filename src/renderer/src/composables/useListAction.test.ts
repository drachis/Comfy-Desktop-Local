import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key
  })
}))

const mockModalConfirm = vi.hoisted(() => vi.fn())
const mockModalAlert = vi.hoisted(() => vi.fn())
vi.mock('./useModal', () => ({
  useModal: () => ({ confirm: mockModalConfirm, alert: mockModalAlert })
}))

const mockDialogsConfirm = vi.hoisted(() => vi.fn())
vi.mock('./useDialogs', () => ({
  useDialogs: () => ({ confirm: mockDialogsConfirm })
}))

const mockCheckBeforeAction = vi.hoisted(() => vi.fn())
vi.mock('./useActionGuard', () => ({
  useActionGuard: () => ({ checkBeforeAction: mockCheckBeforeAction })
}))

const mockCheckBeforeLaunch = vi.hoisted(() => vi.fn())
vi.mock('./useLocalInstanceGuard', () => ({
  useLocalInstanceGuard: () => ({ checkBeforeLaunch: mockCheckBeforeLaunch })
}))

const sessionState = vi.hoisted(() => ({
  running: new Set<string>(),
  errorCleared: [] as string[],
  operations: new Map<string, { actionId: string }>()
}))
vi.mock('../stores/sessionStore', () => ({
  useSessionStore: () => ({
    operationInstances: sessionState.operations,
    isRunning: (id: string) => sessionState.running.has(id),
    clearErrorInstance: (id: string) => {
      sessionState.errorCleared.push(id)
    }
  })
}))

vi.mock('../lib/telemetry', () => ({
  emitTelemetryAction: vi.fn(),
  toErrorBucket: () => 'unknown'
}))

const mockRunAction = vi.hoisted(() => vi.fn())
const mockOpenInstancePicker = vi.hoisted(() => vi.fn())
;(
  globalThis as unknown as {
    window: {
      api: { runAction: typeof mockRunAction; openInstancePicker: typeof mockOpenInstancePicker }
    }
  }
).window = {
  api: { runAction: mockRunAction, openInstancePicker: mockOpenInstancePicker }
}

import { useListAction } from './useListAction'
import type { Installation, ListAction } from '../types/ipc'

function makeInstall(overrides: Partial<Installation> = {}): Installation {
  return {
    id: 'inst-1',
    name: 'Legacy Desktop',
    sourceLabel: 'Legacy Desktop',
    // Legacy Desktop reports category `local`; the `desktop` sourceId is the marker.
    sourceCategory: 'local',
    sourceId: 'desktop',
    status: 'installed',
    ...overrides
  } as Installation
}

const launchAction: ListAction = {
  id: 'launch',
  label: 'Launch',
  style: 'primary',
  enabled: true
}

describe('useListAction — desktop launch interceptor', () => {
  beforeEach(() => {
    sessionState.running.clear()
    sessionState.errorCleared.length = 0
    mockDialogsConfirm.mockReset()
    mockModalConfirm.mockReset()
    mockModalAlert.mockReset()
    mockCheckBeforeAction.mockReset().mockResolvedValue(true)
    mockCheckBeforeLaunch.mockReset().mockResolvedValue(true)
    mockRunAction.mockReset()
  })

  it('on migrate: emits show-progress with an apiCall that chains migrate → launch', async () => {
    mockDialogsConfirm.mockResolvedValueOnce('primary')
    mockRunAction
      .mockResolvedValueOnce({ ok: true, newInstallationId: 'inst-adopted-1' }) // migrate-to-standalone
      .mockResolvedValueOnce({ ok: true }) // launch on adopted

    const showProgress = vi.fn()
    const { executeAction } = useListAction('chooser', { showProgress })

    await executeAction(makeInstall({ adopted: false }), launchAction)

    // Migrating is offered as an option next to launching the original app, never forced.
    expect(mockDialogsConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'desktop.migrateBeforeLaunchTitle',
        confirmLabel: 'desktop.migrateBeforeLaunchConfirm',
        secondaryLabel: 'desktop.launchLegacyApp',
        showCancel: true
      })
    )
    expect(showProgress).toHaveBeenCalledOnce()
    const opts = showProgress.mock.calls[0]![0] as { apiCall: () => Promise<unknown> }
    const apiResult = await opts.apiCall()
    expect(mockRunAction).toHaveBeenNthCalledWith(1, 'inst-1', 'migrate-to-standalone')
    expect(mockRunAction).toHaveBeenNthCalledWith(2, 'inst-adopted-1', 'launch')
    expect(apiResult).toEqual({ ok: true })
  })

  it('on launch-as-is: skips migration and runs the normal launch on the same install', async () => {
    mockDialogsConfirm.mockResolvedValueOnce('secondary')
    mockRunAction.mockResolvedValueOnce({ ok: true })
    const showProgress = vi.fn()
    const { executeAction } = useListAction('chooser', { showProgress })

    await executeAction(makeInstall({ adopted: false }), {
      ...launchAction,
      showProgress: true,
      progressTitle: 'Launch'
    })

    expect(showProgress).toHaveBeenCalledOnce()
    const opts = showProgress.mock.calls[0]![0] as { apiCall: () => Promise<unknown> }
    await opts.apiCall()
    expect(mockRunAction).toHaveBeenCalledOnce()
    expect(mockRunAction).toHaveBeenCalledWith('inst-1', 'launch')
  })

  it('on cancel: emits nothing — neither migrate nor launch run', async () => {
    mockDialogsConfirm.mockResolvedValueOnce(false)
    const showProgress = vi.fn()
    const { executeAction } = useListAction('chooser', { showProgress })

    await executeAction(makeInstall({ adopted: false }), launchAction)

    expect(showProgress).not.toHaveBeenCalled()
    expect(mockRunAction).not.toHaveBeenCalled()
  })

  it('skips the interceptor when the install is already adopted', async () => {
    const showProgress = vi.fn()
    const { executeAction } = useListAction('chooser', { showProgress })

    await executeAction(makeInstall({ adopted: true }), {
      ...launchAction,
      showProgress: true,
      progressTitle: 'Launch'
    })

    expect(mockDialogsConfirm).not.toHaveBeenCalled()
    expect(showProgress).toHaveBeenCalledOnce()
    const opts = showProgress.mock.calls[0]![0] as { apiCall: () => Promise<unknown> }
    void opts.apiCall()
    expect(mockRunAction).toHaveBeenCalledWith('inst-1', 'launch')
  })

  it('skips the interceptor for non-desktop sources', async () => {
    const showProgress = vi.fn()
    const { executeAction } = useListAction('chooser', { showProgress })

    await executeAction(makeInstall({ sourceId: 'standalone', sourceCategory: 'local' }), {
      ...launchAction,
      showProgress: true
    })

    expect(mockDialogsConfirm).not.toHaveBeenCalled()
    expect(showProgress).toHaveBeenCalledOnce()
  })

  it('apiCall short-circuits if migrate fails — does not attempt launch', async () => {
    mockDialogsConfirm.mockResolvedValueOnce('primary')
    mockRunAction.mockResolvedValueOnce({ ok: false, message: 'no-legacy-install' })

    const showProgress = vi.fn()
    const { executeAction } = useListAction('chooser', { showProgress })
    await executeAction(makeInstall({ adopted: false }), launchAction)

    const opts = showProgress.mock.calls[0]![0] as { apiCall: () => Promise<unknown> }
    const apiResult = await opts.apiCall()
    expect(mockRunAction).toHaveBeenCalledTimes(1)
    expect(apiResult).toEqual({ ok: false, message: 'no-legacy-install' })
  })
})

const INSTALL: Installation = {
  id: 'inst-launch',
  name: 'Test Install',
  sourceLabel: 'standalone',
  sourceCategory: 'local'
}

const LAUNCH_ACTION: ListAction = {
  id: 'launch',
  label: 'Launch',
  style: 'primary',
  showProgress: true
}

describe('useListAction.executeAction onGuardsPassed hook', () => {
  beforeEach(() => {
    sessionState.running.clear()
    sessionState.errorCleared.length = 0
    mockModalConfirm.mockReset()
    mockModalAlert.mockReset()
    mockCheckBeforeAction.mockReset().mockResolvedValue(true)
    mockCheckBeforeLaunch.mockReset().mockResolvedValue(true)
    mockRunAction.mockReset().mockResolvedValue({ ok: true })
  })

  it('fires onGuardsPassed when every guard resolves positively', async () => {
    const onGuardsPassed = vi.fn(async () => {})
    const showProgress = vi.fn()
    const { executeAction } = useListAction('chooser', { showProgress })

    await executeAction(INSTALL, LAUNCH_ACTION, { onGuardsPassed })

    expect(onGuardsPassed).toHaveBeenCalledOnce()
    expect(showProgress).toHaveBeenCalledOnce()
    // Hook must fire BEFORE showProgress so the chooser claim is in place
    // by the time the launch op is dispatched.
    expect(onGuardsPassed.mock.invocationCallOrder[0]).toBeLessThan(
      showProgress.mock.invocationCallOrder[0]
    )
  })

  it('forwards restart intent to the local-instance launch guard', async () => {
    const showProgress = vi.fn()
    const { executeAction } = useListAction('chooser', { showProgress })

    await executeAction(INSTALL, LAUNCH_ACTION, { isRestart: true })

    expect(mockCheckBeforeLaunch).toHaveBeenCalledWith('inst-launch', { isRestart: true })
    expect(showProgress).toHaveBeenCalledOnce()
  })

  it('does NOT fire onGuardsPassed when the action is disabled', async () => {
    const onGuardsPassed = vi.fn()
    const showProgress = vi.fn()
    const disabledAction: ListAction = {
      ...LAUNCH_ACTION,
      enabled: false,
      disabledMessage: 'Cannot launch right now'
    }
    const { executeAction } = useListAction('chooser', { showProgress })

    await executeAction(INSTALL, disabledAction, { onGuardsPassed })

    expect(mockModalAlert).toHaveBeenCalledOnce()
    expect(onGuardsPassed).not.toHaveBeenCalled()
    expect(showProgress).not.toHaveBeenCalled()
  })

  describe('launching while another operation is running on the install', () => {
    beforeEach(() => {
      sessionState.operations.clear()
    })

    it('refuses, and says what the install is busy with', async () => {
      sessionState.operations.set(INSTALL.id, { actionId: 'create-venv' })
      const showProgress = vi.fn()
      const { executeAction } = useListAction('chooser', { showProgress })

      await executeAction(INSTALL, LAUNCH_ACTION)

      expect(mockModalAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Creating Python environment')
        })
      )
      expect(showProgress).not.toHaveBeenCalled()
      expect(mockCheckBeforeLaunch).not.toHaveBeenCalled()
    })

    it('does not treat the launch itself or a quick action as blocking', async () => {
      sessionState.operations.set(INSTALL.id, { actionId: 'rename' })
      const { executeAction } = useListAction('chooser', { showProgress: vi.fn() })

      await executeAction(INSTALL, LAUNCH_ACTION)

      expect(mockCheckBeforeLaunch).toHaveBeenCalled()
    })
  })

  describe('launching an install that needs a setup step', () => {
    const setupAction = { id: 'create-venv', label: 'Create Python environment' }
    const blockedLaunch: ListAction = {
      ...LAUNCH_ACTION,
      enabled: false,
      disabledMessage: 'No venv for this install'
    }

    beforeEach(() => {
      mockDialogsConfirm.mockReset()
      mockOpenInstancePicker.mockClear()
    })

    it('offers the setup action instead of a dead-end alert', async () => {
      mockDialogsConfirm.mockResolvedValue(false)
      const { executeAction } = useListAction('chooser', { showProgress: vi.fn() })

      await executeAction({ ...INSTALL, setupAction }, blockedLaunch)

      expect(mockDialogsConfirm).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'No venv for this install',
          confirmLabel: 'Create Python environment',
          showCancel: true
        })
      )
      expect(mockModalAlert).not.toHaveBeenCalled()
    })

    it('opens Manage and fires the setup action when the user accepts', async () => {
      mockDialogsConfirm.mockResolvedValue('primary')
      const { executeAction } = useListAction('chooser', { showProgress: vi.fn() })

      await executeAction({ ...INSTALL, setupAction }, blockedLaunch)

      expect(mockOpenInstancePicker).toHaveBeenCalledWith(
        expect.objectContaining({ installationId: INSTALL.id, autoAction: 'create-venv' })
      )
    })

    it('does nothing when the user cancels', async () => {
      mockDialogsConfirm.mockResolvedValue(false)
      const { executeAction } = useListAction('chooser', { showProgress: vi.fn() })

      await executeAction({ ...INSTALL, setupAction }, blockedLaunch)

      expect(mockOpenInstancePicker).not.toHaveBeenCalled()
    })

    it('keeps the plain alert for an install with no setup action', async () => {
      const { executeAction } = useListAction('chooser', { showProgress: vi.fn() })

      await executeAction(INSTALL, blockedLaunch)

      expect(mockDialogsConfirm).not.toHaveBeenCalled()
      expect(mockModalAlert).toHaveBeenCalledOnce()
    })
  })

  it('does NOT fire onGuardsPassed when the busy guard cancels', async () => {
    mockCheckBeforeAction.mockResolvedValueOnce(false)
    const onGuardsPassed = vi.fn()
    const showProgress = vi.fn()
    const { executeAction } = useListAction('chooser', { showProgress })

    await executeAction(INSTALL, LAUNCH_ACTION, { onGuardsPassed })

    expect(onGuardsPassed).not.toHaveBeenCalled()
    expect(showProgress).not.toHaveBeenCalled()
  })

  it('does NOT fire onGuardsPassed when the user cancels a confirm modal', async () => {
    mockModalConfirm.mockResolvedValueOnce(false)
    const onGuardsPassed = vi.fn()
    const showProgress = vi.fn()
    const confirmedAction: ListAction = {
      ...LAUNCH_ACTION,
      confirm: { title: 'Sure?', message: 'Really?' }
    }
    const { executeAction } = useListAction('chooser', { showProgress })

    await executeAction(INSTALL, confirmedAction, { onGuardsPassed })

    expect(onGuardsPassed).not.toHaveBeenCalled()
    expect(showProgress).not.toHaveBeenCalled()
  })

  it('does NOT fire onGuardsPassed when the local-instance launch guard cancels', async () => {
    mockCheckBeforeLaunch.mockResolvedValueOnce(false)
    const onGuardsPassed = vi.fn()
    const showProgress = vi.fn()
    const { executeAction } = useListAction('chooser', { showProgress })

    await executeAction(INSTALL, LAUNCH_ACTION, { onGuardsPassed })

    expect(onGuardsPassed).not.toHaveBeenCalled()
    expect(showProgress).not.toHaveBeenCalled()
  })
})
