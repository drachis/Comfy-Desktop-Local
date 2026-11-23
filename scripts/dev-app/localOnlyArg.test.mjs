import { describe, expect, it } from 'vitest'
import { splitLocalOnlyArg } from './localOnlyArg.mjs'

describe('splitLocalOnlyArg', () => {
  it('takes --local-only out and leaves the electron-vite options', () => {
    expect(splitLocalOnlyArg(['--inspect', '9229', '--local-only', '--sourcemap'])).toEqual({
      localOnly: true,
      rest: ['--inspect', '9229', '--sourcemap']
    })
  })

  it('reports no local-only mode when the flag is absent', () => {
    expect(splitLocalOnlyArg(['--sourcemap'])).toEqual({ localOnly: false, rest: ['--sourcemap'] })
  })
})
