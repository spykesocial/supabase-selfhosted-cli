# Implementation Plan: Project Multi-Profiles

**Branch**: `002-project-multi-profiles` | **Date**: 2026-07-20 | **Spec**: [spec.md](./spec.md)

## Summary

Extend project linking so one repo can associate with multiple named profiles (e.g. `development`, `production`), keep an active default, and improve CLI UX so users always see which environment will be used.

## Technical Context

**Language/Version**: TypeScript / Node.js 18+  
**Primary changes**: `src/lib/config.ts`, `src/commands/projects.ts`, `src/commands/setup.ts`, `src/lib/menu.ts`, `src/lib/ui.ts`, `src/lib/require-config.ts`  
**Storage**: `.supabase-selfhosted-cli.json` gains `profiles[]` + `activeProfile`; legacy `{ "profile": "x" }` auto-upgraded on read/write  
**Testing**: `node:test` unit tests for link normalization and resolution

## Architecture

1. **Normalize** legacy single-profile links into multi-profile shape.
2. **Resolve** `ProjectContext` with `profiles`, `activeProfile`, and resolved `profile` (explicit `-p` or active).
3. **Mutate** via add / set-active / remove-one / remove-all helpers.
4. **UX**: menu context line, projects actions, setup link messaging, help examples.

## Project Structure (touched)

```text
src/lib/config.ts          # link model + helpers
src/lib/config.test.ts     # multi-profile tests
src/lib/require-config.ts  # clearer multi-env errors
src/lib/menu.ts            # active + linked display
src/lib/ui.ts              # help copy
src/commands/projects.ts   # add/switch/unlink UX
src/commands/setup.ts      # add-to-set on link
```
