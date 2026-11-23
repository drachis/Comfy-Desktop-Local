# Comfy Desktop Local: fork guide

This repository is a personal fork of [Comfy-Org/Comfy-Desktop](https://github.com/Comfy-Org/Comfy-Desktop)
(`upstream`), published as [drachis/Comfy-Desktop-Local](https://github.com/drachis/Comfy-Desktop-Local)
(`origin`). Upstream is moving toward a cloud-first product: Comfy Cloud, sign-in, team workspaces,
hosted Apps and a ComfyHub catalog. This fork keeps the app a local tool for running your own ComfyUI
builds on your own machine, while still taking every upstream improvement that serves that.

Read this before changing fork behaviour or merging upstream. It is the rulebook for what to keep,
what to hide and how.

## Principles

1. **Local first.** The app must work fully with no account, no network service from Comfy beyond
   downloading ComfyUI and models, and no prompt to sign in or try Cloud.
2. **Hide, don't delete.** Cloud features stay in the code and are switched off at a small number of
   gates. Deleting upstream modules makes every future merge a conflict. A fork change should be a
   condition or a filter, not a rewrite.
3. **One switch.** Everything cloud-facing goes behind local-only mode (below), so turning the flag off
   gives back the upstream app unchanged. Do not add a second, separate mechanism.
4. **Your data is the source of truth.** Never remove install records, settings or model folders to
   hide something; filter them at display time.
5. **Small, additive QoL.** Local conveniences (folder shortcuts, path display, clearer setup help)
   are welcome when they are small and sit next to upstream code instead of replacing it.
6. **Upstream rules still apply.** Follow `AGENTS.md`: no code comments, zero flaky tests, the PR
   description breakdown. Fork code must pass `pnpm run lint`, `pnpm run typecheck` and its tests.

## Local-only mode

| How to turn it on |                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------- |
| Built app         | `"Comfy Desktop.exe" --local-only`                                                       |
| Dev               | `pnpm dev --local-only` (works with `--inspect`, `--remoteDebuggingPort`, `--sourcemap`) |
| Environment       | `COMFY_LOCAL_ONLY=1`                                                                     |

Where to gate something:

- **Main process:** `isLocalOnly()` from `src/main/lib/localOnly.ts`.
- **Renderer (Vue):** `window.api.localOnly` (read once at setup: `const localOnly = window.api?.localOnly === true`).
- **Build types hidden from every list:** `LOCAL_ONLY_HIDDEN_SOURCE_IDS` in `src/shared/localOnly.ts`.
  The filter runs in `isInstallationVisibleToRenderer` (`src/main/lib/ipc/installationVisibility.ts`), so
  the sidebar, Home, Builds, the instance picker and their Cloud tabs and pills all follow from it.

Prefer gating at the source (an IPC handler or the visibility check) over hiding many components.
Gate the renderer only for UI that has no data source to filter, and then also stop it fetching.
Every gate gets a test for both flag states.

### What local-only hides today

| Surface                                                                                                   | Gate                                                     |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Comfy Cloud build everywhere (sidebar, Home, Builds and its Cloud tab, picker, Why-Cloud, free-runs pill) | `isInstallationVisibleToRenderer`, installations summary |
| Sidebar "Log in / Start on Comfy Cloud" card                                                              | `AppSidebar.vue`                                         |
| Comfy Cloud place in Assets                                                                               | `AssetsView.vue`                                         |
| Apps (sidebar, Home, Apps pages and IPC)                                                                  | `areAppsEnabled()` in `src/main/apps/appsConfig.ts`      |
| ComfyHub example workflows on Home                                                                        | `catalog:list-home-workflows` handler and `HomeView.vue` |

### Candidates not yet gated

Check these when they next come up: first-run onboarding (Cloud-first steps), team workspace switcher,
cloud credits in the sidebar, What's new announcements, telemetry choices.

## Fork features to keep through merges

Always on (not behind the flag):

- File menu: Open input folder / Open output folder on build windows (`titlePopup.ts`).
- No Log in item in any menu.
- Opt-in background update checks and a configurable update repository (`forkUpdate.ts`, `updater.ts`).
- Launch blocked while a long operation runs on the same build (`useListAction.ts`, `isLongRunningActionId`).
- Legacy Desktop migration is optional: start with the original app instead (`useListAction.ts`).
- Add existing build: plain ComfyUI folders without `.git` are detected; pick a type by hand when
  detection misses, with a warning (`git.ts`, `probeInstallDir.ts`, `TrackBuildForm.vue`).
- Git builds without a venv: explain the fix, Create / Recreate Python environment with the bundled
  Python and uv (`createVenv.ts`, `git.ts`).
- Install folder path on dashboard tiles (`ChooserInstallTile.vue`, `installPathLabel.ts`).
- Notifications bell hidden on the dashboard (`TitleBarApp.vue`).
- Dev runs share the installed app's profile (`scripts/dev-app/devUserDataArg.mjs`, `devUserData.ts`).

Dropped because upstream now covers them: empty-dashboard New/Add Existing tiles, the picker row
operation spinner and the long-operation pill on tiles.

## Merging upstream

1. `git fetch upstream` and merge `upstream/main` into the fork branch (merge, do not rebase: the
   branch is already published).
2. For each conflict, classify the upstream change:
   - **Neutral or local improvement:** take upstream.
   - **Cloud-first:** take upstream, then put it behind local-only mode at the narrowest gate.
   - **Upstream rewrote a screen the fork changed:** take upstream's version whole, then re-apply the
     fork feature on top of the new code. Drop the fork feature if upstream now does the same thing,
     and record that in the merge commit and in the list above.
3. Run `pnpm run lint:fix` (it also strips comments, per `AGENTS.md`), then `pnpm run lint`,
   `pnpm run format:check`, `pnpm run typecheck` and `pnpm test`.
4. On Windows a number of upstream tests fail on POSIX path and `git`/`os.devNull` assumptions. Before
   blaming the merge, check whether the failing file differs from upstream:
   `git diff --quiet upstream/main -- <file>`.
5. Survey new cloud surfaces after every merge: start `pnpm dev --local-only`, walk Home, Builds,
   Assets, Settings and the menus, and search the diff for `cloud`, `signIn`, `isSignedIn`,
   `workspace`, `comfy.org`, `credits`. Gate what is new and update the tables above.
6. Re-check the dev profile: the window must list your real builds. If it shows a short, different
   list, the dev run is on a separate profile again (see Troubleshooting).
7. The pre-commit hook passes every staged file on one command line, which overflows on Windows for
   large merges. Only bypass it with `--no-verify` after the full-repo checks in step 3 pass, and say
   so in the commit message.

## Troubleshooting

- **Dev run shows different builds or default model folders:** the app is using
  `%APPDATA%\comfyui-desktop-2` instead of `%APPDATA%\Comfy Desktop`. `pnpm dev` passes
  `--user-data-dir` to Electron to prevent this; `COMFY_DEV_USER_DATA` overrides the folder.
- **pnpm swallows `--`:** pass fork options such as `--local-only` directly (`pnpm dev --local-only`);
  the dev launcher removes them before electron-vite sees them.
- **Debugging:** `pnpm dev --inspect 9229 --remoteDebuggingPort 9222 --sourcemap --local-only`, then
  attach to `localhost:9229` (main) and `localhost:9222` (windows) from `chrome://inspect`.

## Related

The sibling fork [drachis/ComfyUI-local](https://github.com/drachis/ComfyUI-local) tracks
Comfy-Org/ComfyUI. Its `master` follows upstream; personal nodes live in the
`custom_nodes/local_nodes` submodule on `feat/local-nodes-submodule`.
