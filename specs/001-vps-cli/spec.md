# Feature Specification: supabase-vps CLI

**Feature Branch**: `001-vps-cli`

**Created**: 2026-06-18

**Status**: Implemented

**Input**: CLI for self-hosted Supabase on a VPS — deploy edge functions over SSH, push migrations, generate types, manage credentials (similar to official Supabase CLI but for VPS/Dokploy layouts).

## User Scenarios & Testing

### User Story 1 - One-time VPS setup (Priority: P1)

As a developer with self-hosted Supabase on a VPS, I want to run an interactive setup once so SSH, function paths, database connection details, and restart preferences are stored locally and reused by every command.

**Why this priority**: Without stored config, every deploy/migration requires manual URLs and SCP commands.

**Independent Test**: Run `supabase-vps setup`, complete prompts, verify `~/.supabase-vps/profiles/default.json` and `.supabase-vps.json` exist.

**Acceptance Scenarios**:

1. **Given** no profile exists, **When** the user runs setup, **Then** they are prompted for SSH user, host, local/remote function paths, SSH password, DB tenant/password/ports, and optional restart command.
2. **Given** a profile exists, **When** setup is re-run from settings, **Then** the user can keep existing SSH and DB passwords without retyping them.
3. **Given** setup completes, **When** the user links the project, **Then** `.supabase-vps.json` references the profile name only.

---

### User Story 2 - Deploy edge functions (Priority: P1)

As a developer, I want to upload `supabase/functions` to my VPS without typing SCP commands, and optionally restart the edge runtime afterward.

**Why this priority**: Function deploy is the most frequent manual operation described by the user.

**Independent Test**: Run `supabase-vps functions deploy` with a valid profile and local functions folder; verify SFTP upload and optional SSH restart.

**Acceptance Scenarios**:

1. **Given** a configured profile, **When** `functions deploy` runs, **Then** local function files are uploaded to the configured remote path over SFTP.
2. **Given** restart-after-deploy is enabled, **When** the user confirms restart (or passes `--restart`), **Then** the configured restart command runs over SSH.
3. **Given** the user passes `--no-restart`, **When** deploy completes, **Then** no restart command runs.

---

### User Story 3 - Push migrations (Priority: P2)

As a developer, I want to push local migrations using the official Supabase CLI with a pre-built `--db-url` so I never construct pooler URLs by hand.

**Independent Test**: Run `supabase-vps db push` in a project with `supabase/migrations`.

**Acceptance Scenarios**:

1. **Given** a configured profile, **When** `db push` runs, **Then** it invokes `supabase db push --db-url <push-url> --yes`.
2. **Given** `--debug` is passed, **When** `db push` runs, **Then** `--debug` is forwarded to the Supabase CLI.

---

### User Story 4 - Generate TypeScript types (Priority: P2)

As a developer, I want to regenerate `database.types.ts` from the remote schema without manually running `supabase gen types` with a long URL.

**Independent Test**: Run `supabase-vps gen types -o database.types.ts`.

**Acceptance Scenarios**:

1. **Given** a configured profile, **When** `gen types` runs, **Then** types are written to the chosen output file using the types port from config.
2. **Given** `--schema public` (default), **When** types are generated, **Then** the schema flag is passed to Supabase CLI.

---

### User Story 5 - Manage credentials (Priority: P3)

As a developer, I want to view masked settings and delete stored credentials when I rotate passwords or leave a project.

**Independent Test**: Run `supabase-vps settings`, choose show/delete/setup actions.

**Acceptance Scenarios**:

1. **Given** a profile exists, **When** the user selects show, **Then** secrets are masked in the output.
2. **Given** the user confirms delete, **When** delete completes, **Then** the profile file is removed from disk.

## Requirements

### Functional Requirements

- **FR-001**: CLI MUST provide `setup`, `settings`, `functions deploy`, `db push`, and `gen types` commands.
- **FR-002**: Setup MUST persist SSH user, host, password, function paths, DB tenant/password/host/ports, and restart preferences.
- **FR-003**: Setup MUST support named profiles and project linking via `.supabase-vps.json`.
- **FR-004**: Function deploy MUST upload directory contents over SFTP (equivalent to `scp -r functions/.`).
- **FR-005**: Restart MUST execute a user-defined command over SSH (VPS-agnostic).
- **FR-006**: `db push` and `gen types` MUST shell out to the official Supabase CLI.
- **FR-007**: Settings MUST allow show, re-run setup, and delete profile actions.

### Non-Functional Requirements

- **NFR-001**: Profile JSON files MUST use filesystem mode `600`; config dir mode `700`.
- **NFR-002**: Package MUST run on Node.js 18+ and publish as `supabase-vps` binary.
- **NFR-003**: README MUST document install, setup, and all commands with examples.

## Out of Scope (v0.1)

- Remote profile sync / team cloud integration
- OS keychain storage (roadmap)
- Dokploy/Coolify auto-discovery presets (roadmap)
