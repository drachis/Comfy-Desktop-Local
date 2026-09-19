import { describe, expect, it } from 'vitest'
import { installPathLabel } from './installPathLabel'

describe('installPathLabel', () => {
  it('keeps the parent folder and the install folder of a Windows path', () => {
    expect(installPathLabel('O:\\AI\\Comfy\\ComfyUI_2')).toBe('…\\Comfy\\ComfyUI_2')
  })

  it('keeps the parent folder and the install folder of a POSIX path', () => {
    expect(installPathLabel('/home/me/ai/ComfyUI')).toBe('…/ai/ComfyUI')
  })

  it('ignores a trailing separator', () => {
    expect(installPathLabel('/home/me/ai/ComfyUI/')).toBe('…/ai/ComfyUI')
  })

  it('returns a short path unchanged', () => {
    expect(installPathLabel('O:\\ComfyUI')).toBe('O:\\ComfyUI')
  })

  it('returns an empty string when there is no path', () => {
    expect(installPathLabel(undefined)).toBe('')
    expect(installPathLabel('')).toBe('')
  })
})
