import { useI18n } from 'vue-i18n'
import { useModal } from './useModal'
import { useDialogs } from './useDialogs'
import { useActionGuard } from './useActionGuard'
import { useLocalInstanceGuard } from './useLocalInstanceGuard'
import { useSessionStore } from '../stores/sessionStore'
import { emitTelemetryAction, toErrorBucket } from '../lib/telemetry'
import { progressOpKindForActionId, destroysInstanceForActionId } from '../lib/progressOpKind'
import {
  IN_PLACE_RELAUNCH,
  augmentMessageWithStopWarning,
  stopAndWaitForExit
} from '../lib/stopWarning'
import { resolvePickerTab } from '../lib/pickerTabs'
import { REQUIRES_STOPPED } from '../types/ipc'
import type { Installation, ListAction, ActionResult, ShowProgressOpts } from '../types/ipc'

export interface ListActionCallbacks {
  showProgress: (opts: ShowProgressOpts) => void
  onNavigate?: (result: ActionResult, action: ListAction) => void | Promise<void>
}

// `onGuardsPassed` fires once after all cancel-paths pass but before the
// action dispatches, so the chooser stakes its attach claim only when the
// launch will really proceed (staking earlier would clobber a sibling's claim).
export interface ListActionInvocationHooks {
  onGuardsPassed?: () => Promise<void> | void
  /** This launch resumes the same installation after a restart stop. */
  isRestart?: boolean
}

