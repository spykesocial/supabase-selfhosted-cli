import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findSupabaseProjectRoot } from "./paths.js";

export const CONFIG_DIR = path.join(os.homedir(), ".supabase-selfhosted-cli");
export const DEFAULT_PROFILE = "default";
export const PROJECT_LINK_FILENAME = ".supabase-selfhosted-cli.json";

export type DeployTarget = "ssh" | "local";

export type SupabaseSelfhostedConfig = {
  profile: string;
  target: DeployTarget;
  ssh: {
    user: string;
    host: string;
    password: string;
  };
  functions: {
    localPath: string;
    remotePath: string;
  };
  database: {
    tenantId: string;
    password: string;
    host: string;
    pushPort: number;
    typesPort: number;
    database: string;
  };
  deploy: {
    restartAfterDeploy: boolean;
    restartCommand: string;
  };
  createdAt: string;
  updatedAt: string;
};

/** On-disk project link. Legacy files may only have `profile`. */
export type ProjectLink = {
  profiles: string[];
  activeProfile: string;
  /** @deprecated Prefer `activeProfile`; kept for backward-compatible writes. */
  profile: string;
};

export type ProjectLinkRaw = {
  profile?: string;
  profiles?: string[];
  activeProfile?: string;
};

export type ProjectEntry = {
  path: string;
  /** Active profile (legacy field retained for display/compat). */
  profile: string;
  profiles: string[];
  activeProfile: string;
  name: string;
  linkedAt: string;
};

export type ProjectRegistry = {
  projects: ProjectEntry[];
};

export type ProjectContext = {
  cwd: string;
  projectRoot: string;
  /** Profile used for this resolution (explicit override or active). */
  profile: string;
  profiles: string[];
  activeProfile: string | null;
  isLinked: boolean;
  suggestedProfileName: string;
};

function profilePath(profile: string): string {
  return path.join(CONFIG_DIR, "profiles", `${profile}.json`);
}

function projectLinkPath(dir: string): string {
  return path.join(dir, PROJECT_LINK_FILENAME);
}

function registryPath(): string {
  return path.join(CONFIG_DIR, "projects.json");
}

function normalizeProjectPath(dir: string): string {
  return path.resolve(dir);
}

export function suggestProfileName(dir: string): string {
  const base = path.basename(normalizeProjectPath(dir));
  const sanitized = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return sanitized || DEFAULT_PROFILE;
}

export function resolveProjectRoot(cwd: string): string {
  return findSupabaseProjectRoot(cwd) ?? normalizeProjectPath(cwd);
}

export function ensureConfigDir(): void {
  fs.mkdirSync(path.join(CONFIG_DIR, "profiles"), { recursive: true, mode: 0o700 });
}

