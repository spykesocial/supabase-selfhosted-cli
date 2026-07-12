import type { SupabaseSelfhostedConfig } from "./config.js";

/** Known unsafe default: restarts the first edge container on the host, any project. */
export const UNSAFE_GLOBAL_EDGE_RESTART =
  "docker ps --format '{{.Names}}' | grep -i edge | head -n 1 | xargs -I{} docker restart {}";

const UNSAFE_PATTERNS = [
  /^docker\s+ps\b[\s\S]*\|\s*grep\s+-i\s+edge[\s\S]*\|\s*head\s+-n\s+1[\s\S]*docker\s+restart\b/i,
];

/**
 * Extract a compose/stack project id from a functions volume path.
 * Dokploy: /etc/dokploy/compose/<project-id>/files/volumes/functions
 * Generic: .../compose/<project-id>/.../functions
 */
export function extractComposeProjectId(functionsPath: string): string | null {
  const normalized = functionsPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const dokploy = normalized.match(/\/compose\/([^/]+)\//i);
  if (dokploy?.[1] && isSafeProjectToken(dokploy[1])) {
    return dokploy[1];
  }

  // .../<project-id>/volumes/functions or .../<project-id>/files/volumes/functions
  const volumeParent = normalized.match(
    /\/([^/]+)\/(?:files\/)?volumes\/functions$/i,
  );
  if (volumeParent?.[1] && isSafeProjectToken(volumeParent[1])) {
    // Avoid overly generic parent folders
    if (!["etc", "var", "opt", "home", "supabase", "data"].includes(volumeParent[1])) {
      return volumeParent[1];
    }
  }

  return null;
}

function isSafeProjectToken(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value);
}

export function isUnsafeGlobalRestartCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) {
    return false;
  }

  if (trimmed === UNSAFE_GLOBAL_EDGE_RESTART) {
    return true;
  }

  return UNSAFE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * Build a restart command that only targets containers belonging to this
 * compose/stack project (matched via the functions destination path).
 */
export function buildProjectScopedRestartCommand(functionsPath: string): string | null {
  const projectId = extractComposeProjectId(functionsPath);
  if (!projectId) {
    return null;
  }

  // Fail closed if no container matches this project — never fall back to another stack.
  return [
    `name=$(docker ps --format '{{.Names}}' | grep -F '${projectId}' | grep -iE 'edge|functions' | head -n 1)`,
    `[ -n "$name" ] || { echo "No edge-functions container matched project '${projectId}'" >&2; exit 1; }`,
    `echo "Restarting $name"`,
    `docker restart "$name"`,
  ].join("; ");
}

export type ResolvedRestartCommand = {
  command: string;
  projectId: string | null;
  autoScoped: boolean;
};

/**
 * Resolve the restart command for a profile.
 * Unsafe host-wide "first edge container" defaults are replaced with a
 * project-scoped command derived from functions.remotePath when possible.
 */
export function resolveRestartCommand(
  config: SupabaseSelfhostedConfig,
): ResolvedRestartCommand {
  const configured = config.deploy.restartCommand.trim();
  const projectId = extractComposeProjectId(config.functions.remotePath);
  const scoped = buildProjectScopedRestartCommand(config.functions.remotePath);

  if (!configured) {
    if (!scoped) {
      throw new Error(
        "Restart command is not configured. Run `supabase-selfhosted-cli setup` to set it.",
      );
    }
    return { command: scoped, projectId, autoScoped: true };
  }

  if (isUnsafeGlobalRestartCommand(configured)) {
    if (!scoped) {
      throw new Error(
        [
          "Restart command matches every edge container on the host (unsafe with multiple projects).",
          "Re-run `supabase-selfhosted-cli setup` / `projects --edit` and set a project-scoped restart command,",
          "or use a functions path that includes the compose project id (e.g. /etc/dokploy/compose/<project>/...).",
        ].join(" "),
      );
    }
    return { command: scoped, projectId, autoScoped: true };
  }

  return { command: configured, projectId, autoScoped: false };
}

/** Persist an auto-scoped restart command back into the profile. */
export function persistScopedRestartCommand(
  config: SupabaseSelfhostedConfig,
  command: string,
): SupabaseSelfhostedConfig {
  const updated: SupabaseSelfhostedConfig = {
    ...config,
    deploy: {
      ...config.deploy,
      restartCommand: command,
    },
    updatedAt: new Date().toISOString(),
  };
  return updated;
}
