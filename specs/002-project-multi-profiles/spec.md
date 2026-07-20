# Feature Specification: Project Multi-Profiles

**Feature Branch**: `002-project-multi-profiles`

**Created**: 2026-07-20

**Status**: Implemented

**Input**: User description: "should allow a single project to have multiple profiles as well for instance development and production"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Link multiple environments to one project (Priority: P1)

As a developer with separate self-hosted Supabase stacks for development and production, I want one local project directory to be linked to multiple named profiles so I can keep both environments configured without overwriting the project link each time I switch.

**Why this priority**: Today a project stores a single profile name; switching replaces it. Multi-environment workflows are blocked without juggling link files.

**Independent Test**: From a linked project, add a second profile (e.g. `production`) while keeping the first (e.g. `development`); verify the project remembers both and which one is active.

**Acceptance Scenarios**:

1. **Given** a project linked only to `development`, **When** the user adds/links `production`, **Then** the project is associated with both profiles and retains an active (default) profile.
2. **Given** a project with multiple linked profiles, **When** the user lists project/profile status, **Then** all linked profile names and the active profile are shown.
3. **Given** an existing single-profile project link from earlier versions, **When** the user opens or uses the project, **Then** it continues to work and is treated as one linked profile that is also the active profile.

---

### User Story 2 - Choose which environment a command uses (Priority: P1)

As a developer, I want deploy, migration, and type-generation commands to use the project's active profile by default, and to target another linked profile for a single run when I specify it.

**Why this priority**: Multi-profile linking is useless unless day-to-day commands can select the environment safely.

**Independent Test**: With `development` active and `production` also linked, run a command with no profile flag (uses development) and again targeting `production` (uses production credentials/paths).

**Acceptance Scenarios**:

1. **Given** a project with active profile `development`, **When** the user runs a command without selecting a profile, **Then** the command uses the `development` profile.
2. **Given** a project linked to `development` and `production`, **When** the user runs a command targeting `production`, **Then** that run uses `production` without changing the project's active profile.
3. **Given** the user targets a profile name that is not linked to the project (and is not an explicit override the product allows), **When** the command starts, **Then** it fails with a clear message listing the project's linked profiles.

---

### User Story 3 - Switch the project's active profile (Priority: P2)

As a developer, I want to change which linked profile is active for the project so subsequent commands default to that environment until I switch again.

**Why this priority**: Reduces repeated per-command selection when working in one environment for a stretch.

**Independent Test**: Switch active profile from `development` to `production`; verify status and the next unscoped command use `production`.

**Acceptance Scenarios**:

1. **Given** a project linked to multiple profiles, **When** the user switches the active profile to `production`, **Then** status shows `production` as active and unscoped commands use it.
2. **Given** a project with only one linked profile, **When** the user switches, **Then** they can only select among linked profiles (or add/link another first).
3. **Given** the user removes the currently active profile from the project, **When** removal completes, **Then** another linked profile becomes active, or the project becomes unlinked if none remain.

---

### User Story 4 - Create environment-specific profiles from setup (Priority: P2)

As a developer, I want setup to create or update a named profile (e.g. `development` or `production`) and optionally add it to the current project's linked profiles without removing existing ones.

**Why this priority**: Getting a second environment configured should be a natural extension of the existing setup flow.

**Independent Test**: In a project already linked to `development`, run setup for `production` and confirm both remain linked with the new or chosen active profile.

**Acceptance Scenarios**:

1. **Given** a project already linked to `development`, **When** the user runs setup for profile `production` and chooses to link the project, **Then** `production` is added to the project's linked profiles (existing links stay).
2. **Given** setup for a profile that is already linked, **When** the user completes setup, **Then** credentials for that profile are updated and the link set is unchanged unless the user changes the active profile.

---

### Edge Cases

- What happens when the user tries to link a profile that does not exist yet? They are guided to create it (setup) or the link fails with a clear error.
- What happens when two projects link to the same global profile name? Allowed; profiles remain shared credential stores, and each project tracks its own linked set and active profile.
- What happens when the active profile's credential file is deleted from disk but the name remains linked? Commands fail with a clear recovery path (re-run setup for that profile or switch/remove the link).
- What happens when the user unlinks one of several profiles? Other links and the active selection rules above still apply; secrets for the unlinked profile are not deleted unless the user explicitly deletes the profile.
- What happens when profile names collide conceptually (e.g. both `dev` and `development`)? Names are freeform; the product does not enforce a fixed environment taxonomy.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A project MUST be able to associate with zero or more named profiles at the same time (examples: `development`, `production`).
- **FR-002**: A project with one or more linked profiles MUST designate exactly one active profile used as the default for commands.
- **FR-003**: Users MUST be able to add a profile to a project's linked set without removing other linked profiles.
- **FR-004**: Users MUST be able to remove a profile from a project's linked set without deleting that profile's stored credentials, unless they explicitly choose to delete the profile.
- **FR-005**: Users MUST be able to change the project's active profile among its linked profiles.
- **FR-006**: Commands that need credentials (deploy, db push, gen types, settings show, etc.) MUST resolve the active profile by default and MUST allow targeting another profile for a single invocation.
- **FR-007**: Project status/listing MUST show all linked profiles for the project and which one is active.
- **FR-008**: Existing single-profile project links MUST remain valid and behave as a one-profile linked set where that profile is active.
- **FR-009**: Setup MUST be able to create/update a named profile and add it to the current project's linked set without clearing other links.
- **FR-010**: The project link file MUST continue to store only profile references (names / active selection), never secrets.

### Key Entities

- **Profile**: Named local credential and connection settings for one Supabase deployment target (SSH/local paths, database access, restart preferences). Profiles are stored per machine and identified by a freeform name such as `development` or `production`.
- **Project link**: Per-repository association between a project directory and one or more profile names, plus which linked profile is currently active.
- **Active profile**: The linked profile used when the user does not explicitly select another for a command.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can configure both a development and a production profile for the same project in under 10 minutes without losing either link.
- **SC-002**: After linking two profiles, 100% of unscoped command runs use the active profile, and an explicit one-off selection targets the other profile without changing the active default.
- **SC-003**: Users migrating from a single-profile project link need zero manual file edits for existing projects to keep working.
- **SC-004**: In a guided walkthrough, at least 9 out of 10 users can correctly identify which environment will be used before running a destructive or production-facing action (status shows active + linked set).

## Assumptions

- "Development" and "production" are ordinary profile names, not a fixed built-in environment enum; users may use any names (`staging`, `preview`, etc.).
- Profiles remain machine-local shared credential stores; multiple projects may reference the same profile name.
- Selecting another profile for a single command does not change the project's active profile unless the user explicitly switches.
- Backward compatibility with the current single-field project link is required; a transparent upgrade path is acceptable.
- Remote/team sync of profiles remains out of scope (unchanged from the base CLI).
- OS keychain storage remains out of scope.
