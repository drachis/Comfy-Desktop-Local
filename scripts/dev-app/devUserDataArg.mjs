import os from 'node:os'
import path from 'node:path'

const PACKAGED_USER_DATA_NAME = 'Comfy Desktop'

export function devUserDataDir(platform, env, home = os.homedir()) {
  if (platform === 'linux') return null
  const override = env['COMFY_DEV_USER_DATA']?.trim()
  if (override) return path.resolve(override)
  const appData =
    platform === 'win32'
      ? env['APPDATA'] || path.join(home, 'AppData', 'Roaming')
      : path.join(home, 'Library', 'Application Support')
  return path.join(appData, PACKAGED_USER_DATA_NAME)
}

export function withUserDataDirArg(viteArgs, userDataDir) {
  if (!userDataDir || viteArgs.some((arg) => String(arg).startsWith('--user-data-dir'))) {
    return viteArgs
  }
  const appArg = `--user-data-dir=${userDataDir}`
  return viteArgs.includes('--') ? [...viteArgs, appArg] : [...viteArgs, '--', appArg]
}
