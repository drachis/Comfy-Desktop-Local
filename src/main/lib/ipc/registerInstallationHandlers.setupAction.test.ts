import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '' },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}))

import { enrichInstallationsForRenderer } from './registerInstallationHandlers'
import type { InstallationRecord } from '../../installations'

describe('enrichInstallationsForRenderer setup action', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'enrich-setup-'))
    fs.writeFileSync(path.join(tmp, 'main.py'), '')
  })

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  const record = (extra: Partial<InstallationRecord> = {}) =>
    ({
      id: 'git-1',
      name: 'ComfyUI',
      sourceId: 'git',
      installPath: tmp,
      status: 'installed',
      createdAt: '2026-01-01T00:00:00.000Z',
      ...extra
    }) as InstallationRecord

  it('tells the renderer a venv-less git install can set up its environment', () => {
    const [enriched] = enrichInstallationsForRenderer([record()]).enriched

    expect(enriched).toMatchObject({ setupAction: { id: 'create-venv' } })
  })

  it('omits it once the install has a working venv', () => {
    const python =
      process.platform === 'win32'
        ? path.join(tmp, '.venv', 'Scripts', 'python.exe')
        : path.join(tmp, '.venv', 'bin', 'python3')
    fs.mkdirSync(path.dirname(python), { recursive: true })
    fs.writeFileSync(python, '')

    const [enriched] = enrichInstallationsForRenderer([
      record({ venvPath: path.join(tmp, '.venv') })
    ]).enriched

    expect(enriched).not.toHaveProperty('setupAction')
  })
})
