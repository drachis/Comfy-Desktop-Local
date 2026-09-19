import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

import TrackModal from './TrackModal.vue'
import { BaseSelect } from '../components/ui'
import type { ProbeResult } from '../types/ipc'

/**
 * The Install Directory field is browse-only: it has no editable input, so
 * typing/pasting is impossible. The only way to populate it is the Browse
 * button, which runs the probe and enables the "Track Install" button when an
 * existing install is detected. Once populated, the path text is clickable to
 * open the folder in the OS file manager.
 */

// Minimal catalog covering the keys the template reads. Missing keys fall
// back to the dotted path, which would surface in a failed assertion.
const messages = {
  en: {
    common: {
      name: 'Name',
      browse: 'Browse',
      namePlaceholder: 'e.g. ComfyUI Main',
      backToDashboard: 'Back to Dashboard'
    },
    git: {
      venv: 'Virtual Environment',
      venvNotFound: 'Not found',
      venvHint: 'No venv found. Browse to one or set it in Manage.'
    },
    track: {
      grandTitle: 'Add Existing Instance',
      grandSubtitle: 'Add an existing local ComfyUI checkout.',
      installDir: 'Install location',
      selectDir: 'Select a directory',
      detectedType: 'Detected type',
      browseDirFirst: 'Browse to a directory first',
      detecting: 'Detecting',
      noDetected: 'No known install detected',
      notDetectedSuffix: 'not detected',
      pickType: 'Nothing detected. Choose a type',
      notDetectedWarning: 'Does not look like this type; may not launch.',
      trackInstallation: 'Track Install',
      cannotTrack: 'Cannot Track',
      version: 'Version',
      repository: 'Repository',
      branch: 'Branch'
    }
  }
}

function createTestI18n() {
  return createI18n({ legacy: false, locale: 'en', messages })
}

interface MockApi {
  getUniqueName: ReturnType<typeof vi.fn>
  browseFolder: ReturnType<typeof vi.fn>
  probeInstallation: ReturnType<typeof vi.fn>
  trackInstallation: ReturnType<typeof vi.fn>
  openPath: ReturnType<typeof vi.fn>
}

const gitProbe: ProbeResult = {
  sourceId: 'git',
  sourceLabel: 'Git',
  version: 'abcdef12',
  repo: 'https://github.com/comfyanonymous/ComfyUI.git',
  branch: 'master',
  commit: 'abcdef12'
}

function installMockApi(overrides: Partial<MockApi> = {}): MockApi {
  const api: MockApi = {
    getUniqueName: vi.fn().mockResolvedValue('ComfyUI'),
    browseFolder: vi.fn().mockResolvedValue(undefined),
    probeInstallation: vi.fn().mockResolvedValue([gitProbe]),
    trackInstallation: vi.fn().mockResolvedValue({ ok: true }),
    openPath: vi.fn().mockResolvedValue(undefined),
    ...overrides
  }
  ;(window as unknown as { api: MockApi }).api = api
  return api
}

function mountTrack() {
  return mount(TrackModal, {
    global: {
      plugins: [createTestI18n()],
      stubs: {
        // BrandTakeoverLayout renders the default slot so the card is in
        // the DOM; the rest are inert presentational shells.
        BrandTakeoverLayout: { template: '<div><slot /><slot name="footer-left" /></div>' },
        TakeoverBack: true,
        BaseSelect: true,
        HardDrive: true
      }
    }
  })
}

function trackButton(wrapper: ReturnType<typeof mountTrack>) {
  return wrapper.get('button.track-save')
}