export function saveConfig(config: SupabaseSelfhostedConfig): void {
  ensureConfigDir();
  const filePath = profilePath(config.profile);
  fs.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

function normalizeConfig(raw: SupabaseSelfhostedConfig): SupabaseSelfhostedConfig {
  return {
    ...raw,
    target: raw.target ?? "ssh",
  };
}

export function loadConfig(profile = DEFAULT_PROFILE): SupabaseSelfhostedConfig | null {
  const filePath = profilePath(profile);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as SupabaseSelfhostedConfig;
  return normalizeConfig(raw);
}

export function deleteConfig(profile = DEFAULT_PROFILE): boolean {
  const filePath = profilePath(profile);
  if (!fs.existsSync(filePath)) {
    return false;
  }

  fs.unlinkSync(filePath);
  detachProfileFromProjects(profile);
  return true;
}

export function listProfiles(): string[] {
  const profilesDir = path.join(CONFIG_DIR, "profiles");
  if (!fs.existsSync(profilesDir)) {
    return [];
  }

  return fs
    .readdirSync(profilesDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.replace(/\.json$/, ""));
}

export function normalizeProjectLink(raw: ProjectLinkRaw | null | undefined): ProjectLink | null {
  if (!raw) {
    return null;
  }

  const fromList = Array.isArray(raw.profiles)
    ? raw.profiles.filter((name): name is string => typeof name === "string" && name.trim().length > 0)
    : [];
  const legacy = typeof raw.profile === "string" && raw.profile.trim() ? raw.profile.trim() : null;
  const activeCandidate =
    typeof raw.activeProfile === "string" && raw.activeProfile.trim()
      ? raw.activeProfile.trim()
      : legacy;

  const profiles = [...new Set(fromList.length > 0 ? fromList : legacy ? [legacy] : [])];
  if (profiles.length === 0) {
    return null;
  }

  const activeProfile =
    activeCandidate && profiles.includes(activeCandidate)
      ? activeCandidate
      : profiles[0];

  return {
    profiles,
    activeProfile,
    profile: activeProfile,
  };
}

function readProjectLinkAt(dir: string): ProjectLink | null {
  const linkPath = projectLinkPath(dir);
  if (!fs.existsSync(linkPath)) {
    return null;
  }

  const raw = JSON.parse(fs.readFileSync(linkPath, "utf8")) as ProjectLinkRaw;
  return normalizeProjectLink(raw);
}

function writeProjectLinkFile(projectRoot: string, link: ProjectLink): void {
  const normalized = normalizeProjectLink(link);
  if (!normalized) {
    throw new Error("Cannot write an empty project link");
  }

  fs.writeFileSync(
    projectLinkPath(projectRoot),
    `${JSON.stringify(
      {
        profiles: normalized.profiles,
        activeProfile: normalized.activeProfile,
        profile: normalized.activeProfile,
      },
      null,
      2,
    )}\n`,
  );
}

/** Returns the active profile name for a project, or null if unlinked. */
export function loadProjectLink(cwd: string): string | null {
  return loadProjectLinkData(cwd)?.activeProfile ?? null;
}

/** Returns the full normalized project link, walking up from cwd. */
export function loadProjectLinkData(cwd: string): ProjectLink | null {
  let current = normalizeProjectPath(cwd);

  while (true) {
    const link = readProjectLinkAt(current);
    if (link) {
      return link;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }

    current = parent;
  }
}

export function findProjectLinkRoot(cwd: string): string | null {
  let current = normalizeProjectPath(cwd);

  while (true) {
    if (fs.existsSync(projectLinkPath(current))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }

    current = parent;
  }
}

export function resolveProfile(cwd: string, explicitProfile?: string): string {
  return resolveProjectContext(cwd, explicitProfile).profile;
}

export function resolveProjectContext(
  cwd: string,
  explicitProfile?: string,
): ProjectContext {
  const normalizedCwd = normalizeProjectPath(cwd);
  const projectRoot = resolveProjectRoot(normalizedCwd);
  const suggestedProfileName = suggestProfileName(projectRoot);
  const link = loadProjectLinkData(normalizedCwd);

  if (explicitProfile) {
    return {
      cwd: normalizedCwd,
      projectRoot,
      profile: explicitProfile,
      profiles: link?.profiles ?? [],
      activeProfile: link?.activeProfile ?? null,
      isLinked: Boolean(link?.profiles.includes(explicitProfile)),
      suggestedProfileName,
    };
  }

  if (link) {
    ensureProjectRegistered(projectRoot, link);
    return {
      cwd: normalizedCwd,
      projectRoot,
      profile: link.activeProfile,
      profiles: link.profiles,
      activeProfile: link.activeProfile,
      isLinked: true,
      suggestedProfileName,
    };
  }

  return {
    cwd: normalizedCwd,
    projectRoot,
    profile: suggestedProfileName,
    profiles: [],
    activeProfile: null,
    isLinked: false,
    suggestedProfileName,
  };
}

export function loadProjectRegistry(): ProjectRegistry {
  const filePath = registryPath();
  if (!fs.existsSync(filePath)) {
    return { projects: [] };
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8")) as ProjectRegistry;
}

function saveProjectRegistry(registry: ProjectRegistry): void {
  ensureConfigDir();
  fs.writeFileSync(registryPath(), `${JSON.stringify(registry, null, 2)}\n`, {
    mode: 0o600,
  });
}

export function listRegisteredProjects(): ProjectEntry[] {
  return loadProjectRegistry()
    .projects.map((entry) => normalizeProjectEntry(entry))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function ensureProjectRegistered(projectRoot: string, link: ProjectLink): void {
  const normalizedPath = normalizeProjectPath(projectRoot);
  const registry = loadProjectRegistry();
  const existing = registry.projects.find((project) => project.path === normalizedPath);
  if (
    existing &&
    existing.activeProfile === link.activeProfile &&
    sameProfileSet(existing.profiles ?? [existing.profile], link.profiles)
  ) {
    return;
  }

  registerProject(normalizedPath, link, existing?.name);
}

function sameProfileSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((name, index) => name === sortedRight[index]);
}

function normalizeProjectEntry(entry: ProjectEntry): ProjectEntry {
  const link = normalizeProjectLink({
    profile: entry.profile,
    profiles: entry.profiles,
    activeProfile: entry.activeProfile ?? entry.profile,
  });

  if (!link) {
    return {
      ...entry,
      profiles: entry.profile ? [entry.profile] : [],
      activeProfile: entry.profile,
      profile: entry.profile,
    };
  }

  return {
    ...entry,
    profiles: link.profiles,
    activeProfile: link.activeProfile,
    profile: link.activeProfile,
  };
}

export function registerProject(
  cwd: string,
  linkOrProfile: ProjectLink | string,
  name?: string,
): ProjectEntry {
  const projectRoot = resolveProjectRoot(cwd);
  const normalizedPath = normalizeProjectPath(projectRoot);
  const link =
    typeof linkOrProfile === "string"
      ? normalizeProjectLink({ profile: linkOrProfile })
      : normalizeProjectLink(linkOrProfile);

  if (!link) {
    throw new Error("Cannot register a project without at least one profile");
  }

  const registry = loadProjectRegistry();
  const existingIndex = registry.projects.findIndex(
    (project) => project.path === normalizedPath,
  );
  const existing = existingIndex >= 0 ? registry.projects[existingIndex] : undefined;

  const entry: ProjectEntry = {
    path: normalizedPath,
    profile: link.activeProfile,
    profiles: link.profiles,
    activeProfile: link.activeProfile,
    name: name ?? existing?.name ?? path.basename(normalizedPath),
    linkedAt: existing?.linkedAt ?? new Date().toISOString(),
  };

  if (existingIndex >= 0) {
    registry.projects[existingIndex] = entry;
  } else {
    registry.projects.push(entry);
  }

  saveProjectRegistry(registry);
  return entry;
}

export function unregisterProject(cwd: string): boolean {
  const projectRoot = resolveProjectRoot(cwd);
  const normalizedPath = normalizeProjectPath(projectRoot);
  const registry = loadProjectRegistry();
  const nextProjects = registry.projects.filter(
    (project) => project.path !== normalizedPath,
  );

  if (nextProjects.length === registry.projects.length) {
    return false;
  }

  saveProjectRegistry({ projects: nextProjects });
  return true;
}

/**
 * Add a profile to the project's linked set and make it active.
 * Existing linked profiles are preserved.
 */
export function saveProjectLink(cwd: string, profile: string, name?: string): void {
  addProjectProfile(cwd, profile, { makeActive: true, name });
}

export function addProjectProfile(
  cwd: string,
  profile: string,
  options?: { makeActive?: boolean; name?: string },
): ProjectLink {
  const projectRoot = resolveProjectRoot(cwd);
  const existing = readProjectLinkAt(projectRoot);
  const profiles = [...new Set([...(existing?.profiles ?? []), profile])];
  const makeActive = options?.makeActive ?? !existing;
  const activeProfile = makeActive
    ? profile
    : (existing?.activeProfile && profiles.includes(existing.activeProfile)
        ? existing.activeProfile
        : profile);

  const link: ProjectLink = {
    profiles,
    activeProfile,
    profile: activeProfile,
  };

  writeProjectLinkFile(projectRoot, link);
  registerProject(projectRoot, link, options?.name);
  return link;
}

export function setActiveProjectProfile(cwd: string, profile: string): ProjectLink {
  const projectRoot = resolveProjectRoot(cwd);
  const existing = readProjectLinkAt(projectRoot);
  if (!existing) {
    return addProjectProfile(cwd, profile, { makeActive: true });
  }

  if (!existing.profiles.includes(profile)) {
    return addProjectProfile(cwd, profile, { makeActive: true });
  }

  const link: ProjectLink = {
    profiles: existing.profiles,
    activeProfile: profile,
    profile,
  };

  writeProjectLinkFile(projectRoot, link);
  registerProject(projectRoot, link);
  return link;
}

/**
 * Remove one profile from the project link.
 * Returns the updated link, or null if the project became fully unlinked.
 */
export function removeProjectProfile(cwd: string, profile: string): ProjectLink | null {
  const linkRoot = findProjectLinkRoot(cwd);
  if (!linkRoot) {
    return null;
  }

  const existing = readProjectLinkAt(linkRoot);
  if (!existing) {
    return null;
  }

  const profiles = existing.profiles.filter((name) => name !== profile);
  if (profiles.length === 0) {
    removeProjectLink(linkRoot);
    return null;
  }

  const activeProfile =
    existing.activeProfile === profile ? profiles[0] : existing.activeProfile;
  const link: ProjectLink = {
    profiles,
    activeProfile,
    profile: activeProfile,
  };

  writeProjectLinkFile(linkRoot, link);
  registerProject(linkRoot, link);
  return link;
}

export function removeProjectLink(cwd: string): boolean {
  const linkRoot = findProjectLinkRoot(cwd);
  if (!linkRoot) {
    return false;
  }

  fs.unlinkSync(projectLinkPath(linkRoot));
  unregisterProject(linkRoot);
  return true;
}

/** Drop a deleted profile from every project link / registry entry. */
export function detachProfileFromProjects(profile: string): void {
  const registry = loadProjectRegistry();
  const nextProjects: ProjectEntry[] = [];

  for (const entry of registry.projects) {
    const normalized = normalizeProjectEntry(entry);
    if (!normalized.profiles.includes(profile)) {
      nextProjects.push(normalized);
      continue;
    }

    const nextProfiles = normalized.profiles.filter((name) => name !== profile);
    if (nextProfiles.length === 0) {
      if (fs.existsSync(projectLinkPath(normalized.path))) {
        fs.unlinkSync(projectLinkPath(normalized.path));
      }
      continue;
    }

    const activeProfile =
      normalized.activeProfile === profile ? nextProfiles[0] : normalized.activeProfile;
    const link: ProjectLink = {
      profiles: nextProfiles,
      activeProfile,
      profile: activeProfile,
    };
    writeProjectLinkFile(normalized.path, link);
    nextProjects.push({
      ...normalized,
      profiles: nextProfiles,
      activeProfile,
      profile: activeProfile,
    });
  }

  saveProjectRegistry({ projects: nextProjects });
}

export function formatProjectContextSummary(context: ProjectContext): string {
  const projectLabel = path.basename(context.projectRoot);
  const lines = [
    `Project: ${projectLabel}`,
    `Directory: ${context.projectRoot}`,
  ];

  if (context.isLinked || context.profiles.length > 0) {
    const linked = context.profiles.length > 0 ? context.profiles : [context.profile];
    const active = context.activeProfile ?? context.profile;
    if (active !== context.profile) {
      lines.push(`Using profile: ${context.profile} (active default: ${active})`);
    } else {
      lines.push(`Active profile: ${active}`);
    }
    lines.push(
      linked.length === 1
        ? `Linked profiles: ${linked[0]}`
        : `Linked profiles: ${linked.join(", ")}`,
    );
  } else {
    lines.push(`Active profile: (not linked — suggested: ${context.suggestedProfileName})`);
    lines.push("Linked profiles: (none)");
  }

  return lines.join("\n");
}

export function formatLinkedProfilesLabel(context: ProjectContext): string {
  if (!context.isLinked && context.profiles.length === 0) {
    return "(not linked — run Setup or Projects)";
  }

  const active = context.activeProfile ?? context.profile;
  if (context.profiles.length <= 1) {
    return active;
  }

  const others = context.profiles.filter((name) => name !== active);
  return `${active}  ·  also: ${others.join(", ")}`;
}

export function formatProfileTargetSummary(
  config: SupabaseSelfhostedConfig,
): string {
  if (config.target === "local") {
    return "local machine";
  }

  return `${config.ssh.user}@${config.ssh.host}`;
}

export function getPrimaryDbPort(
  config: SupabaseSelfhostedConfig,
  kind: "push" | "types",
): number {
  return kind === "push" ? config.database.pushPort : config.database.typesPort;
}

/** The other configured DB port (push ↔ types), when they differ. */
export function getAlternateDbPort(
  config: SupabaseSelfhostedConfig,
  kind: "push" | "types",
): number | undefined {
  const primary = getPrimaryDbPort(config, kind);
  const alternate = kind === "push" ? config.database.typesPort : config.database.pushPort;
  return alternate === primary ? undefined : alternate;
}

/** Primary port first, then the other configured port if different. */
export function getDbPortsWithFallback(
  config: SupabaseSelfhostedConfig,
  kind: "push" | "types",
): number[] {
  const primary = getPrimaryDbPort(config, kind);
  const alternate = getAlternateDbPort(config, kind);
  return alternate === undefined ? [primary] : [primary, alternate];
}

export function buildDbUrl(
  config: SupabaseSelfhostedConfig,
  kind: "push" | "types",
  options?: { port?: number },
): string {
  const { tenantId, password, host, database } = config.database;
  const port = options?.port ?? getPrimaryDbPort(config, kind);
  const encodedPassword = encodeURIComponent(password);
  // Self-hosted Supavisor usually has no TLS. Recent supabase CLI versions
  // require TLS for remote hosts unless sslmode=disable / PGSSLMODE=disable.
  return `postgresql://postgres.${tenantId}:${encodedPassword}@${host}:${port}/${database}?sslmode=disable`;
}

export function maskSecret(value: string): string {
  if (value.length <= 4) {
    return "****";
  }

  return `${value.slice(0, 2)}${"*".repeat(Math.min(value.length - 4, 12))}${value.slice(-2)}`;
}

export function formatConfigSummary(config: SupabaseSelfhostedConfig): string {
  const targetLabel = config.target === "local" ? "Local (Docker / filesystem)" : "Remote (SSH)";
  const lines = [
    `Profile: ${config.profile}`,
    `Target: ${targetLabel}`,
  ];

  if (config.target === "ssh") {
    lines.push(
      `SSH: ${config.ssh.user}@${config.ssh.host}`,
      `SSH password: ${maskSecret(config.ssh.password)}`,
    );
  }

  lines.push(
    `Local functions: ${config.functions.localPath}`,
    `Functions destination: ${config.functions.remotePath}`,
    `DB tenant: postgres.${config.database.tenantId}`,
    `DB password: ${maskSecret(config.database.password)}`,
    `DB push port: ${config.database.pushPort}`,
    `DB types port: ${config.database.typesPort}`,
    `Restart after deploy: ${config.deploy.restartAfterDeploy ? "yes" : "no"}`,
    `Restart command: ${config.deploy.restartCommand || "(not set)"}`,
  );

  return lines.join("\n");
}
