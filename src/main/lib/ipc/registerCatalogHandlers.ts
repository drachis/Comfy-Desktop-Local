import { ipcMain } from 'electron'
import { hubUrlForListedWorkflow, listHomeWorkflows } from '../../catalog/workflows'
import { getLocale } from '../i18n'
import { tryOpenExternalUrl } from '../openExternal'
import { isLocalOnly } from '../localOnly'

export function registerCatalogHandlers(): void {
  ipcMain.handle('catalog:list-home-workflows', () =>
    isLocalOnly() ? [] : listHomeWorkflows(getLocale())
  )

  ipcMain.handle('catalog:open-workflow', (_event, id: unknown) => {
    const hubUrl = typeof id === 'string' ? hubUrlForListedWorkflow(id) : null
    return hubUrl ? tryOpenExternalUrl(hubUrl) : false
  })
}
