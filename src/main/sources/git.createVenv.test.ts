import fs from 'fs'
import os from 'os'
import path from 'path'
import type * as CreateVenvModule from '../lib/createVenv'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createVenvMock = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '' },
  ipcMain: { handle: vi.fn() }
}))
vi.mock('../lib/createVenv', async (importActual) => ({
  ...(await importActual<typeof CreateVenvModule>()),
  createVenv: createVenvMock
}))

import { gitSource } from './git'
import type { InstallationRecord } from '../installations'
import type { ActionTools } from '../types/sources'

describe('git create-venv handler', () => {
  let tmp: string
  const update = vi.fn(async () => {})
  const tools = { update, sendProgress: vi.fn(), sendOutput: vi.fn() } as unknown as ActionTools

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'git-create-venv-handler-'))
    fs.mkdirSync(path.join(tmp, 'ComfyUI'))
    fs.writeFileSync(path.join(tmp, 'ComfyUI', 'main.py'), '')
    createVenvMock.mockReset()
    update.mockClear()
  })

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  const install = () =>
    ({ id: 'i', installPath: tmp, status: 'installed', sourceId: 'git' }) as InstallationRecord

  it('builds the environment next to the ComfyUI folder and records it on the install', async () => {
    const venvPath = path.join(tmp, '.venv')
    createVenvMock.mockResolvedValue({ ok: true, navigate: 'detail', venvPath })

    const result = await gitSource.handleAction!(
      'create-venv',
      install(),
      { torch: 'cu126' },
      tools
    )

    expect(createVenvMock).toHaveBeenCalledWith(
      expect.objectContaining({
        installPath: tmp,
        comfyDir: path.join(tmp, 'ComfyUI'),
        torchChoice: 'cu126'
      })
    )
    expect(update).toHaveBeenCalledWith({ venvPath, venvName: '.venv' })
    expect(result).toEqual({ ok: true, navigate: 'detail' })
  })

  it('falls back to auto when no backend was entered', async () => {
    createVenvMock.mockResolvedValue({ ok: true })

    await gitSource.handleAction!('create-venv', install(), undefined, tools)

    expect(createVenvMock).toHaveBeenCalledWith(expect.objectContaining({ torchChoice: 'auto' }))
  })

  it('does not touch the install record when creation fails', async () => {
    createVenvMock.mockResolvedValue({ ok: false, message: 'git.torchInstallFailed' })

    const result = await gitSource.handleAction!('create-venv', install(), {}, tools)

    expect(result).toEqual({ ok: false, message: 'git.torchInstallFailed' })
    expect(update).not.toHaveBeenCalled()
  })
})
