import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { devUserDataDir, withUserDataDirArg } from './devUserDataArg.mjs'

describe('devUserDataDir', () => {
  it('shares the installed app profile on Windows', () => {
    expect(devUserDataDir('win32', { APPDATA: '/roaming' })).toBe(
      path.join('/roaming', 'Comfy Desktop')
    )
  })

  it('shares the installed app profile on macOS', () => {
    expect(devUserDataDir('darwin', {}, '/Users/me')).toBe(
      path.join('/Users/me', 'Library', 'Application Support', 'Comfy Desktop')
    )
  })

  it('honours COMFY_DEV_USER_DATA', () => {
    expect(devUserDataDir('win32', { COMFY_DEV_USER_DATA: '/tmp/profile' })).toBe(
      path.resolve('/tmp/profile')
    )
  })

  it('leaves Linux on its own profile', () => {
    expect(devUserDataDir('linux', { APPDATA: 'x' })).toBeNull()
  })
})

describe('withUserDataDirArg', () => {
  it('passes --user-data-dir to the Electron app after --', () => {
    expect(withUserDataDirArg(['--sourcemap'], '/p')).toEqual([
      '--sourcemap',
      '--',
      '--user-data-dir=/p'
    ])
  })

  it('joins app arguments the caller already passed after --', () => {
    expect(withUserDataDirArg(['--', '--foo'], '/p')).toEqual(['--', '--foo', '--user-data-dir=/p'])
  })

  it('keeps a user-data-dir the caller already passed', () => {
    const args = ['--', '--user-data-dir=/mine']
    expect(withUserDataDirArg(args, '/p')).toBe(args)
  })

  it('changes nothing without a directory', () => {
    const args = ['--sourcemap']
    expect(withUserDataDirArg(args, null)).toBe(args)
  })
})
