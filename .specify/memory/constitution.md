# supabase-selfhosted-cli Constitution

## Core Principles

### I. CLI-First Workflow

Every capability is exposed as a subcommand of `supabase-selfhosted-cli`. Commands accept flags for non-interactive use and interactive prompts only when required (setup, destructive actions, optional restart). Output goes to stdout/stderr; exit codes indicate success or failure.

### II. Local Credential Storage

SSH and database passwords are stored once during setup in `~/.supabase-selfhosted-cli/profiles/` (mode `600`). Re-running setup must allow keeping existing secrets. Users can view masked config and delete profiles via `supabase-selfhosted-cli settings`. Never log or print raw passwords.

### III. Supabase CLI Delegation

Database operations (`db push`, `gen types`) delegate to the official Supabase CLI via `npx supabase` or a local install. This package builds connection URLs and project context; it does not reimplement migration or type generation logic.

### IV. Deployment-Agnostic Deploy

Function deploy supports local filesystem copy (Docker volume on this machine) and SFTP over SSH (remote VPS). Restart behavior is driven by a user-configured shell command, so any layout (Docker, Compose, Dokploy, systemd) can be supported without hard-coded assumptions.

### V. Simplicity & Testability

Pure logic (URL building, config resolution, path handling) lives in small modules with unit tests. Network and subprocess calls stay at the command layer. Avoid new dependencies unless they remove substantial complexity.

## Security Requirements

- Config directory created with mode `700`; profile files with mode `600`.
- Passwords must be URL-encoded when embedded in Postgres connection strings.
- Project link file (`.supabase-selfhosted-cli.json`) stores only the profile name, never secrets.

## Development Workflow

- Spec-driven changes use Spec Kit artifacts under `specs/`.
- New commands require README documentation and config schema updates.
- Breaking config changes bump the package minor version and document migration steps.

## Governance

This constitution guides feature scope and review. Amendments are documented in `.specify/memory/constitution.md` with an updated version line.

**Version**: 1.0.0 | **Ratified**: 2026-06-18 | **Last Amended**: 2026-06-18
