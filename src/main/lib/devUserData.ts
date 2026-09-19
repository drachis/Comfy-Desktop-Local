import { app } from 'electron'
import path from 'path'

// electron-builder.yml `productName`: the folder name Electron derives userData from when packaged.
const PACKAGED_USER_DATA_NAME = 'Comfy Desktop'

/** Where an unpackaged dev run should keep its userData, or null to leave Electron's default.
 *  Unpackaged runs default to the package name, so they would otherwise start with an empty
 *  profile instead of the installed app's settings and installs. Linux is excluded: its config
 *  lives under XDG dirs keyed on a fixed name in `paths.ts`, identical for dev and packaged. */
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

// Must run before any module reads userData (settings.ts does at import), so index.ts imports this first.
const devUserDataDir = resolveDevUserDataDir({
  isPackaged: app.isPackaged,
  platform: process.platform,
  appDataDir: app.getPath('appData'),
  override: process.env['COMFY_DEV_USER_DATA']
})
if (devUserDataDir) app.setPath('userData', devUserDataDir)
