import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { app, dialog } from 'electron'
import * as settings from '../settings'
import * as i18n from './i18n'

export const DEFAULT_UPDATE_REPO_URL = 'https://github.com/drachis/Comfy-Desktop-Local.git'

const PULL_TIMEOUT_MS = 120_000

export interface ForkUpdateResult {
  available: boolean
  version?: string
  error?: string
}

type GitRunner = (args: string[], cwd: string) => Promise<string>

const execFileAsync = promisify(execFile)

const runGit: GitRunner = async (args, cwd) => {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    timeout: PULL_TIMEOUT_MS,
    windowsHide: true
  })
  return stdout.trim()
}

export function getUpdateRepoUrl(): string {
  const raw = settings.get('updateRepoUrl')
  return typeof raw === 'string' && raw.trim() ? raw.trim() : DEFAULT_UPDATE_REPO_URL
}

/** Background checks are opt-in; only an explicit `true` enables them. */
export function isAutoCheckEnabled(): boolean {
  return settings.get('autoCheckUpdates') === true
}

/** The git checkout the running app was started from, or null for a packaged build. */
export function findSourceCheckout(): string | null {
  if (app.isPackaged) return null
  const root = app.getAppPath()
  return fs.existsSync(path.join(root, '.git')) ? root : null
}

/** Fast-forward `repoDir` from `url`. `available` means new commits were pulled. */
export async function pullFromRepo(
  repoDir: string,
  url: string,
  git: GitRunner = runGit
): Promise<ForkUpdateResult> {
  // A URL beginning with "-" would be parsed by git as an option.
  if (url.startsWith('-')) return { available: false, error: `Invalid repository URL: ${url}` }
  try {
    const before = await git(['rev-parse', 'HEAD'], repoDir)
    await git(['pull', '--ff-only', url], repoDir)
    const after = await git(['rev-parse', 'HEAD'], repoDir)
    return before === after ? { available: false } : { available: true, version: after.slice(0, 8) }
  } catch (err) {
    return { available: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Pull the configured repo into the source checkout and tell the user what happened. */
export async function runForkUpdate(repoDir: string): Promise<ForkUpdateResult> {
  const url = getUpdateRepoUrl()
  const result = await pullFromRepo(repoDir, url)
  const message = result.error
    ? i18n.t('forkUpdate.failed', { url, error: result.error })
    : result.available
      ? i18n.t('forkUpdate.pulled', { url, version: result.version ?? '' })
      : i18n.t('forkUpdate.upToDate', { url })
  await dialog.showMessageBox({
    type: result.error ? 'error' : 'info',
    message: i18n.t('forkUpdate.title'),
    detail: message
  })
  return result
}
