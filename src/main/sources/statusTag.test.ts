import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '' },
  ipcMain: { handle: vi.fn() }
}))

const releaseCacheMocks = vi.hoisted(() => ({
  getEffectiveInfo: vi.fn(),
  isUpdateAvailable: vi.fn()
}))

vi.mock('../lib/release-cache', async (importActual) => ({
  ...(await importActual<typeof ReleaseCacheModule>()),
  getEffectiveInfo: releaseCacheMocks.getEffectiveInfo,
  isUpdateAvailable: releaseCacheMocks.isUpdateAvailable
}))

import type * as ReleaseCacheModule from '../lib/release-cache'
import type { InstallationRecord } from '../installations'
import { gitSource } from './git'
import { portable } from './portable'

function makeInstall(sourceId: string): InstallationRecord {
  return {
    id: 'inst-1',
    name: 'ComfyUI',
    sourceId,
    installPath: '/installs/comfy',
    status: 'installed',
    createdAt: '2026-01-01T00:00:00.000Z'
  } as InstallationRecord
}

// Migrating is an opt-in action in Manage, not a badge that competes with launching.
describe('installed local installs carry no Migrate status tag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    releaseCacheMocks.getEffectiveInfo.mockReturnValue(null)
    releaseCacheMocks.isUpdateAvailable.mockReturnValue(false)
  })

  it('git installs have no status tag', () => {
    expect(gitSource.getStatusTag?.(makeInstall('git'))).toBeUndefined()
  })

  it('portable installs have no status tag when up to date', () => {
    expect(portable.getStatusTag?.(makeInstall('portable'))).toBeUndefined()
  })

  it('portable installs still surface an available update', () => {
    releaseCacheMocks.getEffectiveInfo.mockReturnValue({
      releaseName: 'v9.9.9',
      latestTag: 'v9.9.9'
    })
    releaseCacheMocks.isUpdateAvailable.mockReturnValue(true)

    expect(portable.getStatusTag?.(makeInstall('portable'))).toMatchObject({ style: 'update' })
  })

  it('both still offer Migrate to Standalone as an action in Manage', () => {
    for (const [source, install] of [
      [gitSource, makeInstall('git')],
      [portable, makeInstall('portable')]
    ] as const) {
      const actions = source
        .getDetailSections(install)
        .flatMap((section) => (section.actions as { id: string }[] | undefined) ?? [])
      expect(actions.map((a) => a.id)).toContain('migrate-to-standalone')
    }
  })
})
