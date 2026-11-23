export function installPathLabel(installPath: string | undefined): string {
  if (!installPath) return ''
  const sep = installPath.includes('\\') ? '\\' : '/'
  const segments = installPath.split(/[\\/]+/).filter(Boolean)
  if (segments.length <= 2) return installPath
  return `…${sep}${segments.slice(-2).join(sep)}`
}
