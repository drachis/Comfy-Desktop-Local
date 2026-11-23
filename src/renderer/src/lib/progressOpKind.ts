import type { ShowProgressOpts } from '../types/ipc'

export type ProgressOpKind = NonNullable<ShowProgressOpts['opKind']>

export function progressOpKindForActionId(actionId: string): ProgressOpKind {
  switch (actionId) {
    case 'launch':
    case 'restart':
      return 'launch'
    case 'check-update':
      return 'generic'
    case 'delete':
      return 'destructive'
    case 'restore-snapshot':
      return 'snapshot'
    case 'release-update':
    case 'copy-update':
    case 'copy-pytorch':
    case 'update':
      return 'update'
    default:
      if (actionId.startsWith('install')) return 'install'
      if (actionId.startsWith('snapshot')) return 'snapshot'
      if (actionId.includes('update')) return 'update'
      return 'generic'
  }
}

const QUICK_ACTION_IDS: ReadonlySet<string> = new Set([
  'launch',
  'rename',
  'open-folder',
  'remove',
  'check-update'
])

export function isLongRunningActionId(actionId: string): boolean {
  return !QUICK_ACTION_IDS.has(actionId)
}

export function isUninstallOpKind(opKind: ProgressOpKind | undefined): boolean {
  return opKind === 'destructive'
}

export function destroysInstanceForActionId(actionId: string): boolean {
  return actionId === 'delete'
}

export function updatesBuildInPlace(
  opKind: ProgressOpKind | undefined,
  actionId: string | undefined
): boolean {
  return opKind === 'update' && !actionId?.startsWith('copy-')
}
