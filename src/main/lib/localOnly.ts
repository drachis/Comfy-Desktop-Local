import {
  LOCAL_ONLY_FLAG,
  LOCAL_ONLY_ENV,
  LOCAL_ONLY_HIDDEN_SOURCE_IDS
} from '../../shared/localOnly'

export function readLocalOnly(
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (argv.includes(LOCAL_ONLY_FLAG)) return true
  const value = env[LOCAL_ONLY_ENV]?.trim().toLowerCase()
  return value === '1' || value === 'true'
}

let cached: boolean | undefined

export function isLocalOnly(): boolean {
  cached ??= readLocalOnly()
  return cached
}

export function _setLocalOnlyForTests(value: boolean | undefined): void {
  cached = value
}

export function isHiddenByLocalOnly(installation: { sourceId?: unknown }): boolean {
  return isLocalOnly() && LOCAL_ONLY_HIDDEN_SOURCE_IDS.has(String(installation.sourceId))
}
