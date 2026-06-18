import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const CONFIG_DIR = path.join(os.homedir(), ".supabase-selfhosted-cli");
export const DEFAULT_PROFILE = "default";

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

function profilePath(profile: string): string {
  return path.join(CONFIG_DIR, "profiles", `${profile}.json`);
}

function projectLinkPath(cwd: string): string {
  return path.join(cwd, ".supabase-selfhosted-cli.json");
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

export function resolveProfile(cwd: string, explicitProfile?: string): string {
  if (explicitProfile) {
    return explicitProfile;
  }

  const linkPath = projectLinkPath(cwd);
  if (fs.existsSync(linkPath)) {
    const link = JSON.parse(fs.readFileSync(linkPath, "utf8")) as ProjectLink;
    return link.profile;
  }

  return DEFAULT_PROFILE;
}

export function saveProjectLink(cwd: string, profile: string): void {
  const linkPath = projectLinkPath(cwd);
  const link: ProjectLink = { profile };
  fs.writeFileSync(linkPath, `${JSON.stringify(link, null, 2)}\n`);
}

export function buildDbUrl(
  config: SupabaseSelfhostedConfig,
  kind: "push" | "types",
): string {
  const { tenantId, password, host, pushPort, typesPort, database } = config.database;
  const port = kind === "push" ? pushPort : typesPort;
  const encodedPassword = encodeURIComponent(password);
  return `postgresql://postgres.${tenantId}:${encodedPassword}@${host}:${port}/${database}`;
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
