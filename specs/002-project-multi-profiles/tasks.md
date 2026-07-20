# Tasks: Project Multi-Profiles

## Phase 1: Core model

- [x] T001 Extend `ProjectLink` / `ProjectContext` / registry for `profiles` + `activeProfile` with legacy normalize in `src/lib/config.ts`
- [x] T002 Add add/set-active/remove profile helpers and update `saveProjectLink` to additive link behavior
- [x] T003 Update `requireConfig` messaging for multi-profile projects in `src/lib/require-config.ts`

## Phase 2: UX

- [x] T004 Rework `src/commands/projects.ts` for add environment, switch active, unlink one vs all
- [x] T005 Update setup link messaging in `src/commands/setup.ts`
- [x] T006 Update main menu context + help in `src/lib/menu.ts` and `src/lib/ui.ts`

## Phase 3: Tests & polish

- [x] T007 Add unit tests for normalize/resolve/add/switch/remove in `src/lib/config.test.ts`
- [x] T008 Run test suite and fix regressions
