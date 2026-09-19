import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runLoggedProcess: vi.fn(),
  detectNvidiaDriverVersion: vi.fn(),
  pythonVersionOutput: 'Python 3.12.4'
}))

vi.mock('child_process', () => {
  const execFile = (
    _cmd: string,
    _args: string[],
    _opts: unknown,
    cb: (err: Error | null, stdout: string, stderr: string) => void
  ) => cb(null, mocks.pythonVersionOutput, '')
  return { execFile, default: { execFile } }
})
vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./logged-process', () => ({
  runLoggedProcess: mocks.runLoggedProcess,
  formatProcessError: (message: string) => message
}))
vi.mock('./gpu', () => ({ detectNvidiaDriverVersion: mocks.detectNvidiaDriverVersion }))
vi.mock('./i18n', () => ({ t: (key: string) => key }))

import {
  createVenv,
  findBasePython,
  meetsMinPython,
  parsePythonVersion,
  pythonCandidates,
  resolveTorchIndex
} from './createVenv'

describe('parsePythonVersion / meetsMinPython', () => {
  it('reads major and minor from python --version output', () => {
    expect(parsePythonVersion('Python 3.12.4\n')).toEqual([3, 12])
    expect(parsePythonVersion('no python here')).toBeNull()
  })

  it.each([
    [[3, 9], false],
    [[3, 10], true],
    [[3, 13], true],
    [[4, 0], true],
    [[2, 7], false]
  ] as const)('%j meets the minimum: %s', (version, expected) => {
    expect(meetsMinPython(version)).toBe(expected)
  })
})

describe('findBasePython', () => {
  it('skips an interpreter that is too old and returns the next usable one', async () => {
    const outputs: Record<string, string> = { python3: 'Python 3.8.10', python: 'Python 3.11.2' }

    const found = await findBasePython('linux', async (c) => outputs[c.cmd] ?? null)

    expect(found).toEqual({ cmd: 'python', args: [] })
  })

  it('returns null when nothing runs', async () => {
    expect(await findBasePython('linux', async () => null)).toBeNull()
  })

  it('tries the Windows launcher first on Windows', () => {
    expect(pythonCandidates('win32')[0]).toEqual({ cmd: 'py', args: ['-3'] })
  })
})

describe('resolveTorchIndex', () => {
  it.each([
    ['auto', true, 'https://download.pytorch.org/whl/cu128'],
    ['', true, 'https://download.pytorch.org/whl/cu128'],
    ['auto', false, null],
    ['cpu', true, 'https://download.pytorch.org/whl/cpu'],
    ['CU126', false, 'https://download.pytorch.org/whl/cu126'],
    ['rocm6.4', false, 'https://download.pytorch.org/whl/rocm6.4'],
    ['xpu', false, 'https://download.pytorch.org/whl/xpu'],
    ['https://mirror.example/whl/cu128', false, 'https://mirror.example/whl/cu128']
  ])('maps %j (nvidia=%s) to %j', (choice, nvidia, expected) => {
    expect(resolveTorchIndex(choice, nvidia)).toEqual({ ok: true, indexUrl: expected })
  })

  it.each(['rocm', 'cuda', 'http://insecure.example', '--index-url x', 'cu12; rm'])(
    'rejects %j',
    (choice) => {
      expect(resolveTorchIndex(choice, false)).toEqual({ ok: false })
    }
  )
})

