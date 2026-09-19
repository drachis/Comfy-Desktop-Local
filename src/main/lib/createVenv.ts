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

export interface BootstrapPython {
  python: string
  uv: string
}

/** The Python + uv shipped inside Comfy Desktop (resources/bootstrap-python). Null when absent. */
export function findBootstrapPython(
  dir: string | null = defaultBootstrapDir()
): BootstrapPython | null {
  if (!dir) return null
  const win = process.platform === 'win32'
  const python = win ? path.join(dir, 'python.exe') : path.join(dir, 'bin', 'python3')
  const uv = win ? path.join(dir, 'uv.exe') : path.join(dir, 'bin', 'uv')
  return fs.existsSync(python) && fs.existsSync(uv) ? { python, uv } : null
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

/** The bundled Python has no `venv` module, but uv builds a venv from any interpreter. */
function uvToolchain({ python, uv }: BootstrapPython): Toolchain {
  return {
    createVenv: (venvDir) => ({ cmd: uv, args: ['venv', '--python', python, venvDir] }),
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
  /** Override where Desktop's bundled Python lives; `null` means none. Defaults to the app's own. */
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
  const bootstrap =
    opts.bootstrapDir === undefined ? findBootstrapPython() : findBootstrapPython(opts.bootstrapDir)
  const systemPython = bootstrap ? null : await findBasePython()
  const toolchain = bootstrap
    ? uvToolchain(bootstrap)
    : systemPython
      ? systemToolchain(systemPython)
      : null
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

  tools.sendOutput(`\n✓ ${t('git.venvCreated')}\n`)
  tools.sendProgress('done', { percent: 100, status: t('common.done') })
  return { ok: true, navigate: 'detail', venvPath: venvDir }
}