describe('TrackModal — browse-only install directory', () => {
  beforeEach(() => {
    installMockApi()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders a non-clickable placeholder (no editable input) before a folder is picked', async () => {
    const wrapper = mountTrack()
    ;(wrapper.vm as unknown as { open: () => void }).open()
    await flushPromises()

    // Browse-only: the directory has no editable text input at all.
    expect(wrapper.find('.track-path-input input').exists()).toBe(false)
    // Empty → muted placeholder, not a clickable open button.
    expect(wrapper.find('button.track-path-open').exists()).toBe(false)
    expect(wrapper.find('.track-path-placeholder').exists()).toBe(true)
    expect(wrapper.findAll('.track-label').map((label) => label.text())).toEqual([
      'Install location',
      'Name',
      'Detected type'
    ])
  })

  it('opens the folder in the file manager when the populated path text is clicked', async () => {
    const api = installMockApi({
      browseFolder: vi.fn().mockResolvedValue('/Users/jo/ComfyUI')
    })
    const wrapper = mountTrack()
    ;(wrapper.vm as unknown as { open: () => void }).open()
    await flushPromises()

    await wrapper.get('button.brand-tertiary').trigger('click')
    await flushPromises()

    const pathBtn = wrapper.get('button.track-path-open')
    expect(pathBtn.text()).toBe('/Users/jo/ComfyUI')
    await pathBtn.trigger('click')
    expect(api.openPath).toHaveBeenCalledWith('/Users/jo/ComfyUI')
  })

  it('probes and enables Track Install when a folder is picked via Browse', async () => {
    const api = installMockApi({
      browseFolder: vi.fn().mockResolvedValue('/Users/jo/ComfyUI')
    })
    const wrapper = mountTrack()
    ;(wrapper.vm as unknown as { open: () => void }).open()
    await flushPromises()

    expect(trackButton(wrapper).attributes('disabled')).toBeDefined()

    await wrapper.get('button.brand-tertiary').trigger('click')
    await flushPromises()

    expect(api.probeInstallation).toHaveBeenCalledWith('/Users/jo/ComfyUI')
    expect(trackButton(wrapper).attributes('disabled')).toBeUndefined()
  })

  it('keeps Track Install disabled when no install is detected at the picked folder', async () => {
    const api = installMockApi({
      browseFolder: vi.fn().mockResolvedValue('/tmp/not-comfy'),
      probeInstallation: vi.fn().mockResolvedValue([])
    })
    const wrapper = mountTrack()
    ;(wrapper.vm as unknown as { open: () => void }).open()
    await flushPromises()

    await wrapper.get('button.brand-tertiary').trigger('click')
    await flushPromises()

    expect(api.probeInstallation).toHaveBeenCalledWith('/tmp/not-comfy')
    expect(trackButton(wrapper).attributes('disabled')).toBeDefined()
  })
})

describe('TrackModal — missing venv explanation', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function browseWithProbe(probe: ProbeResult) {
    installMockApi({
      browseFolder: vi.fn().mockResolvedValue('/Users/jo/ComfyUI'),
      probeInstallation: vi.fn().mockResolvedValue([probe])
    })
    const wrapper = mountTrack()
    ;(wrapper.vm as unknown as { open: () => void }).open()
    await flushPromises()
    await wrapper.get('button.brand-tertiary').trigger('click')
    await flushPromises()
    return wrapper
  }

  it('explains how to fix a Git-type folder that has no venv', async () => {
    const wrapper = await browseWithProbe(gitProbe)

    expect(wrapper.get('[data-testid="track-venv-hint"]').text()).toContain('No venv found')
  })

  it('omits the explanation once a venv was detected', async () => {
    const wrapper = await browseWithProbe({ ...gitProbe, venvPath: '/Users/jo/ComfyUI/.venv' })

    expect(wrapper.find('[data-testid="track-venv-hint"]').exists()).toBe(false)
  })

  it('does not show the venv field or hint for types that manage their own environment', async () => {
    const wrapper = await browseWithProbe({
      sourceId: 'standalone',
      sourceLabel: 'Standalone',
      version: 'v0.1.0'
    })

    expect(wrapper.find('[data-testid="track-venv-hint"]').exists()).toBe(false)
  })
})

