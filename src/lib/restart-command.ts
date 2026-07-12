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
 *
 * Note: Dokploy folder ids can differ from Docker container name ids.
 * Prefer mount-path matching for restarts; this is mainly for logging.
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

function escapeSingleQuotedShell(value: string): string {
  return value.replace(/'/g, `'\\''`);
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

/** True for CLI-generated restart commands (old name-grep or mount-based). */
export function isGeneratedRestartCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) {
    return false;
  }

  if (isUnsafeGlobalRestartCommand(trimmed)) {
    return true;
  }

  // Current mount-path discovery
  if (trimmed.includes("No edge-functions container mounts functions path:")) {
    return true;
  }

  // Previous name-based discovery (Dokploy folder id ≠ container name id)
  if (trimmed.includes("No edge-functions container matched project")) {
    return true;
  }

  if (/grep -F '[^']+' \| grep -iE 'edge\|functions'/.test(trimmed)) {
    return true;
  }

  return false;
}

/**
 * Build a restart command that finds the edge-functions container which
 * mounts this profile's functions path. This is required on Dokploy where
 * the compose directory id can differ from the Docker Compose project name
 * embedded in container names.
 */
export function buildProjectScopedRestartCommand(functionsPath: string): string | null {
  const normalized = functionsPath.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized.startsWith("/")) {
    return null;
  }

  const escaped = escapeSingleQuotedShell(normalized);

  // Fail closed if nothing mounts this exact path — never restart another stack.
  return [
    `path='${escaped}'`,
    `name=$(docker ps --format '{{.Names}}' | grep -iE 'edge|functions' | while read -r n; do docker inspect "$n" --format '{{range .Mounts}}{{.Source}}{{println}}{{end}}' 2>/dev/null | grep -qxF "$path" && printf '%s\\n' "$n" && break; done)`,
    `[ -n "$name" ] || { echo "No edge-functions container mounts functions path: $path" >&2; exit 1; }`,
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
 * Host-wide and previously generated name-grep commands are replaced with
 * mount-path discovery derived from functions.remotePath.
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

  if (isGeneratedRestartCommand(configured)) {
    if (!scoped) {
      throw new Error(
        [
          "Restart command is not project-safe for multi-stack hosts.",
          "Re-run `supabase-selfhosted-cli setup` / `projects --edit` and set an absolute functions path",
          "(e.g. /etc/dokploy/compose/<project>/files/volumes/functions).",
        ].join(" "),
      );
    }

    // Upgrade old generated commands to the latest mount-based form.
    if (configured !== scoped) {
      return { command: scoped, projectId, autoScoped: true };
    }

    return { command: scoped, projectId, autoScoped: false };
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
