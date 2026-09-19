import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '' },
  ipcMain: { handle: vi.fn() }
}))

import { gitSource } from './git'

describe('git probeInstallation', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'git-probe-'))
  })

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('reads branch and commit from a git checkout', async () => {
    const sha = 'a'.repeat(40)
    fs.mkdirSync(path.join(tmp, '.git', 'refs', 'heads'), { recursive: true })
    fs.writeFileSync(path.join(tmp, '.git', 'HEAD'), 'ref: refs/heads/master\n')
    fs.writeFileSync(path.join(tmp, '.git', 'refs', 'heads', 'master'), `${sha}\n`)

    const result = await gitSource.probeInstallation!(tmp)

    expect(result).toMatchObject({ branch: 'master', commit: sha, version: 'aaaaaaaa' })
  })

  it('detects a plain ComfyUI folder that has main.py but no .git', async () => {
    fs.writeFileSync(path.join(tmp, 'main.py'), '')
    fs.writeFileSync(path.join(tmp, 'comfyui_version.py'), '__version__ = "0.3.10"\n')

    const result = await gitSource.probeInstallation!(tmp)

    expect(result).toMatchObject({ version: '0.3.10', repo: '', branch: '', commit: '' })
  })

  it('keeps an unknown version when a plain folder has no comfyui_version.py', async () => {
    fs.writeFileSync(path.join(tmp, 'main.py'), '')

    expect(await gitSource.probeInstallation!(tmp)).toMatchObject({ version: 'unknown' })
  })

  it('detects a plain folder whose main.py is in a nested ComfyUI directory', async () => {
    fs.mkdirSync(path.join(tmp, 'ComfyUI'))
    fs.writeFileSync(path.join(tmp, 'ComfyUI', 'main.py'), '')

    expect(await gitSource.probeInstallation!(tmp)).not.toBeNull()
  })

  it('records a venv found next to a plain ComfyUI folder', async () => {
    fs.writeFileSync(path.join(tmp, 'main.py'), '')
    fs.mkdirSync(path.join(tmp, '.venv'))
    fs.writeFileSync(path.join(tmp, '.venv', 'pyvenv.cfg'), '')

    expect(await gitSource.probeInstallation!(tmp)).toMatchObject({
      venvPath: path.join(tmp, '.venv'),
      venvName: '.venv'
    })
  })

  it('returns null for a folder with neither .git nor main.py', async () => {
    fs.mkdirSync(path.join(tmp, 'models'))

    expect(await gitSource.probeInstallation!(tmp)).toBeNull()
  })
})
