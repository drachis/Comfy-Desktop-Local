import * as settings from '../settings'
import type { InstallationRecord } from '../installations'
import { installInputDir, installOutputDir } from './models'

export type MediaDirKind = 'input' | 'output'

/** The input/output folder ComfyUI is launched against for this install.
 *  Mirrors the `--input-directory` / `--output-directory` selection in
 *  `sessionActions/launch.ts`: shared (global setting) unless the install
 *  opted out, then the per-install path, then the install's own default. */
export function resolveInstallMediaDir(
  installation: InstallationRecord,
  kind: MediaDirKind
): string {
  const isInput = kind === 'input'
  const useShared = (isInput ? installation.useSharedInput : installation.useSharedOutput) !== false
  if (useShared) {
    return isInput
      ? settings.get('inputDir') || settings.defaults.inputDir
      : settings.get('outputDir') || settings.defaults.outputDir
  }
  const perInstall = isInput ? installation.inputDir : installation.outputDir
  if (perInstall) return perInstall
  return isInput
    ? installInputDir(installation.installPath)
    : installOutputDir(installation.installPath)
}
