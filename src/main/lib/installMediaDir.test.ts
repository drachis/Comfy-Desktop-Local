import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  installInputDir: vi.fn((installPath: string) => `${installPath}/ComfyUI/input`),
  installOutputDir: vi.fn((installPath: string) => `${installPath}/ComfyUI/output`)
}))

vi.mock('../settings', () => ({
  get: mocks.get,
  defaults: { inputDir: '/default/input', outputDir: '/default/output' }
}))
vi.mock('./models', () => ({
  installInputDir: mocks.installInputDir,
  installOutputDir: mocks.installOutputDir
}))

import type { InstallationRecord } from '../installations'
import { resolveInstallMediaDir } from './installMediaDir'

function makeInstall(overrides: Partial<InstallationRecord> = {}): InstallationRecord {
  return { id: 'inst-1', installPath: '/installs/one', ...overrides } as InstallationRecord
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.get.mockReturnValue(undefined)
})

describe('resolveInstallMediaDir', () => {
  it('uses the global shared dir when the install has not opted out', () => {
    mocks.get.mockImplementation((key: string) => `/global/${key}`)
    expect(resolveInstallMediaDir(makeInstall(), 'input')).toBe('/global/inputDir')
    expect(resolveInstallMediaDir(makeInstall(), 'output')).toBe('/global/outputDir')
  })

  it('falls back to the built-in shared default when the setting is empty', () => {
    mocks.get.mockReturnValue('')
    expect(resolveInstallMediaDir(makeInstall(), 'input')).toBe('/default/input')
    expect(resolveInstallMediaDir(makeInstall(), 'output')).toBe('/default/output')
  })

  it('uses the per-install path when the install opted out of shared storage', () => {
    const install = makeInstall({
      useSharedInput: false,
      useSharedOutput: false,
      inputDir: '/custom/in',
      outputDir: '/custom/out'
    })
    expect(resolveInstallMediaDir(install, 'input')).toBe('/custom/in')
    expect(resolveInstallMediaDir(install, 'output')).toBe('/custom/out')
  })

  it("falls back to the install's own folder when opted out with no per-install path", () => {
    const install = makeInstall({ useSharedInput: false, useSharedOutput: false })
    expect(resolveInstallMediaDir(install, 'input')).toBe('/installs/one/ComfyUI/input')
    expect(resolveInstallMediaDir(install, 'output')).toBe('/installs/one/ComfyUI/output')
  })

  it('treats input and output as independent choices', () => {
    mocks.get.mockImplementation((key: string) => `/global/${key}`)
    const install = makeInstall({ useSharedInput: false, inputDir: '/custom/in' })
    expect(resolveInstallMediaDir(install, 'input')).toBe('/custom/in')
    expect(resolveInstallMediaDir(install, 'output')).toBe('/global/outputDir')
  })
})