describe('TrackModal — manual type choice', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const manualGit: ProbeResult = {
    sourceId: 'git',
    sourceLabel: 'Git Clone',
    detected: false,
    version: 'unknown'
  }

  async function browseWithResults(results: ProbeResult[]) {
    const api = installMockApi({
      browseFolder: vi.fn().mockResolvedValue('/Users/jo/ComfyUI'),
      probeInstallation: vi.fn().mockResolvedValue(results)
    })
    const wrapper = mountTrack()
    ;(wrapper.vm as unknown as { open: () => void }).open()
    await flushPromises()
    await wrapper.get('button.brand-tertiary').trigger('click')
    await flushPromises()
    return { api, wrapper }
  }

  it('does not pre-select a manual-only type, so Track Install stays disabled', async () => {
    const { wrapper } = await browseWithResults([manualGit])

    expect(trackButton(wrapper).attributes('disabled')).toBeDefined()
    const select = wrapper.findComponent(BaseSelect)
    expect(select.props('placeholder')).toBe('Nothing detected. Choose a type')
    expect(select.props('disabled')).toBe(false)
  })

  it('labels manual types as not detected in the dropdown', async () => {
    const { wrapper } = await browseWithResults([gitProbe, { ...manualGit, sourceId: 'portable' }])

    const labels = (wrapper.findComponent(BaseSelect).props('options') as { label: string }[]).map(
      (o) => o.label
    )
    expect(labels).toEqual(['Git', 'Git Clone (not detected)'])
  })

  it('still pre-selects a detected type ahead of manual ones', async () => {
    const { wrapper } = await browseWithResults([gitProbe, manualGit])

    expect(trackButton(wrapper).attributes('disabled')).toBeUndefined()
    expect(wrapper.find('[data-testid="track-forced-type-hint"]').exists()).toBe(false)
  })

  it('warns and enables tracking once the user picks a manual type, without saving the flag', async () => {
    const { api, wrapper } = await browseWithResults([manualGit])

    wrapper.findComponent(BaseSelect).vm.$emit('update:modelValue', '0')
    await flushPromises()

    expect(wrapper.get('[data-testid="track-forced-type-hint"]').text()).toContain('may not launch')
    expect(trackButton(wrapper).attributes('disabled')).toBeUndefined()

    await trackButton(wrapper).trigger('click')
    await flushPromises()

    const data = api.trackInstallation.mock.calls[0]![0] as Record<string, unknown>
    expect(data).toMatchObject({ sourceId: 'git', installPath: '/Users/jo/ComfyUI' })
    expect(data).not.toHaveProperty('detected')
  })
})

describe('TrackModal — install path resolution on save', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('records the probe-resolved root when the user picked a nested folder', async () => {
    const standaloneProbe: ProbeResult = {
      sourceId: 'standalone',
      sourceLabel: 'Standalone',
      version: 'v0.1.0',
      installPath: '/Users/jo/standalone'
    }
    const api = installMockApi({
      // User browses to the nested ComfyUI folder; the probe corrects the root.
      browseFolder: vi.fn().mockResolvedValue('/Users/jo/standalone/ComfyUI'),
      probeInstallation: vi.fn().mockResolvedValue([standaloneProbe])
    })
    const wrapper = mountTrack()
    ;(wrapper.vm as unknown as { open: () => void }).open()
    await flushPromises()

    await wrapper.get('button.brand-tertiary').trigger('click')
    await flushPromises()

    await trackButton(wrapper).trigger('click')
    await flushPromises()

    expect(api.trackInstallation).toHaveBeenCalledTimes(1)
    const data = api.trackInstallation.mock.calls[0]![0] as Record<string, unknown>
    expect(data.installPath).toBe('/Users/jo/standalone')
  })

  it('falls back to the picked folder when the probe has no resolved root', async () => {
    const api = installMockApi({
      browseFolder: vi.fn().mockResolvedValue('/Users/jo/ComfyUI')
      // gitProbe has no installPath.
    })
    const wrapper = mountTrack()
    ;(wrapper.vm as unknown as { open: () => void }).open()
    await flushPromises()

    await wrapper.get('button.brand-tertiary').trigger('click')
    await flushPromises()

    await trackButton(wrapper).trigger('click')
    await flushPromises()

    expect(api.trackInstallation).toHaveBeenCalledTimes(1)
    const data = api.trackInstallation.mock.calls[0]![0] as Record<string, unknown>
    expect(data.installPath).toBe('/Users/jo/ComfyUI')
  })
})
