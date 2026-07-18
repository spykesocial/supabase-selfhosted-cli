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

export type ProjectLink = {
  profile: string;
};

export type ProjectEntry = {
  path: string;
  profile: string;
  name: string;
  linkedAt: string;
};

export type ProjectRegistry = {
  projects: ProjectEntry[];
};

export type ProjectContext = {
  cwd: string;
  projectRoot: string;
  profile: string;
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

export function loadProjectLink(cwd: string): string | null {
  let current = normalizeProjectPath(cwd);

  while (true) {
    const linkPath = projectLinkPath(current);
    if (fs.existsSync(linkPath)) {
      const link = JSON.parse(fs.readFileSync(linkPath, "utf8")) as ProjectLink;
      return link.profile;
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
  const linkedProfile = loadProjectLink(normalizedCwd);

  if (explicitProfile) {
    return {
      cwd: normalizedCwd,
      projectRoot,
      profile: explicitProfile,
      isLinked: linkedProfile === explicitProfile,
      suggestedProfileName,
    };
  }

  if (linkedProfile) {
    ensureProjectRegistered(projectRoot, linkedProfile);
    return {
      cwd: normalizedCwd,
      projectRoot,
      profile: linkedProfile,
      isLinked: true,
      suggestedProfileName,
    };
  }

  return {
    cwd: normalizedCwd,
    projectRoot,
    profile: suggestedProfileName,
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
  return loadProjectRegistry().projects.sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

function ensureProjectRegistered(projectRoot: string, profile: string): void {
  const normalizedPath = normalizeProjectPath(projectRoot);
  const registry = loadProjectRegistry();
  if (registry.projects.some((project) => project.path === normalizedPath)) {
    return;
  }

  registerProject(normalizedPath, profile);
}

export function registerProject(
  cwd: string,
  profile: string,
  name?: string,
): ProjectEntry {
  const projectRoot = resolveProjectRoot(cwd);
  const normalizedPath = normalizeProjectPath(projectRoot);
  const entry: ProjectEntry = {
    path: normalizedPath,
    profile,
    name: name ?? path.basename(normalizedPath),
    linkedAt: new Date().toISOString(),
  };

  const registry = loadProjectRegistry();
  const existingIndex = registry.projects.findIndex(
    (project) => project.path === normalizedPath,
  );

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

export function saveProjectLink(cwd: string, profile: string, name?: string): void {
  const projectRoot = resolveProjectRoot(cwd);
  const linkPath = projectLinkPath(projectRoot);
  const link: ProjectLink = { profile };
  fs.writeFileSync(linkPath, `${JSON.stringify(link, null, 2)}\n`);
  registerProject(projectRoot, profile, name);
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

export function formatProjectContextSummary(context: ProjectContext): string {
  const projectLabel = path.basename(context.projectRoot);
  const lines = [
    `Project: ${projectLabel}`,
    `Directory: ${context.projectRoot}`,
  ];

  if (context.isLinked) {
    lines.push(`Profile: ${context.profile}`);
  } else {
    lines.push(`Profile: (not linked — suggested: ${context.suggestedProfileName})`);
  }

  return lines.join("\n");
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
