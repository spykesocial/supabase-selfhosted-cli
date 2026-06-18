# Implementation Plan: supabase-vps CLI

**Branch**: `001-vps-cli` | **Date**: 2026-06-18 | **Spec**: [spec.md](./spec.md)

## Summary

Node.js + TypeScript CLI using Commander for routing, Inquirer for interactive setup, ssh2/ssh2-sftp-client for deploy/restart, and child_process spawn for Supabase CLI delegation. Config stored in `~/.supabase-vps/profiles/<name>.json`.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 18+  
**Primary Dependencies**: commander, @inquirer/prompts, ssh2, ssh2-sftp-client  
**Storage**: Local JSON files (`~/.supabase-vps/`, `.supabase-vps.json`)  
**Testing**: Node built-in test runner (`tsx --test`)  
**Target Platform**: macOS/Linux CLI  
**Project Type**: Single-package CLI  
**Constraints**: No cloud backend in v0.1; secrets local only

## Project Structure

```text
src/
├── cli.ts                 # Commander entrypoint
├── commands/
│   ├── setup.ts
│   ├── settings.ts
│   ├── functions-deploy.ts
│   ├── db-push.ts
│   └── gen-types.ts
└── lib/
    ├── config.ts          # Load/save profiles, buildDbUrl
    ├── paths.ts           # Resolve local functions path
    ├── require-config.ts
    ├── ssh.ts             # SFTP upload + remote exec
    └── supabase-runner.ts # supabase CLI spawn helpers
```

## Implementation Phases

### Phase 1 — Config & setup (P1)

- Profile schema with SSH, functions, database, deploy sections
- Interactive setup wizard with project auto-link
- Password retention on re-setup (keep existing SSH/DB passwords)
- Settings: show / re-run setup / delete

### Phase 2 — Deploy (P1)

- Recursive SFTP upload mirroring `scp -r functions/.`
- Post-deploy restart prompt with `--restart` / `--no-restart` overrides
- Configurable restart command over SSH

### Phase 3 — Database commands (P2)

- `buildDbUrl(config, 'push' | 'types')` with URL-encoded password
- `db push` → `supabase db push --db-url ... --yes [--debug]`
- `gen types` → capture stdout to output file [--debug]

### Phase 4 — Packaging & docs

- tsup ESM build to `dist/cli.js`
- npm bin `supabase-vps`
- README with install, setup table, command examples, roadmap

## Verification

```bash
npm run typecheck
npm test
npm run build
node dist/cli.js --help
```
