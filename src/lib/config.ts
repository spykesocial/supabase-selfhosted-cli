import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findSupabaseProjectRoot } from "./paths.js";

export const CONFIG_DIR = path.join(os.homedir(), ".supabase-selfhosted-cli");
export const DEFAULT_ENVIRONMENT = "default";
export const PROJECT_LINK_FILENAME = ".supabase-selfhosted-cli.json";

export type DeployTarget = "ssh" | "local";

export type SupabaseSelfhostedConfig = {
  environment: string;
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
    pruneAfterDeploy: boolean;
  };
  createdAt: string;
  updatedAt: string;
};

/** On-disk project link. Reads legacy `profile` / `profiles` / `activeProfile` keys. */
export type ProjectLink = {
  environments: string[];
  projectId: string;
};

export type ProjectLinkRaw = {
  /** New format key */
  environments?: string[];
  /** Legacy single-profile key */
  profile?: string;
  /** Legacy multi-profile keys */
  profiles?: string[];
  activeProfile?: string;
  projectId?: string;
};

export type ProjectEntry = {
  path: string;
  environments: string[];
  name: string;
  linkedAt: string;
  projectId: string | null;
};

export type ProjectRegistry = {
  projects: ProjectEntry[];
};

export type ProjectContext = {
  cwd: string;
  projectRoot: string;
  /** Resolved environment for this context. */
  environment: string;
  environments: string[];
  isLinked: boolean;
  suggestedEnvironmentName: string;
  projectId: string | null;
};

