import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { BaseSelect } from './ui'
import type { ProbeResult } from '../types/ipc'
import TrackBuildForm from './TrackBuildForm.vue'
import { useModal } from '../composables/useModal'
import { TID } from '../../../shared/testIds'

vi.mock('../lib/telemetry', () => ({
  emitTelemetryAction: vi.fn(),
  toCountBucket: vi.fn(() => '1')
}))

const PROBE = { sourceId: 'portable', sourceLabel: 'Portable', installPath: '/home/user/Old' }

function stubApi(trackResult: Record<string, unknown>): void {
  window.api = {
    getUniqueName: vi.fn().mockResolvedValue('ComfyUI'),
    browseFolder: vi
      .fn()
      .mockResolvedValueOnce('/home/user/Old')
      .mockResolvedValueOnce('/home/user/New'),
    openPath: vi.fn(),
    probeInstallation: vi.fn(async (dir: string) => [{ ...PROBE, installPath: dir }]),
    trackInstallation: vi.fn().mockResolvedValue(trackResult)
  } as unknown as typeof window.api
}

type FormVm = { save: () => Promise<void> }

async function failToAdd(trackResult: Record<string, unknown>) {
  stubApi(trackResult)
  const wrapper = mount(TrackBuildForm)
  await flushPromises()
  await wrapper.get(`[data-testid="${TID.trackBrowse}"]`).trigger('click')
  await flushPromises()
  const saving = (wrapper.vm as unknown as FormVm).save()
  await flushPromises()
  return { wrapper, saving }
}

beforeEach(() => {
  useModal().dismiss()
})

describe('TrackBuildForm, when the build cannot be added', () => {
  it.each([['That directory does not exist.'], ['That directory is already used by "Studio".']])(
    'offers Change location for a folder problem (%s) and opens the same picker',
    async (message) => {
      const { wrapper, saving } = await failToAdd({ ok: false, message, reason: 'location' })
      const modal = useModal()
      expect(modal.state.visible).toBe(true)
      expect(modal.state.title).toBe("Couldn't add this build")
      expect(modal.state.message).toBe(message)
      expect(modal.state.buttonLabel).toBe('Change location')

      modal.close(true)
      await saving
      await flushPromises()

      expect(window.api.browseFolder).toHaveBeenCalledTimes(2)
      expect(window.api.browseFolder).toHaveBeenLastCalledWith('/home/user/Old')
      expect(window.api.probeInstallation).toHaveBeenLastCalledWith('/home/user/New')
      expect(wrapper.text()).toContain('/home/user/New')
      expect(window.api.trackInstallation).toHaveBeenCalledTimes(1)
      expect(wrapper.emitted('saved')).toBeUndefined()
    }
  )

  it('leaves the location alone when Change location is closed with the ×', async () => {
    const { saving } = await failToAdd({
      ok: false,
      message: 'That directory does not exist.',
      reason: 'location'
    })
    useModal().dismiss()
    await saving
    await flushPromises()
    expect(window.api.browseFolder).toHaveBeenCalledTimes(1)
  })

  it('shows any other failure with a single OK that only closes', async () => {
    const { wrapper, saving } = await failToAdd({ ok: false, message: 'Disk is read-only.' })
    const modal = useModal()
    expect(modal.state.visible).toBe(true)
    expect(modal.state.message).toBe('Disk is read-only.')
    expect(modal.state.buttonLabel).toBe('OK')

    modal.close(true)
    await saving
    await flushPromises()

    expect(window.api.browseFolder).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('saved')).toBeUndefined()
  })
})

describe('TrackBuildForm, choosing a type by hand', () => {
  const gitProbe: ProbeResult = { sourceId: 'git', sourceLabel: 'Git', version: 'abc12345' }
  const manualGit: ProbeResult = {
    sourceId: 'git',
    sourceLabel: 'Git Clone',
    detected: false,
    version: 'unknown'
  }

  async function browseWithResults(results: ProbeResult[]) {
    window.api = {
      getUniqueName: vi.fn(async (name: string) => name),
      browseFolder: vi.fn().mockResolvedValue('/Users/jo/ComfyUI'),
      openPath: vi.fn(),
      probeInstallation: vi.fn().mockResolvedValue(results),
      trackInstallation: vi.fn().mockResolvedValue({ ok: true })
    } as unknown as typeof window.api
    const wrapper = mount(TrackBuildForm)
    await flushPromises()
    await wrapper.get(`[data-testid="${TID.trackBrowse}"]`).trigger('click')
    await flushPromises()
    return wrapper
  }

  function canSave(wrapper: Awaited<ReturnType<typeof browseWithResults>>): boolean {
    return (wrapper.vm as unknown as { canSave: boolean }).canSave
  }

  it('does not pre-select a manual-only type, so the build cannot be added yet', async () => {
    const wrapper = await browseWithResults([manualGit])

    expect(canSave(wrapper)).toBe(false)
    const select = wrapper.findComponent(BaseSelect)
    expect(select.props('placeholder')).toBe('Nothing detected. Choose a type to track it anyway')
    expect(select.props('disabled')).toBe(false)
  })

  it('labels manual types as not detected in the dropdown', async () => {
    const wrapper = await browseWithResults([gitProbe, { ...manualGit, sourceId: 'portable' }])

    const labels = (wrapper.findComponent(BaseSelect).props('options') as { label: string }[]).map(
      (o) => o.label
    )
    expect(labels).toEqual(['Git', 'Git Clone (not detected)'])
  })

  it('still pre-selects a detected type ahead of manual ones', async () => {
    const wrapper = await browseWithResults([gitProbe, manualGit])

    expect(canSave(wrapper)).toBe(true)
    expect(wrapper.find('[data-testid="track-forced-type-hint"]').exists()).toBe(false)
  })

  it('warns and allows adding once a manual type is picked, without saving the flag', async () => {
    const wrapper = await browseWithResults([manualGit])

    wrapper.findComponent(BaseSelect).vm.$emit('update:modelValue', '0')
    await flushPromises()

    expect(wrapper.get('[data-testid="track-forced-type-hint"]').text()).toContain('may not launch')
    expect(canSave(wrapper)).toBe(true)

    await (wrapper.vm as unknown as FormVm).save()
    await flushPromises()

    const data = vi.mocked(window.api.trackInstallation).mock.calls[0]![0] as Record<
      string,
      unknown
    >
    expect(data).toMatchObject({ sourceId: 'git', installPath: '/Users/jo/ComfyUI' })
    expect(data).not.toHaveProperty('detected')
  })

  it('explains how to fix a Git folder that has no venv', async () => {
    const wrapper = await browseWithResults([gitProbe])

    expect(wrapper.get('[data-testid="track-venv-hint"]').exists()).toBe(true)
  })

  it('omits the venv explanation once a venv was detected', async () => {
    const wrapper = await browseWithResults([{ ...gitProbe, venvPath: '/Users/jo/ComfyUI/.venv' }])

    expect(wrapper.find('[data-testid="track-venv-hint"]').exists()).toBe(false)
  })

  it('shows no venv explanation for types that manage their own environment', async () => {
    const wrapper = await browseWithResults([
      { sourceId: 'standalone', sourceLabel: 'Standalone', version: 'v0.1.0' }
    ])

    expect(wrapper.find('[data-testid="track-venv-hint"]').exists()).toBe(false)
  })
})
