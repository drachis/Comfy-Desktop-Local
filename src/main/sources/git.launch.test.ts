import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '' },
  ipcMain: { handle: vi.fn() }
}))

import { gitSource } from './git'
import type { InstallationRecord } from '../installations'

function makeInstall(installPath: string, extra: Partial<InstallationRecord> = {}) {
  return {
    id: 'inst-1',
    name: 'ComfyUI',
    sourceId: 'git',
    installPath,
    status: 'installed',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...extra
  } as InstallationRecord
}

function makeVenv(venvDir: string): void {
  const python =
    process.platform === 'win32'
      ? path.join(venvDir, 'Scripts', 'python.exe')
      : path.join(venvDir, 'bin', 'python3')
  fs.mkdirSync(path.dirname(python), { recursive: true })
  fs.writeFileSync(python, '')
}

describe('git launch availability', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'git-launch-'))
    fs.writeFileSync(path.join(tmp, 'main.py'), '')
  })

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('reports the missing-venv explanation when the install has none', () => {
    expect(gitSource.getLaunchUnavailableMessage!(makeInstall(tmp))).toBe('git.noVenv')
  })

  it('reports a missing main.py once a venv is configured', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'git-launch-empty-'))
    try {
      const venv = path.join(empty, '.venv')
      makeVenv(venv)

      expect(gitSource.getLaunchUnavailableMessage!(makeInstall(empty, { venvPath: venv }))).toBe(
        'git.noMainPy'
      )
    } finally {
      fs.rmSync(empty, { recursive: true, force: true })
    }
  })

  it('reports nothing when the install can launch', () => {
    const venv = path.join(tmp, '.venv')
    makeVenv(venv)

    expect(gitSource.getLaunchUnavailableMessage!(makeInstall(tmp, { venvPath: venv }))).toBeNull()
  })

  it('surfaces the venv explanation as the disabled reason on the Launch action', () => {
    const [launch] = gitSource.getListActions!(makeInstall(tmp))

    expect(launch).toMatchObject({ id: 'launch', enabled: false })
    expect(launch!.disabledMessage).toBe('git.noVenv')
  })

  it('enables Launch when the venv and main.py are present', () => {
    const venv = path.join(tmp, '.venv')
    makeVenv(venv)

    const [launch] = gitSource.getListActions!(makeInstall(tmp, { venvPath: venv }))

    expect(launch).toMatchObject({ id: 'launch', enabled: true })
  })
})

describe('git create-venv action', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'git-create-venv-'))
    fs.writeFileSync(path.join(tmp, 'main.py'), '')
  })

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  const actionIds = (install: InstallationRecord) =>
    gitSource.getListActions!(install).map((a) => a.id)

  it('offers Create Python environment when the folder has no venv', () => {
    expect(actionIds(makeInstall(tmp))).toContain('create-venv')
  })

  it('does not offer it once a venv exists', () => {
    const venv = path.join(tmp, '.venv')
    makeVenv(venv)

    expect(actionIds(makeInstall(tmp, { venvPath: venv }))).not.toContain('create-venv')
  })

  it('does not offer it when there is no main.py to build an environment for', () => {
    fs.rmSync(path.join(tmp, 'main.py'))

    expect(actionIds(makeInstall(tmp))).not.toContain('create-venv')
  })

  it('asks which PyTorch backend to use, defaulting to auto', () => {
    const action = gitSource.getListActions!(makeInstall(tmp)).find(
      (a) => a.id === 'create-venv'
    ) as { prompt: { field: string; defaultValue: string } }

    expect(action.prompt).toMatchObject({ field: 'torch', defaultValue: 'auto' })
  })

  it('reports Create Python environment as the setup action only while it applies', () => {
    expect(gitSource.getSetupAction!(makeInstall(tmp))).toEqual({
      id: 'create-venv',
      label: 'git.createVenv'
    })

    const venv = path.join(tmp, '.venv')
    makeVenv(venv)
    expect(gitSource.getSetupAction!(makeInstall(tmp, { venvPath: venv }))).toBeNull()
  })

  it('shows the same action on the Manage screen', () => {
    const sections = gitSource.getDetailSections!(makeInstall(tmp)) as {
      actions?: { id: string }[]
    }[]

    expect(sections.flatMap((s) => s.actions ?? []).map((a) => a.id)).toContain('create-venv')
  })
})
