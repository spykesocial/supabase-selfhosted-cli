# Tasks: supabase-vps CLI

**Input**: [plan.md](./plan.md) | **Spec**: [spec.md](./spec.md)

## Phase 1 — Setup & config

- [x] T001 Define `SupabaseVpsConfig` schema and profile persistence in `src/lib/config.ts`
- [x] T002 Implement interactive `setup` command in `src/commands/setup.ts`
- [x] T003 Implement `settings` show/update/delete in `src/commands/settings.ts`
- [x] T004 Add password retention when re-running setup (keep existing SSH/DB passwords)

## Phase 2 — Function deploy

- [x] T005 SFTP recursive upload in `src/lib/ssh.ts`
- [x] T006 `functions deploy` with restart prompt and flags in `src/commands/functions-deploy.ts`

## Phase 3 — Database

- [x] T007 `buildDbUrl` with encoded passwords + unit tests
- [x] T008 `db push` command delegating to Supabase CLI
- [x] T009 `gen types` command with output file capture

## Phase 4 — Ship

- [x] T010 Commander CLI wiring in `src/cli.ts`
- [x] T011 README and npm package metadata
- [x] T012 Spec Kit constitution + spec artifacts under `specs/001-vps-cli/`
