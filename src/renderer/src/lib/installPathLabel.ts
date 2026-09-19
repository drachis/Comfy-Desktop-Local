/** Short tail of an install path for tiles: the install folder and the folder
 *  above it, with a leading ellipsis when more of the path is hidden. */
export function installPathLabel(installPath: string | undefined): string {
  if (!installPath) return ''
  const sep = installPath.includes('\\') ? '\\' : '/'
  const segments = installPath.split(/[\\/]+/).filter(Boolean)
  if (segments.length <= 2) return installPath
  return `…${sep}${segments.slice(-2).join(sep)}`
}
