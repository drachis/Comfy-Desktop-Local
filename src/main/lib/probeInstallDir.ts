import type { SourcePlugin } from '../types/sources'

export async function probeInstallDir(
  sources: readonly SourcePlugin[],
  dirPath: string,
  platform: NodeJS.Platform = process.platform
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = []
  const detected = new Set<string>()
  for (const source of sources) {
    if (!source.probeInstallation) continue
    const data = await source.probeInstallation(dirPath)
    if (data) {
      results.push({ sourceId: source.id, sourceLabel: source.label, ...data, detected: true })
      detected.add(source.id)
    }
  }
  for (const source of sources) {
    if (!source.buildManualTrackInfo || detected.has(source.id)) continue
    if (source.platforms && !source.platforms.includes(platform)) continue
    results.push({
      sourceId: source.id,
      sourceLabel: source.label,
      ...source.buildManualTrackInfo(dirPath),
      detected: false
    })
  }
  return results
}