function environmentPath(environment: string, projectId?: string | null): string {
  if (projectId) {
    return path.join(CONFIG_DIR, "profiles", projectId, `${environment}.json`);
  }
  return path.join(CONFIG_DIR, "profiles", `${environment}.json`);
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

export function generateProjectId(): string {
  return crypto.randomUUID();
}

/** Returns the set of project paths that reference this environment. */
export function findEnvironmentProjects(environment: string): string[] {
  const registry = loadProjectRegistry();
  return registry.projects
    .filter((entry) => {
      const normalized = normalizeProjectEntry(entry);
      return normalized.environments.includes(environment);
    })
    .map((entry) => entry.path);
}

export function suggestEnvironmentName(dir: string): string {
  const base = path.basename(normalizeProjectPath(dir));
  const sanitized = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return sanitized || DEFAULT_ENVIRONMENT;
}

export function resolveProjectRoot(cwd: string): string {
  return findSupabaseProjectRoot(cwd) ?? normalizeProjectPath(cwd);
}

export function ensureConfigDir(projectId?: string | null): void {
  const dir = projectId
    ? path.join(CONFIG_DIR, "profiles", projectId)
    : path.join(CONFIG_DIR, "profiles");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

export function saveConfig(config: SupabaseSelfhostedConfig, projectId?: string | null): void {
  const filePath = environmentPath(config.environment, projectId);
  ensureConfigDir(projectId);
  fs.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  // Migrate: if saving to a namespaced path, remove the bare legacy file if it exists
  if (projectId) {
    const barePath = environmentPath(config.environment);
    if (barePath !== filePath && fs.existsSync(barePath)) {
      fs.unlinkSync(barePath);
    }
  }
}

function normalizeConfig(raw: SupabaseSelfhostedConfig): SupabaseSelfhostedConfig {
  return {
    ...raw,
    target: raw.target ?? "ssh",
    deploy: {
      ...raw.deploy,
      pruneAfterDeploy: raw.deploy?.pruneAfterDeploy ?? false,
    },
  };
}

export function loadConfig(environment = DEFAULT_ENVIRONMENT, projectId?: string | null): SupabaseSelfhostedConfig | null {
  // Try namespaced path first, then bare path (backward compat)
  if (projectId) {
    const namespacedPath = environmentPath(environment, projectId);
    if (fs.existsSync(namespacedPath)) {
      const raw = JSON.parse(fs.readFileSync(namespacedPath, "utf8")) as SupabaseSelfhostedConfig;
      return normalizeConfig(raw);
    }
  }

  const filePath = environmentPath(environment);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as SupabaseSelfhostedConfig;
  return normalizeConfig(raw);
}

export function deleteConfig(environment = DEFAULT_ENVIRONMENT, projectId?: string | null): boolean {
  const filePath = environmentPath(environment, projectId);
  if (!fs.existsSync(filePath)) {
    if (projectId) {
      // Also try bare path for backward compat
      const barePath = environmentPath(environment);
      if (fs.existsSync(barePath)) {
        fs.unlinkSync(barePath);
        detachEnvironmentFromProjects(environment);
        return true;
      }
    }
    return false;
  }

  fs.unlinkSync(filePath);
  detachEnvironmentFromProjects(environment);
  return true;
}

export function listEnvironments(projectId?: string | null): string[] {
  if (projectId) {
    const projectEnvironmentsDir = path.join(CONFIG_DIR, "profiles", projectId);
    if (!fs.existsSync(projectEnvironmentsDir)) {
      return [];
    }
    return fs
      .readdirSync(projectEnvironmentsDir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.replace(/\.json$/, ""));
  }

  const profilesDir = path.join(CONFIG_DIR, "profiles");
  if (!fs.existsSync(profilesDir)) {
    return [];
  }

  const environments: string[] = [];
  const seen = new Set<string>();

  for (const entry of fs.readdirSync(profilesDir)) {
    const fullPath = path.join(profilesDir, entry);
    if (entry.endsWith(".json")) {
      const name = entry.replace(/\.json$/, "");
      if (!seen.has(name)) {
        seen.add(name);
        environments.push(name);
      }
    } else if (fs.statSync(fullPath).isDirectory()) {
      const subDir = path.join(profilesDir, entry);
      for (const subEntry of fs.readdirSync(subDir)) {
        if (subEntry.endsWith(".json")) {
          const name = subEntry.replace(/\.json$/, "");
          if (!seen.has(name)) {
            seen.add(name);
            environments.push(name);
          }
        }
      }
    }
  }

  return environments;
}

export function normalizeProjectLink(raw: ProjectLinkRaw | null | undefined): ProjectLink | null {
  if (!raw) {
    return null;
  }

  // Prefer new environments key, fall back to legacy profiles/profile keys
  const fromEnvironments = Array.isArray(raw.environments)
    ? raw.environments.filter((name): name is string => typeof name === "string" && name.trim().length > 0)
    : [];
  const fromList = Array.isArray(raw.profiles)
    ? raw.profiles.filter((name): name is string => typeof name === "string" && name.trim().length > 0)
    : [];
  const legacy = typeof raw.profile === "string" && raw.profile.trim() ? raw.profile.trim() : null;
  const legacyActive =
    typeof raw.activeProfile === "string" && raw.activeProfile.trim()
      ? raw.activeProfile.trim()
      : legacy;

  const environments = [...new Set(
    fromEnvironments.length > 0
      ? fromEnvironments
      : fromList.length > 0
        ? fromList
        : legacy
          ? [legacy]
          : legacyActive
            ? [legacyActive]
            : [],
  )];
  if (environments.length === 0) {
    return null;
  }

  const projectId =
    typeof raw.projectId === "string" && raw.projectId.trim()
      ? raw.projectId.trim()
      : generateProjectId();

  return {
    environments,
    projectId,
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
        environments: normalized.environments,
        projectId: normalized.projectId,
      },
      null,
      2,
    )}\n`,
  );
}

/** Returns the first environment name for a project, or null if unlinked. */
export function loadProjectLink(cwd: string): string | null {
  const link = loadProjectLinkData(cwd);
  return link?.environments[0] ?? null;
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

export function resolveEnvironment(cwd: string, explicitEnvironment?: string): string {
  return resolveProjectContext(cwd, explicitEnvironment).environment;
}

export function resolveProjectContext(
  cwd: string,
  explicitEnvironment?: string,
): ProjectContext {
  const normalizedCwd = normalizeProjectPath(cwd);
  const projectRoot = resolveProjectRoot(normalizedCwd);
  const suggestedEnvironmentName = suggestEnvironmentName(projectRoot);
  const link = loadProjectLinkData(normalizedCwd);

  if (explicitEnvironment) {
    return {
      cwd: normalizedCwd,
      projectRoot,
      environment: explicitEnvironment,
      environments: link?.environments ?? [],
      isLinked: Boolean(link?.environments.includes(explicitEnvironment)),
      suggestedEnvironmentName,
      projectId: link?.projectId ?? null,
    };
  }

  if (link) {
    ensureProjectRegistered(projectRoot, link);
    return {
      cwd: normalizedCwd,
      projectRoot,
      environment: link.environments[0],
      environments: link.environments,
      isLinked: true,
      suggestedEnvironmentName,
      projectId: link.projectId,
    };
  }

  return {
    cwd: normalizedCwd,
    projectRoot,
    environment: suggestedEnvironmentName,
    environments: [],
    isLinked: false,
    suggestedEnvironmentName,
    projectId: null,
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
    sameEnvironmentSet(existing.environments ?? [], link.environments)
  ) {
    return;
  }

  registerProject(normalizedPath, link, existing?.name);
}

function sameEnvironmentSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((name, index) => name === sortedRight[index]);
}

function normalizeProjectEntry(entry: ProjectEntry): ProjectEntry {
  const legacyProfile = (entry as Record<string, unknown>).profile as string | undefined;
  const legacyActiveProfile = (entry as Record<string, unknown>).activeProfile as string | undefined
    ?? (entry as Record<string, unknown>).profile as string | undefined;
  const legacyProfiles = (entry as Record<string, unknown>).profiles as string[] | undefined;

  const link = normalizeProjectLink({
    environments: entry.environments,
    profiles: entry.environments?.length ? entry.environments : legacyProfiles,
    profile: legacyProfile ?? legacyActiveProfile,
    activeProfile: legacyActiveProfile,
  });

  if (!link) {
    return {
      ...entry,
      environments: [],
      projectId: entry.projectId ?? null,
    };
  }

  return {
    ...entry,
    environments: link.environments,
    projectId: link.projectId,
  };
}

export function registerProject(
  cwd: string,
  linkOrEnvironment: ProjectLink | string,
  name?: string,
): ProjectEntry {
  const projectRoot = resolveProjectRoot(cwd);
  const normalizedPath = normalizeProjectPath(projectRoot);
  const link =
    typeof linkOrEnvironment === "string"
      ? normalizeProjectLink({ profile: linkOrEnvironment })
      : normalizeProjectLink(linkOrEnvironment);

  if (!link) {
    throw new Error("Cannot register a project without at least one environment");
  }

  const registry = loadProjectRegistry();
  const existingIndex = registry.projects.findIndex(
    (project) => project.path === normalizedPath,
  );
  const existing = existingIndex >= 0 ? registry.projects[existingIndex] : undefined;

  const entry: ProjectEntry = {
    path: normalizedPath,
    environments: link.environments,
    name: name ?? existing?.name ?? path.basename(normalizedPath),
    linkedAt: existing?.linkedAt ?? new Date().toISOString(),
    projectId: link.projectId,
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
 * Add an environment to the project's linked set.
 * Existing linked environments are preserved.
 */
export function saveProjectLink(cwd: string, environment: string, name?: string): ProjectLink {
  return addProjectEnvironment(cwd, environment, { name });
}

export function addProjectEnvironment(
  cwd: string,
  environment: string,
  options?: { name?: string },
): ProjectLink {
  const projectRoot = resolveProjectRoot(cwd);
  const existing = readProjectLinkAt(projectRoot);
  const environments = [...new Set([...(existing?.environments ?? []), environment])];
  const projectId = existing?.projectId ?? generateProjectId();

  const link: ProjectLink = {
    environments,
    projectId,
  };

  writeProjectLinkFile(projectRoot, link);
  registerProject(projectRoot, link, options?.name);
  return link;
}

/** Returns the projectId for the given project directory, reading from the link file. */
export function getProjectId(cwd: string): string | null {
  const projectRoot = resolveProjectRoot(cwd);
  const link = readProjectLinkAt(projectRoot);
  return link?.projectId ?? null;
}

/**
 * Remove one environment from the project link.
 * Returns the updated link, or null if the project became fully unlinked.
 */
export function removeProjectEnvironment(cwd: string, environment: string): ProjectLink | null {
  const linkRoot = findProjectLinkRoot(cwd);
  if (!linkRoot) {
    return null;
  }

  const existing = readProjectLinkAt(linkRoot);
  if (!existing) {
    return null;
  }

  const environments = existing.environments.filter((name) => name !== environment);
  if (environments.length === 0) {
    removeProjectLink(linkRoot);
    return null;
  }

  const link: ProjectLink = {
    environments,
    projectId: existing.projectId,
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

export type ResetResult = {
  environmentsRemoved: string[];
  linkFileDeleted: boolean;
  registryEntryRemoved: boolean;
};

/**
 * Fully reset setup for the current project:
 *   - Deletes all environment config files in the namespaced directory
 *   - Deletes the .supabase-selfhosted-cli.json link file
 *   - Removes the project from the registry
 */
export function resetProjectSetup(cwd: string): ResetResult {
  const result: ResetResult = {
    environmentsRemoved: [],
    linkFileDeleted: false,
    registryEntryRemoved: false,
  };

  const context = resolveProjectContext(cwd);
  const projectId = context.projectId;

  if (projectId) {
    const profilesDir = path.join(CONFIG_DIR, "profiles", projectId);
    if (fs.existsSync(profilesDir)) {
      for (const entry of fs.readdirSync(profilesDir)) {
        if (entry.endsWith(".json")) {
          const environment = entry.replace(/\.json$/, "");
          const filePath = path.join(profilesDir, entry);
          fs.unlinkSync(filePath);
          result.environmentsRemoved.push(environment);
        }
      }
      const remaining = fs.existsSync(profilesDir)
        ? fs.readdirSync(profilesDir).filter((e) => !e.startsWith("."))
        : [];
      if (remaining.length === 0) {
        fs.rmdirSync(profilesDir);
      }
    }
  }

  result.linkFileDeleted = removeProjectLink(cwd);
  result.registryEntryRemoved = result.linkFileDeleted || unregisterProject(cwd);

  return result;
}

/** Drop a deleted environment from every project link / registry entry. */
export function detachEnvironmentFromProjects(environment: string): void {
  const registry = loadProjectRegistry();
  const nextProjects: ProjectEntry[] = [];

  for (const entry of registry.projects) {
    const normalized = normalizeProjectEntry(entry);
    if (!normalized.environments.includes(environment)) {
      nextProjects.push(normalized);
      continue;
    }

    const nextEnvironments = normalized.environments.filter((name) => name !== environment);
    if (nextEnvironments.length === 0) {
      if (fs.existsSync(projectLinkPath(normalized.path))) {
        fs.unlinkSync(projectLinkPath(normalized.path));
      }
      continue;
    }

    const link: ProjectLink = {
      environments: nextEnvironments,
      projectId: generateProjectId(),
    };
    writeProjectLinkFile(normalized.path, link);
    nextProjects.push({
      ...normalized,
      environments: nextEnvironments,
      projectId: normalized.projectId,
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

  if (context.isLinked || context.environments.length > 0) {
    const linked = context.environments.length > 0 ? context.environments : [context.environment];
    lines.push(`Environment: ${context.environment}`);
    lines.push(
      linked.length === 1
        ? `Linked environments: ${linked[0]}`
        : `Linked environments: ${linked.join(", ")}`,
    );
  } else {
    lines.push(`Environment: (not linked — suggested: ${context.suggestedEnvironmentName})`);
    lines.push("Linked environments: (none)");
  }

  return lines.join("\n");
}

export function formatLinkedEnvironmentsLabel(context: ProjectContext): string {
  if (!context.isLinked && context.environments.length === 0) {
    return "(not linked — run Setup or Projects)";
  }

  if (context.environments.length <= 1) {
    return context.environments[0];
  }

  return context.environments.join(", ");
}

export function formatEnvironmentTargetSummary(
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
    `Environment: ${config.environment}`,
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
    `Prune after deploy: ${config.deploy.pruneAfterDeploy ? "yes" : "no"}`,
    `Restart command: ${config.deploy.restartCommand || "(not set)"}`,
  );

  return lines.join("\n");
}
