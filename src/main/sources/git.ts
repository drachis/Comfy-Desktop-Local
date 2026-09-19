import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { fetchJSON } from '../lib/fetch'
import { runLoggedProcess, formatProcessError } from '../lib/logged-process'
import {
  untrackAction,
  launchAction,
  openFolderAction,
  migrateToStandaloneAction,
  renameAction
} from '../lib/actions'
import { resolveGitDir, readGitHead, readGitRemoteUrl } from '../lib/git'
import { createVenv, TORCH_BACKEND_AUTO } from '../lib/createVenv'
import { parseArgs, extractPort } from '../lib/util'
import { t } from '../lib/i18n'
import { buildLaunchSettingsFields } from './common/launchSettingsFields'
import type { InstallationRecord } from '../installations'
import type {
  SourcePlugin,
  FieldOption,
  ActionResult,
  ActionTools,
  LaunchCommand,
  TerminalEnv
} from '../types/sources'

const DEFAULT_REPO = 'https://github.com/Comfy-Org/ComfyUI/'
const DEFAULT_LAUNCH_ARGS = ''
const DEFAULT_GIT_SETTINGS = {
  launchArgs: DEFAULT_LAUNCH_ARGS,
  launchMode: 'window',
  browserPartition: 'shared'
} as const

const VENV_CANDIDATES = ['.venv', 'venv', '.env', 'env']

interface GitHubParsed {
  owner: string
  repo: string
}

function parseGitHubRepo(url: string): GitHubParsed | null {
  const cleaned = url.trim().replace(/\/+$/, '')
  const sshMatch = cleaned.match(/github\.com[:/]([^/]+)\/([^/.]+)/)
  if (sshMatch) {
    return { owner: sshMatch[1]!, repo: sshMatch[2]!.replace(/\.git$/, '') }
  }
  try {
    const parsed = new URL(cleaned)
    if (!parsed.hostname.match(/^(www\.)?github\.com$/)) return null
    const parts = parsed.pathname
      .replace(/^\/+|\/+$/g, '')
      .replace(/\.git$/, '')
      .split('/')
    if (parts.length < 2) return null
    return { owner: parts[0]!, repo: parts[1]! }
  } catch {
    return null
  }
}

function findVenv(dirPath: string): string | null {
  for (const name of VENV_CANDIDATES) {
    const venvDir = path.join(dirPath, name)
    if (fs.existsSync(path.join(venvDir, 'pyvenv.cfg'))) return venvDir
  }
  return null
}

function getVenvPython(venvDir: string): string {
  if (process.platform === 'win32') {
    const scripts = path.join(venvDir, 'Scripts', 'python.exe')
    if (fs.existsSync(scripts)) return scripts
    return path.join(venvDir, 'python.exe')
  }
  const python3 = path.join(venvDir, 'bin', 'python3')
  if (fs.existsSync(python3)) return python3
  return path.join(venvDir, 'bin', 'python')
}

function resolveVenvPython(installation: InstallationRecord): string | null {
  const venvPath = installation.venvPath as string | undefined
  if (!venvPath) return null
  const pythonPath = getVenvPython(venvPath)
  if (fs.existsSync(pythonPath)) return pythonPath
  return null
}

/** True when the venv was built from Desktop's trimmed bootstrap Python, which lacks stdlib
 *  modules (unittest, sqlite3) that PyTorch needs, so it can never launch ComfyUI. */
function venvUsesTrimmedPython(installation: InstallationRecord): boolean {
  const venvPath = installation.venvPath as string | undefined
  if (!venvPath) return false
  try {
    const cfg = fs.readFileSync(path.join(venvPath, 'pyvenv.cfg'), 'utf-8')
    const home = cfg.match(/^home\s*=\s*(.+)$/m)?.[1] ?? ''
    return /[\\/]bootstrap-python([\\/]|\s*$)/i.test(home)
  } catch {
    return false
  }
}

type VenvSetup = 'create' | 'recreate' | null

/** Which setup step a tracked ComfyUI folder needs before it can launch, if any. */
function venvSetupNeeded(installation: InstallationRecord): VenvSetup {
  if (installation.status !== 'installed' || findMainPy(installation.installPath) === null) {
    return null
  }
  if (!resolveVenvPython(installation)) return 'create'
  return venvUsesTrimmedPython(installation) ? 'recreate' : null
}

