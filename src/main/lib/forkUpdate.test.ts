import { beforeEach, describe, expect, it, vi } from 'vitest'

const settingsMock = vi.hoisted(() => ({ get: vi.fn() }))

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/app' },
  dialog: { showMessageBox: vi.fn() }
}))
vi.mock('../settings', () => settingsMock)
vi.mock('./i18n', () => ({ t: (key: string) => key }))

import {
  DEFAULT_UPDATE_REPO_URL,
  getUpdateRepoUrl,
  isAutoCheckEnabled,
  pullFromRepo
} from './forkUpdate'

beforeEach(() => {
  settingsMock.get.mockReset()
})

describe('getUpdateRepoUrl', () => {
  it('defaults to the fork repository', () => {
    settingsMock.get.mockReturnValue(undefined)
    expect(getUpdateRepoUrl()).toBe(DEFAULT_UPDATE_REPO_URL)
  })

  it('uses the configured repository, trimmed', () => {
    settingsMock.get.mockReturnValue('  https://example.com/me/desktop.git ')
    expect(getUpdateRepoUrl()).toBe('https://example.com/me/desktop.git')
  })

  it('falls back to the default for a blank value', () => {
    settingsMock.get.mockReturnValue('   ')
    expect(getUpdateRepoUrl()).toBe(DEFAULT_UPDATE_REPO_URL)
  })
})

describe('isAutoCheckEnabled', () => {
  it.each([
    [undefined, false],
    [false, false],
    [true, true]
  ])('treats %s as %s (opt-in)', (value, expected) => {
    settingsMock.get.mockReturnValue(value)
    expect(isAutoCheckEnabled()).toBe(expected)
  })
})

describe('pullFromRepo', () => {
  it('reports the new short commit when the pull moved HEAD', async () => {
    const heads = ['a'.repeat(40), 'b'.repeat(40)]
    const git = vi.fn(async (args: string[]) => (args[0] === 'rev-parse' ? heads.shift()! : ''))

    const result = await pullFromRepo('/repo', 'https://x/y.git', git)

    expect(result).toEqual({ available: true, version: 'bbbbbbbb' })
    expect(git).toHaveBeenCalledWith(['pull', '--ff-only', 'https://x/y.git'], '/repo')
  })

  it('reports up to date when HEAD did not move', async () => {
    const git = vi.fn(async (args: string[]) => (args[0] === 'rev-parse' ? 'c'.repeat(40) : ''))

    expect(await pullFromRepo('/repo', 'https://x/y.git', git)).toEqual({ available: false })
  })

  it('returns the git error when the pull fails', async () => {
    const git = vi.fn(async (args: string[]) => {
      if (args[0] === 'pull') throw new Error('not possible to fast-forward')
      return 'd'.repeat(40)
    })

    expect(await pullFromRepo('/repo', 'https://x/y.git', git)).toEqual({
      available: false,
      error: 'not possible to fast-forward'
    })
  })

  it('refuses a URL that git would read as an option', async () => {
    const git = vi.fn()

    const result = await pullFromRepo('/repo', '--upload-pack=evil', git)

    expect(result.error).toContain('Invalid repository URL')
    expect(git).not.toHaveBeenCalled()
  })
})