export function useListAction(uiSurface: string, callbacks: ListActionCallbacks) {
  const { t } = useI18n()
  const modal = useModal()
  const dialogs = useDialogs()
  const actionGuard = useActionGuard()
  const localInstanceGuard = useLocalInstanceGuard()
  const sessionStore = useSessionStore()

  async function executeAction(
    inst: Installation,
    action: ListAction,
    hooks?: ListActionInvocationHooks
  ): Promise<void> {
    const telemetryContext = {
      source_category: inst.sourceCategory || 'unknown',
      ui_surface: uiSurface
    }

    if (action.enabled === false && action.disabledMessage) {
      // An install that only needs a setup step (e.g. a venv) gets a way to run it from here.
      if (action.id === 'launch' && inst.setupAction) {
        const choice = await dialogs.confirm({
          title: action.label,
          message: action.disabledMessage,
          confirmLabel: inst.setupAction.label,
          cancelLabel: t('common.cancel'),
          tone: 'primary',
          showCancel: true
        })
        if (choice === 'primary') {
          window.api.openInstancePicker({
            installationId: inst.id,
            initialTab: resolvePickerTab(undefined, 'status'),
            autoAction: inst.setupAction.id
          })
        }
        return
      }
      await modal.alert({ title: action.label, message: action.disabledMessage })
      return
    }

    const requiresStoppedGuard =
      REQUIRES_STOPPED.has(action.id) && action.id !== 'migrate-to-standalone'
    const wasRunning = sessionStore.isRunning(inst.id)

    // Busy guard runs for every action so none can race an in-flight op.
    if (!(await actionGuard.checkBeforeAction(inst.id, action.label))) return

    if (action.confirm || (requiresStoppedGuard && wasRunning)) {
      const willStopMsg =
        requiresStoppedGuard && wasRunning
          ? t('errors.willStopRunning', { name: inst.name || 'ComfyUI' })
          : ''
      const baseMessage = action.confirm?.message
      const message = willStopMsg
        ? augmentMessageWithStopWarning(baseMessage, willStopMsg)
        : baseMessage || 'Are you sure?'
      const confirmed = await modal.confirm({
        title: action.confirm?.title || action.label,
        message,
        confirmLabel: action.label,
        confirmStyle: action.style || 'danger'
      })
      if (!confirmed) {
        emitTelemetryAction('comfy.desktop.action.result', {
          action_id: action.id,
          result: 'cancelled',
          ...telemetryContext
        })
        return
      }
    }

    if (action.id === 'launch') {
      const canLaunch = await localInstanceGuard.checkBeforeLaunch(inst.id, {
        isRestart: hooks?.isRestart === true
      })
      if (!canLaunch) {
        emitTelemetryAction('comfy.desktop.action.result', {
          action_id: action.id,
          result: 'cancelled',
          ...telemetryContext
        })
        return
      }
    }

    // A not-yet-adopted Legacy Desktop install offers a choice: migrate (adopt it in place, then
    // launch inside Comfy Desktop) or launch the original app as-is. Migrating is optional. Skips
    // onGuardsPassed on the migrate path since the launch targets the freshly-adopted install.
    if (action.id === 'launch' && inst.sourceId === 'desktop' && !inst.adopted) {
      const choice = await dialogs.confirm({
        title: t('desktop.migrateBeforeLaunchTitle'),
        message: t('desktop.migrateBeforeLaunchMessage'),
        hint: t('desktop.migrateBeforeLaunchHint'),
        confirmLabel: t('desktop.migrateBeforeLaunchConfirm'),
        secondaryLabel: t('desktop.launchLegacyApp'),
        cancelLabel: t('common.cancel'),
        tone: 'primary',
        showCancel: true
      })
      if (choice === false) {
        emitTelemetryAction('comfy.desktop.action.result', {
          action_id: action.id,
          result: 'cancelled',
          ...telemetryContext
        })
        return
      }
      if (choice === 'primary') {
        sessionStore.clearErrorInstance(inst.id)
        emitTelemetryAction('comfy.desktop.action.invoked', {
          action_id: action.id,
          ...telemetryContext
        })
        callbacks.showProgress({
          installationId: inst.id,
          title: `${t('desktop.migrating')} — ${inst.name}`,
          apiCall: async () => {
            const migrateResult = await window.api.runAction(inst.id, 'migrate-to-standalone')
            if (!migrateResult.ok || !migrateResult.newInstallationId) return migrateResult
            // Launch the adopted install in the same overlay (continuous flow).
            return window.api.runAction(migrateResult.newInstallationId, 'launch')
          },
          cancellable: true,
          triggersInstanceStart: true,
          opKind: 'launch'
        })
        return
      }
      // 'secondary': fall through to the normal launch, which starts the original Desktop app.
    }

    // Past all cancel-paths; cancel-sensitive side effects go in this hook.
    if (hooks?.onGuardsPassed) await hooks.onGuardsPassed()

    sessionStore.clearErrorInstance(inst.id)
    emitTelemetryAction('comfy.desktop.action.invoked', {
      action_id: action.id,
      ...telemetryContext
    })

    const needsSelfStop = wasRunning && requiresStoppedGuard
    const wantsRelaunch = needsSelfStop && IN_PLACE_RELAUNCH.has(action.id)
    const isRunning = (): boolean => sessionStore.isRunning(inst.id)

    if (action.showProgress) {
      // Tag launch/restart so the host installs the close-on-instance-started
      // subscription and routes through the brand-chrome takeover.
      const triggersInstanceStart =
        action.id === 'launch' || action.id === 'restart' || wantsRelaunch
      const apiCall = needsSelfStop
        ? async () => {
            await stopAndWaitForExit(inst.id, isRunning)
            const result = await window.api.runAction(inst.id, action.id)
            if (wantsRelaunch && result?.ok !== false) {
              await window.api.runAction(inst.id, 'launch')
            }
            return result
          }
        : () => window.api.runAction(inst.id, action.id)
      callbacks.showProgress({
        installationId: inst.id,
        title: `${action.progressTitle || action.label} — ${inst.name}`,
        apiCall,
        cancellable: !!action.cancellable,
        triggersInstanceStart,
        opKind: progressOpKindForActionId(action.id),
        destroysInstance: destroysInstanceForActionId(action.id),
        actionId: action.id
      })
      return
    }

    try {
      if (needsSelfStop) {
        await stopAndWaitForExit(inst.id, isRunning)
      }
      const result = await window.api.runAction(inst.id, action.id)
      if (result.running) {
        await actionGuard.checkBeforeAction(inst.id, action.label)
        return
      }
      if (wantsRelaunch && result?.ok !== false) {
        await window.api.runAction(inst.id, 'launch')
      }
      const resultValue = result.cancelled ? 'cancelled' : result.ok === false ? 'failed' : 'ok'
      emitTelemetryAction('comfy.desktop.action.result', {
        action_id: action.id,
        result: resultValue,
        ...telemetryContext
      })
      if (callbacks.onNavigate) {
        await callbacks.onNavigate(result, action)
      } else if (result.message) {
        await modal.alert({ title: action.label, message: result.message })
      }
    } catch (error: unknown) {
      emitTelemetryAction('comfy.desktop.action.result', {
        action_id: action.id,
        result: 'failed',
        error_bucket: toErrorBucket(error),
        ...telemetryContext
      })
      throw error
    }
  }

  return { executeAction }
}
