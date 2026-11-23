import { app } from 'electron'
import path from 'path'

const PACKAGED_USER_DATA_NAME = 'Comfy Desktop'

export function resolveDevUserDataDir(opts: {
  isPackaged: boolean
  platform: NodeJS.Platform
  appDataDir: string
  override?: string
}): string | null {
  if (opts.isPackaged || opts.platform === 'linux') return null
  const override = opts.override?.trim()
  return override ? path.resolve(override) : path.join(opts.appDataDir, PACKAGED_USER_DATA_NAME)
}

const devUserDataDir = resolveDevUserDataDir({
  isPackaged: app.isPackaged,
  platform: process.platform,
  appDataDir: app.getPath('appData'),
  override: process.env['COMFY_DEV_USER_DATA']
})
if (devUserDataDir) app.setPath('userData', devUserDataDir)
