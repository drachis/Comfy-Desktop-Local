import { describe, expect, it, vi } from 'vitest'
import type { SourcePlugin } from '../types/sources'
import { probeInstallDir } from './probeInstallDir'

function makeSource(
  id: string,
  opts: {
    probe?: Record<string, unknown> | null
    manual?: Record<string, unknown>
    platforms?: readonly string[]
  } = {}
): SourcePlugin {
  return {
    id,
    label: `${id} label`,
    category: 'local',
    fields: [],
    platforms: opts.platforms,
    probeInstallation: vi.fn(() => opts.probe ?? null),
    ...(opts.manual ? { buildManualTrackInfo: vi.fn(() => opts.manual!) } : {})
  } as unknown as SourcePlugin
}

describe('probeInstallDir', () => {
  it('lists detected types first, flagged detected', async () => {
    const results = await probeInstallDir(
      [makeSource('git', { probe: { version: 'abc' }, manual: { version: 'unknown' } })],
      '/dir'
    )

    expect(results).toEqual([
      { sourceId: 'git', sourceLabel: 'git label', version: 'abc', detected: true }
    ])
  })

  it('offers unmatched manual-capable types after the detected ones, flagged not detected', async () => {
    const results = await probeInstallDir(
      [
        makeSource('standalone', { probe: { version: 'v1' } }),
        makeSource('portable', { manual: { asset: '' } }),
        makeSource('git', { manual: { repo: '' } })
      ],
      '/dir',
      'win32'
    )

    expect(results.map((r) => [r.sourceId, r.detected])).toEqual([
      ['standalone', true],
      ['portable', false],
      ['git', false]
    ])
    expect(results[1]).toMatchObject({ sourceLabel: 'portable label', asset: '' })
  })

  it('does not offer a manual type for a source without buildManualTrackInfo', async () => {
    const results = await probeInstallDir([makeSource('desktop')], '/dir')

    expect(results).toEqual([])
  })

  it('skips manual types that do not run on this platform', async () => {
    const results = await probeInstallDir(
      [makeSource('portable', { manual: {}, platforms: ['win32'] })],
      '/dir',
      'darwin'
    )

    expect(results).toEqual([])
  })

  it('does not let a probe result override the detected flag', async () => {
    const results = await probeInstallDir(
      [makeSource('git', { probe: { detected: false } })],
      '/dir'
    )

    expect(results[0]).toMatchObject({ detected: true })
  })
})