describe('createVenv', () => {
  let tmp: string
  const tools = { sendProgress: vi.fn(), sendOutput: vi.fn() }

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'create-venv-'))
    fs.writeFileSync(path.join(tmp, 'requirements.txt'), 'numpy\n')
    mocks.runLoggedProcess.mockReset().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
    mocks.detectNvidiaDriverVersion.mockReset().mockResolvedValue(undefined)
    mocks.pythonVersionOutput = 'Python 3.12.4'
    tools.sendProgress.mockClear()
    tools.sendOutput.mockClear()
  })

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  const venvDir = () => path.join(tmp, '.venv')
  const run = (torchChoice = 'auto', bootstrapDir: string | null = null) =>
    createVenv({ installPath: tmp, comfyDir: tmp, torchChoice, tools, bootstrapDir })

  describe('with the uv bundled in Desktop', () => {
    let bootstrap: string
    const win = process.platform === 'win32'
    const uv = () => (win ? path.join(bootstrap, 'uv.exe') : path.join(bootstrap, 'bin', 'uv'))
    const venvPython = () =>
      win ? path.join(venvDir(), 'Scripts', 'python.exe') : path.join(venvDir(), 'bin', 'python')

    beforeEach(() => {
      bootstrap = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-'))
      fs.mkdirSync(path.dirname(uv()), { recursive: true })
      fs.writeFileSync(uv(), '')
    })

    afterEach(() => {
      fs.rmSync(bootstrap, { recursive: true, force: true })
    })

    it('builds the venv from a full managed Python, never the trimmed bundled one, then verifies it', async () => {
      mocks.detectNvidiaDriverVersion.mockResolvedValue('570.1')

      const result = await run('auto', bootstrap)

      expect(result).toEqual({ ok: true, navigate: 'detail', venvPath: venvDir() })
      const calls = mocks.runLoggedProcess.mock.calls.map(([cmd, args]) => [cmd, args])
      expect(calls).toEqual([
        [uv(), ['venv', '--managed-python', '--python', '3.12', '--clear', venvDir()]],
        [
          uv(),
          [
            'pip',
            'install',
            '--python',
            venvPython(),
            'torch',
            'torchvision',
            'torchaudio',
            '--index-url',
            'https://download.pytorch.org/whl/cu128'
          ]
        ],
        [
          uv(),
          ['pip', 'install', '--python', venvPython(), '-r', path.join(tmp, 'requirements.txt')]
        ],
        [venvPython(), ['-c', 'import torch']]
      ])
    })

    it('does not need a system Python at all', async () => {
      mocks.pythonVersionOutput = 'Python 3.8.1'

      expect(await run('auto', bootstrap)).toMatchObject({ ok: true })
    })

    it('falls back to a system Python when the bundled folder has no uv', async () => {
      fs.rmSync(uv())

      await run('auto', bootstrap)

      expect(mocks.runLoggedProcess.mock.calls[0]![1]).toContain('venv')
      expect(mocks.runLoggedProcess.mock.calls[0]![0]).not.toBe(uv())
    })
  })

  it('creates the venv, installs PyTorch, then the requirements, and reports the venv path', async () => {
    mocks.detectNvidiaDriverVersion.mockResolvedValue('570.1')

    const result = await run()

    expect(result).toEqual({ ok: true, navigate: 'detail', venvPath: venvDir() })
    const calls = mocks.runLoggedProcess.mock.calls.map(([cmd, args]) => [cmd, args])
    expect(calls).toHaveLength(4)
    expect(calls[0]![1]).toEqual([
      ...(process.platform === 'win32' ? ['-3'] : []),
      '-m',
      'venv',
      venvDir()
    ])
    expect(calls[1]![1]).toEqual([
      '-m',
      'pip',
      'install',
      'torch',
      'torchvision',
      'torchaudio',
      '--index-url',
      'https://download.pytorch.org/whl/cu128'
    ])
    expect(calls[2]![1]).toEqual(['-m', 'pip', 'install', '-r', path.join(tmp, 'requirements.txt')])
    expect(calls[3]![1]).toEqual(['-c', 'import torch'])
  })

  it('fails at creation, not at launch, when PyTorch cannot be imported in the new venv', async () => {
    const ok = { exitCode: 0, stdout: '', stderr: '' }
    mocks.runLoggedProcess
      .mockResolvedValueOnce(ok)
      .mockResolvedValueOnce(ok)
      .mockResolvedValueOnce(ok)
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'No module named unittest' })

    const result = await run()

    expect(result).toMatchObject({ ok: false, message: 'git.envVerifyFailed' })
    expect(result.venvPath).toBeUndefined()
  })

  it('uses the default PyPI wheels when no NVIDIA GPU is found', async () => {
    await run()

    expect(mocks.runLoggedProcess.mock.calls[1]![1]).not.toContain('--index-url')
  })

  it('stops before installing requirements when PyTorch fails', async () => {
    mocks.runLoggedProcess
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'no matching distribution' })

    const result = await run()

    expect(result).toMatchObject({ ok: false, message: 'git.torchInstallFailed' })
    expect(result.venvPath).toBeUndefined()
    expect(mocks.runLoggedProcess).toHaveBeenCalledTimes(2)
  })

  it('reports a failed venv creation without installing anything', async () => {
    mocks.runLoggedProcess.mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'boom' })

    expect(await run()).toMatchObject({ ok: false, message: 'git.venvCreateFailed' })
    expect(mocks.runLoggedProcess).toHaveBeenCalledTimes(1)
  })

  it('explains when no suitable Python is installed', async () => {
    mocks.pythonVersionOutput = 'Python 3.8.1'

    expect(await run()).toMatchObject({ ok: false, message: 'git.pythonNotFound' })
    expect(mocks.runLoggedProcess).not.toHaveBeenCalled()
  })

  it('refuses an unknown PyTorch backend before touching the disk', async () => {
    expect(await run('bogus')).toMatchObject({ ok: false, message: 'git.invalidTorchBackend' })
    expect(mocks.runLoggedProcess).not.toHaveBeenCalled()
  })

  it('reports a missing requirements.txt', async () => {
    fs.rmSync(path.join(tmp, 'requirements.txt'))

    expect(await run()).toMatchObject({ ok: false, message: 'git.requirementsMissing' })
    expect(mocks.runLoggedProcess).not.toHaveBeenCalled()
  })
})