function createVenvAction(recreate: boolean, highlight: boolean): Record<string, unknown> {
  return {
    id: 'create-venv',
    label: recreate ? t('git.recreateVenv') : t('git.createVenv'),
    style: highlight ? 'primary' : 'default',
    enabled: true,
    showProgress: true,
    progressTitle: t('git.creatingVenv'),
    prompt: {
      field: 'torch',
      title: recreate ? t('git.recreateVenvConfirmTitle') : t('git.createVenvTitle'),
      message: recreate
        ? `${t('git.recreateVenvConfirmMessage')}

${t('git.createVenvMessage')}`
        : t('git.createVenvMessage'),
      defaultValue: TORCH_BACKEND_AUTO,
      confirmLabel: recreate ? t('git.recreateVenv') : t('git.createVenvConfirm'),
      required: true
    }
  }
}

function findGit(): Promise<string | null> {
  const cmd = process.platform === 'win32' ? 'where' : 'which'
  return new Promise((resolve) => {
    execFile(cmd, ['git'], { windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null)
      const gitPath = stdout.trim().split(/\r?\n/)[0]
      resolve(gitPath || null)
    })
  })
}

function findMainPy(dirPath: string): string | null {
  const direct = path.join(dirPath, 'main.py')
  if (fs.existsSync(direct)) return direct
  const nested = path.join(dirPath, 'ComfyUI', 'main.py')
  if (fs.existsSync(nested)) return nested
  return null
}

/** ComfyUI's own version from `comfyui_version.py`, for folders with no git history to read. */
function readComfyVersion(mainPy: string): string | null {
  try {
    const src = fs.readFileSync(path.join(path.dirname(mainPy), 'comfyui_version.py'), 'utf-8')
    return src.match(/__version__\s*=\s*["']([^"']+)["']/)?.[1] ?? null
  } catch {
    return null
  }
}

/** What Add Existing Instance records for a folder: git details when there is a repo, else the
 *  ComfyUI version, plus any venv sitting next to it. Every field is best-effort. */
function readTrackInfo(
  dirPath: string,
  gitDir: string | null,
  mainPy: string | null
): Record<string, unknown> {
  const info: Record<string, unknown> = { version: 'unknown', repo: '', branch: '', commit: '' }

  if (gitDir) {
    // Extract branch name from HEAD
    try {
      const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf-8').trim()
      const branchMatch = head.match(/^ref: refs\/heads\/(.+)$/)
      if (branchMatch && branchMatch[1]) {
        info.branch = branchMatch[1]
      }
    } catch {
      // ignore — partial info is fine
    }

    // Resolve commit SHA via readGitHead (handles refs, packed-refs, detached HEAD)
    const commit = readGitHead(dirPath)
    if (commit) {
      info.commit = commit
      info.version = commit.slice(0, 8)
    }

    // Read remote URL via readGitRemoteUrl (handles credential redaction)
    const remoteUrl = readGitRemoteUrl(dirPath)
    if (remoteUrl) info.repo = remoteUrl
  } else if (mainPy) {
    const comfyVersion = readComfyVersion(mainPy)
    if (comfyVersion) info.version = comfyVersion
  }

  const venv = findVenv(dirPath)
  if (venv) {
    info.venvPath = venv
    info.venvName = path.basename(venv)
  }
  info.launchMode = DEFAULT_GIT_SETTINGS.launchMode
  info.browserPartition = DEFAULT_GIT_SETTINGS.browserPartition
  return info
}

