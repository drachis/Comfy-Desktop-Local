import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  listHomeWorkflows: vi.fn(async () => [{ id: 'w1' }])
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      mocks.handlers.set(channel, handler)
  }
}))
vi.mock('../../catalog/workflows', () => ({
  listHomeWorkflows: mocks.listHomeWorkflows,
  hubUrlForListedWorkflow: vi.fn(() => null)
}))
vi.mock('../i18n', () => ({ getLocale: () => 'en' }))
vi.mock('../openExternal', () => ({ tryOpenExternalUrl: vi.fn() }))

import { registerCatalogHandlers } from './registerCatalogHandlers'
import { _setLocalOnlyForTests } from '../localOnly'

const listWorkflows = () => mocks.handlers.get('catalog:list-home-workflows')!()

beforeEach(() => {
  mocks.handlers.clear()
  mocks.listHomeWorkflows.mockClear()
  registerCatalogHandlers()
})

afterEach(() => {
  _setLocalOnlyForTests(undefined)
})

describe('catalog:list-home-workflows', () => {
  it('lists the hub workflows when local-only mode is off', async () => {
    _setLocalOnlyForTests(false)
    expect(await listWorkflows()).toEqual([{ id: 'w1' }])
  })

  it('returns nothing and fetches nothing in local-only mode', async () => {
    _setLocalOnlyForTests(true)
    expect(await listWorkflows()).toEqual([])
    expect(mocks.listHomeWorkflows).not.toHaveBeenCalled()
  })
})
