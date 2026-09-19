import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { app } from 'electron'
import { runLoggedProcess, formatProcessError } from './logged-process'
import { detectNvidiaDriverVersion } from './gpu'
import { t } from './i18n'
import type { ActionResult, ActionTools } from '../types/sources'

const MIN_PYTHON: readonly [number, number] = [3, 10]
const TORCH_INDEX_BASE = 'https://download.pytorch.org/whl'
const NVIDIA_DEFAULT_BACKEND = 'cu128'

export const TORCH_BACKEND_AUTO = 'auto'

export interface PythonCommand {
  cmd: string
  args: string[]
}

export function parsePythonVersion(output: string): [number, number] | null {
  const match = output.match(/Python\s+(\d+)\.(\d+)/)
  return match ? [Number(match[1]), Number(match[2])] : null
}

export function meetsMinPython(version: readonly [number, number]): boolean {
  return version[0] > MIN_PYTHON[0] || (version[0] === MIN_PYTHON[0] && version[1] >= MIN_PYTHON[1])
}

export function pythonCandidates(platform: NodeJS.Platform): PythonCommand[] {
  return platform === 'win32'
    ? [
        { cmd: 'py', args: ['-3'] },
        { cmd: 'python', args: [] },
        { cmd: 'python3', args: [] }
      ]
    : [
        { cmd: 'python3', args: [] },
        { cmd: 'python', args: [] }
      ]
}

type VersionProbe = (candidate: PythonCommand) => Promise<string | null>

const probeVersion: VersionProbe = (candidate) =>
  new Promise((resolve) => {
    execFile(
      candidate.cmd,
      [...candidate.args, '--version'],
      { windowsHide: true, timeout: 10_000 },
      (err, stdout, stderr) => resolve(err ? null : `${stdout}${stderr}`)
    )
  })

/** First system Python that is new enough to run ComfyUI, or null. */
export async function findBasePython(
  platform: NodeJS.Platform = process.platform,
  probe: VersionProbe = probeVersion
): Promise<PythonCommand | null> {
  for (const candidate of pythonCandidates(platform)) {
    const output = await probe(candidate)
    const version = output ? parsePythonVersion(output) : null
    if (version && meetsMinPython(version)) return candidate
  }
  return null
}

export type TorchIndexChoice = { ok: true; indexUrl: string | null } | { ok: false }

/** Map the user's PyTorch backend choice to a pip index URL. `null` means the default PyPI wheels. */
export function resolveTorchIndex(choice: string, nvidiaPresent: boolean): TorchIndexChoice {
  const value = choice.trim().toLowerCase()
  if (value === '' || value === TORCH_BACKEND_AUTO) {
    return {
      ok: true,
      indexUrl: nvidiaPresent ? `${TORCH_INDEX_BASE}/${NVIDIA_DEFAULT_BACKEND}` : null
    }
  }
  if (/^(cpu|xpu|cu\d{2,3}|rocm\d+(\.\d+)*)$/.test(value)) {
    return { ok: true, indexUrl: `${TORCH_INDEX_BASE}/${value}` }
  }
  if (/^https:\/\/\S+$/.test(choice.trim())) return { ok: true, indexUrl: choice.trim() }
  return { ok: false }
}

/** The full CPython that uv downloads for the venv (3.12 has the widest custom node support). */
export const MANAGED_PYTHON_VERSION = '3.12'

/**
 * The uv shipped inside Comfy Desktop (resources/bootstrap-python), or null when absent.
 * Only uv is used from that folder: its bundled Python is a trimmed build with no unittest or
 * sqlite3, so PyTorch cannot import in a venv made from it.
 */
export function findBundledUv(dir: string | null = defaultBootstrapDir()): string | null {
  if (!dir) return null
  const uv = process.platform === 'win32' ? path.join(dir, 'uv.exe') : path.join(dir, 'bin', 'uv')
  return fs.existsSync(uv) ? uv : null
}

function defaultBootstrapDir(): string {
  const osName =
    process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux'
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bootstrap-python')
    : path.join(__dirname, '..', '..', 'bootstrap-python', `${osName}-${process.arch}`)
}

interface Command {
  cmd: string
  args: string[]
}

/** How to create a venv and install into it, for whichever Python is available. */
interface Toolchain {
  createVenv(venvDir: string): Command
  pipInstall(venvPython: string, args: string[]): Command
}