export const gitSource: SourcePlugin = {
  id: 'git',
  get label() {
    return t('git.label')
  },
  get description() {
    return t('git.desc')
  },
  category: 'local',
  hidden: true,
  hasConsole: true,

  fields: [
    {
      id: 'repo',
      label: 'Git Repository',
      type: 'text',
      defaultValue: DEFAULT_REPO,
      action: { label: 'Update' }
    },
    { id: 'branch', label: 'Branch', type: 'select', errorTarget: 'repo' },
    { id: 'commit', label: 'Commit', type: 'select', errorTarget: 'repo' }
  ],

  skipInstall: true,

  getDefaults() {
    return { ...DEFAULT_GIT_SETTINGS }
  },

  buildInstallation(selections: Record<string, FieldOption | undefined>): Record<string, unknown> {
    return {
      version: selections.commit?.value?.slice(0, 8) ?? 'unknown',
      repo: selections.repo?.value ?? DEFAULT_REPO,
      branch: selections.branch?.value ?? '',
      commit: selections.commit?.value ?? '',
      commitMessage: selections.commit?.label ?? '',
      ...DEFAULT_GIT_SETTINGS
    }
  },

  getLaunchCommand(installation: InstallationRecord): LaunchCommand | null {
    const pythonPath = resolveVenvPython(installation)
    if (!pythonPath) return null
    const mainPy = findMainPy(installation.installPath)
    if (!mainPy) return null
    const userArgs = ((installation.launchArgs as string | undefined) ?? DEFAULT_LAUNCH_ARGS).trim()
    const parsed = userArgs.length > 0 ? parseArgs(userArgs) : []
    const port = extractPort(parsed)
    const cwd = path.dirname(mainPy)
    return {
      cmd: pythonPath,
      args: ['-s', 'main.py', ...parsed],
      cwd,
      port
    }
  },

  getListPreview(installation: InstallationRecord): string | null {
    const repo = installation.repo as string | undefined
    const branch = installation.branch as string | undefined
    if (repo && branch) return `${repo} (${branch})`
    return repo || null
  },

  getTerminalEnv(installation: InstallationRecord): TerminalEnv {
    // A git install runs from its own venv (`venvPath`), not the standalone
    // `ComfyUI/.venv`, and has no bundled `standalone-env/uv.exe`. Activate that
    // venv so its own `pip` is on PATH; leave pip unaliased. Open the shell on
    // the ComfyUI code folder (where `main.py` lives) regardless of whether a
    // venv is usable.
    const mainPy = findMainPy(installation.installPath)
    const base: TerminalEnv = mainPy ? { cwd: path.dirname(mainPy) } : {}
    const venvPath = installation.venvPath as string | undefined
    if (!venvPath || !resolveVenvPython(installation)) return base
    return { ...base, venvDir: venvPath, promptName: path.basename(venvPath) }
  },

  getSetupAction(installation: InstallationRecord): { id: string; label: string } | null {
    const setup = venvSetupNeeded(installation)
    if (!setup) return null
    return {
      id: 'create-venv',
      label: setup === 'recreate' ? t('git.recreateVenv') : t('git.createVenv')
    }
  },

  getLaunchUnavailableMessage(installation: InstallationRecord): string | null {
    if (!resolveVenvPython(installation)) return t('git.noVenv')
    if (venvUsesTrimmedPython(installation)) return t('git.venvNeedsRebuild')
    if (!findMainPy(installation.installPath)) return t('git.noMainPy')
    return null
  },

  getListActions(installation: InstallationRecord): Record<string, unknown>[] {
    const installed = installation.status === 'installed'
    const unavailable = gitSource.getLaunchUnavailableMessage!(installation)
    const canLaunch = installed && unavailable === null
    const disabledMsg = !canLaunch ? (unavailable ?? t('errors.installNotReady')) : undefined
    const setup = venvSetupNeeded(installation)
    return [
      launchAction(canLaunch, disabledMsg),
      ...(setup ? [createVenvAction(setup === 'recreate', true)] : [])
    ]
  },

  getDetailSections(installation: InstallationRecord): Record<string, unknown>[] {
    const installed = installation.status === 'installed'
    const unavailable = gitSource.getLaunchUnavailableMessage!(installation)
    const canLaunch = installed && unavailable === null
    const setup = venvSetupNeeded(installation)

    const venvPath = installation.venvPath as string | undefined

    return [
      {
        tab: 'status',
        title: t('git.installInfo'),
        fields: [
          { label: t('common.installMethod'), value: installation.sourceLabel as string },
          { label: t('git.repository'), value: (installation.repo as string) || '—' },
          { label: t('git.branch'), value: (installation.branch as string) || '—' },
          { label: t('git.commit'), value: (installation.commit as string) || '—' },
          {
            id: 'venvPath',
            label: t('git.venv'),
            value: venvPath || '',
            editable: true,
            editType: 'path',
            browseOnly: true
          },
          { label: t('common.location'), value: installation.installPath || '—' },
          {
            label: t('common.installed'),
            value: new Date(installation.createdAt).toLocaleDateString()
          }
        ]
      },
      {
        tab: 'settings',
        title: t('common.launchSettings'),
        fields: buildLaunchSettingsFields(installation, {
          defaultLaunchArgs: DEFAULT_LAUNCH_ARGS,
          extraFields: [
            {
              id: 'venvPath',
              label: t('git.venv'),
              value: venvPath || '',
              editable: true,
              editType: 'path',
              browseOnly: true
            }
          ]
        })
      },
      {
        title: 'Actions',
        pinBottom: true,
        actions: [
          launchAction(
            canLaunch,
            !canLaunch ? (unavailable ?? t('errors.installNotReady')) : undefined
          ),
          ...(installed && findMainPy(installation.installPath)
            ? [createVenvAction(setup !== 'create', setup !== null)]
            : []),
          renameAction(installation.name),
          openFolderAction(installation.installPath),
          {
            id: 'git-pull',
            label: t('git.gitPull'),
            style: 'default',
            enabled: installed,
            showProgress: true,
            progressTitle: t('git.gitPulling')
          },
          migrateToStandaloneAction(installed),
          untrackAction()
        ]
      }
    ]
  },

  probeInstallation(dirPath: string): Record<string, unknown> | null {
    const gitDir = resolveGitDir(dirPath)
    const mainPy = findMainPy(dirPath)
    // A plain ComfyUI folder (zip download, copied tree) has no .git but runs the same way.
    if (!gitDir && !mainPy) return null
    return readTrackInfo(dirPath, gitDir, mainPy)
  },

  buildManualTrackInfo(dirPath: string): Record<string, unknown> {
    return readTrackInfo(dirPath, resolveGitDir(dirPath), findMainPy(dirPath))
  },

  async handleAction(
    actionId: string,
    installation: InstallationRecord,
    actionData: Record<string, unknown> | undefined,
    { sendProgress, sendOutput, update }: ActionTools
  ): Promise<ActionResult> {
    if (actionId === 'create-venv') {
      const mainPy = findMainPy(installation.installPath)
      if (!mainPy) return { ok: false, message: t('git.noMainPy') }
      const torchChoice =
        typeof actionData?.torch === 'string' ? actionData.torch : TORCH_BACKEND_AUTO
      const { venvPath, ...result } = await createVenv({
        installPath: installation.installPath,
        comfyDir: path.dirname(mainPy),
        torchChoice,
        tools: { sendProgress, sendOutput }
      })
      if (result.ok && venvPath) await update({ venvPath, venvName: path.basename(venvPath) })
      return result
    }

    if (actionId === 'git-pull') {
      const gitPath = await findGit()
      if (!gitPath) {
        return { ok: false, message: t('git.gitNotFound') }
      }

      sendProgress('pull', { percent: -1, status: t('git.gitPulling') })

      const result = await runLoggedProcess(gitPath, ['pull'], {
        cwd: installation.installPath,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        sendOutput
      })

      if (result.exitCode !== 0) {
        return {
          ok: false,
          message: formatProcessError(t('git.gitPullFailed', { code: result.exitCode }), result)
        }
      }

      sendOutput(`\n✓ ${t('git.gitPullComplete')}\n`)
      sendProgress('done', { percent: 100, status: t('common.done') })
      return { ok: true, navigate: 'detail' }
    }

    return { ok: false, message: `Action "${actionId}" not yet implemented.` }
  },

  async getFieldOptions(
    fieldId: string,
    selections: Record<string, FieldOption | undefined>,
    _context: Record<string, unknown>
  ): Promise<FieldOption[]> {
    if (fieldId === 'branch') {
      const parsed = parseGitHubRepo(selections.repo?.value ?? '')
      if (!parsed) throw new Error('Invalid GitHub repository URL.')
      const [repoInfo, branches] = await Promise.all([
        fetchJSON(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`) as Promise<{
          default_branch: string
        }>,
        fetchJSON(
          `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/branches?per_page=100`
        ) as Promise<{ name: string }[]>
      ])
      const defaultBranch = repoInfo.default_branch
      branches.sort(
        (a, b) => (a.name === defaultBranch ? 0 : 1) - (b.name === defaultBranch ? 0 : 1)
      )
      return branches.map((b) => ({
        value: b.name,
        label: b.name === defaultBranch ? `${b.name} (default)` : b.name
      }))
    }
    if (fieldId === 'commit') {
      const parsed = parseGitHubRepo(selections.repo?.value ?? '')
      if (!parsed) throw new Error('Invalid GitHub repository URL.')
      const branch = selections.branch?.value
      if (!branch) return []
      const commits = (await fetchJSON(
        `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/commits?sha=${encodeURIComponent(branch)}&per_page=30`
      )) as { sha: string; commit: { message: string } }[]
      return commits.map((c) => ({
        value: c.sha,
        label: `${c.sha.slice(0, 8)} — ${c.commit.message.split('\n')[0]}`
      }))
    }
    return []
  }
}
