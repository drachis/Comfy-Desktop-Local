import { ipcMain } from 'electron'
import { LOCAL_ONLY_SYNC_CHANNEL } from '../../shared/localOnly'
import { isLocalOnly } from './localOnly'

export function registerLocalOnlyIpc(): void {
  ipcMain.on(LOCAL_ONLY_SYNC_CHANNEL, (event) => {
    event.returnValue = isLocalOnly()
  })
}