/** uv fetches a managed Python if needed; `--clear` replaces a venv that is already there. */
function uvToolchain(uv: string): Toolchain {
  return {
    createVenv: (venvDir) => ({
      cmd: uv,
      args: ['venv', '--managed-python', '--python', MANAGED_PYTHON_VERSION, '--clear', venvDir]
    }),
    pipInstall: (venvPython, args) => ({
      cmd: uv,
      args: ['pip', 'install', '--python', venvPython, ...args]
    })
  }
}

function systemToolchain(python: PythonCommand): Toolchain {
  return {
    createVenv: (venvDir) => ({ cmd: python.cmd, args: [...python.args, '-m', 'venv', venvDir] }),
    pipInstall: (venvPython, args) => ({ cmd: venvPython, args: ['-m', 'pip', 'install', ...args] })
  }
}

function venvPythonPath(venvDir: string): string {
  return process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python')
}

export interface CreateVenvOptions {
  installPath: string
  /** Folder holding ComfyUI's main.py and requirements.txt. */
  comfyDir: string
  torchChoice: string
  tools: Pick<ActionTools, 'sendProgress' | 'sendOutput'>
  /** Override where Desktop's bundled uv lives; `null` means none. Defaults to the app's own. */
  bootstrapDir?: string | null
}

/** Build `<installPath>/.venv` with PyTorch and ComfyUI's requirements. On success the record's `venvPath`. */
export async function createVenv(
  opts: CreateVenvOptions
): Promise<ActionResult & { venvPath?: string }> {
  const { installPath, comfyDir, tools } = opts
  const requirements = path.join(comfyDir, 'requirements.txt')
  if (!fs.existsSync(requirements)) {
    return { ok: false, message: t('git.requirementsMissing', { path: requirements }) }
  }

  const nvidiaPresent = (await detectNvidiaDriverVersion().catch(() => undefined)) !== undefined
  const torch = resolveTorchIndex(opts.torchChoice, nvidiaPresent)
  if (!torch.ok) return { ok: false, message: t('git.invalidTorchBackend') }

  tools.sendProgress('python', { percent: -1, status: t('git.findingPython') })
  const uv = opts.bootstrapDir === undefined ? findBundledUv() : findBundledUv(opts.bootstrapDir)
  const systemPython = uv ? null : await findBasePython()
  const toolchain = uv ? uvToolchain(uv) : systemPython ? systemToolchain(systemPython) : null
  if (!toolchain) return { ok: false, message: t('git.pythonNotFound') }

  const venvDir = path.join(installPath, '.venv')
  const run = ({ cmd, args }: Command) =>
    runLoggedProcess(cmd, args, { cwd: comfyDir, sendOutput: tools.sendOutput })

  tools.sendProgress('venv', { percent: -1, status: t('git.creatingVenv') })
  const venv = await run(toolchain.createVenv(venvDir))
  if (venv.exitCode !== 0) {
    return {
      ok: false,
      message: formatProcessError(t('git.venvCreateFailed', { code: venv.exitCode }), venv)
    }
  }

  const venvPython = venvPythonPath(venvDir)
  const torchArgs = ['torch', 'torchvision', 'torchaudio']
  if (torch.indexUrl) torchArgs.push('--index-url', torch.indexUrl)
  tools.sendProgress('torch', { percent: -1, status: t('git.installingTorch') })
  const torchResult = await run(toolchain.pipInstall(venvPython, torchArgs))
  if (torchResult.exitCode !== 0) {
    return {
      ok: false,
      message: formatProcessError(
        t('git.torchInstallFailed', { code: torchResult.exitCode }),
        torchResult
      )
    }
  }

  tools.sendProgress('requirements', { percent: -1, status: t('git.installingRequirements') })
  const reqResult = await run(toolchain.pipInstall(venvPython, ['-r', requirements]))
  if (reqResult.exitCode !== 0) {
    return {
      ok: false,
      message: formatProcessError(
        t('git.requirementsInstallFailed', { code: reqResult.exitCode }),
        reqResult
      )
    }
  }

  tools.sendProgress('verify', { percent: -1, status: t('git.verifyingEnv') })
  const verify = await run({ cmd: venvPython, args: ['-c', 'import torch'] })
  if (verify.exitCode !== 0) {
    return {
      ok: false,
      message: formatProcessError(t('git.envVerifyFailed', { code: verify.exitCode }), verify)
    }
  }

  tools.sendOutput(`\n✓ ${t('git.venvCreated')}\n`)
  tools.sendProgress('done', { percent: 100, status: t('common.done') })
  return { ok: true, navigate: 'detail', venvPath: venvDir }
}
