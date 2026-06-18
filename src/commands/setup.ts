import path from "node:path";
import {
  confirm,
  input,
  number,
  password,
  select,
} from "@inquirer/prompts";
import {
  DEFAULT_PROFILE,
  formatConfigSummary,
  loadConfig,
  saveConfig,
  saveProjectLink,
  type DeployTarget,
  type SupabaseSelfhostedConfig,
} from "../lib/config.js";
import { findSupabaseProjectRoot } from "../lib/paths.js";
import {
  logInfo,
  logSuccess,
  logWarning,
  printSummaryBlock,
  showBrandBanner,
} from "../lib/ui.js";

async function promptSecretWithRetention(options: {
  label: string;
  existing?: string;
}): Promise<string> {
  if (options.existing) {
    const keepExisting = await confirm({
      message: `Keep existing ${options.label}?`,
      default: true,
    });

    if (keepExisting) {
      return options.existing;
    }
  }

  return password({
    message: options.label,
    mask: "*",
    validate: (value) => (value ? true : "Password is required"),
  });
}

const LOCAL_RESTART_DEFAULT =
  "docker ps --format '{{.Names}}' | grep -i edge | head -n 1 | xargs -I{} docker restart {}";

const REMOTE_RESTART_DEFAULT =
  "docker ps --format '{{.Names}}' | grep -i edge | head -n 1 | xargs -I{} docker restart {}";

export async function runSetup(options?: {
  profile?: string;
  linkProject?: boolean;
  forceUpdate?: boolean;
}): Promise<SupabaseSelfhostedConfig> {
  const cwd = process.cwd();
  const profile = options?.profile ?? DEFAULT_PROFILE;
  const existing = loadConfig(profile);

  if (existing && !options?.forceUpdate) {
    const overwrite = await confirm({
      message: `Profile "${profile}" already exists. Overwrite it?`,
      default: false,
    });

    if (!overwrite) {
      logWarning("Setup cancelled.");
      return existing;
    }
  }

  console.log(showBrandBanner());
  logInfo("These settings are stored locally in ~/.supabase-selfhosted-cli/");
  console.log("");

  const target = await select<DeployTarget>({
    message: "Where is your Supabase instance running?",
    choices: [
      {
        name: "Local machine (Docker / Docker Compose on this computer)",
        value: "local",
      },
      {
        name: "Remote server (VPS, cloud VM, etc. over SSH)",
        value: "ssh",
      },
    ],
    default: existing?.target ?? "ssh",
  });

  let sshUser = existing?.ssh.user ?? "root";
  let sshHost = existing?.ssh.host ?? "";
  let sshPassword = existing?.ssh.password ?? "";

  if (target === "ssh") {
    sshUser = await input({
      message: "SSH user",
      default: sshUser,
    });

    sshHost = await input({
      message: "Server IP address or hostname",
      default: sshHost,
      validate: (value) => (value.trim() ? true : "Host is required"),
    });

    sshPassword = await promptSecretWithRetention({
      label: "SSH password (stored locally on this machine)",
      existing: existing?.ssh.password,
    });
  }

  const functionsPathPrompt =
    target === "local"
      ? "Edge functions volume path on this machine (absolute path to Docker volume mount)"
      : "Remote edge functions path on the server";

  const defaultFunctionsPath =
    existing?.functions.remotePath ??
    (target === "local"
      ? path.resolve(cwd, "volumes/functions")
      : "/etc/supabase/volumes/functions");

  const functionsDestinationPath = await input({
    message: functionsPathPrompt,
    default: defaultFunctionsPath,
    validate: (value) => (value.trim() ? true : "Functions path is required"),
  });

  const projectRoot = findSupabaseProjectRoot(cwd);
  const defaultLocalPath = projectRoot
    ? "supabase/functions"
    : existing?.functions.localPath ?? "supabase/functions";

  const localFunctionsPath = await input({
    message: "Local functions folder (relative to project root or absolute)",
    default: defaultLocalPath,
    validate: (value) => (value.trim() ? true : "Local path is required"),
  });

  logInfo("Database connection (for migrations and type generation)");
  console.log("");

  const tenantId = await input({
    message: "Postgres tenant id (the part after postgres.)",
    default: existing?.database.tenantId ?? "your-tenant-id",
    validate: (value) => (value.trim() ? true : "Tenant id is required"),
  });

  const dbPassword = await promptSecretWithRetention({
    label: "Database password",
    existing: existing?.database.password,
  });

  const defaultDbHost =
    target === "local" ? "127.0.0.1" : (existing?.database.host ?? sshHost.trim());

  const dbHost = await input({
    message: "Database host",
    default: defaultDbHost,
    validate: (value) => (value.trim() ? true : "Database host is required"),
  });

  const defaultPushPort = target === "local" ? 5432 : (existing?.database.pushPort ?? 5453);
  const defaultTypesPort = target === "local" ? 5432 : (existing?.database.typesPort ?? 6438);

  const pushPort = await number({
    message: "Database port for migrations (supabase db push)",
    default: defaultPushPort,
    min: 1,
    max: 65535,
  });

  const typesPort = await number({
    message: "Database port for type generation (supabase gen types)",
    default: defaultTypesPort,
    min: 1,
    max: 65535,
  });

  logInfo("Deploy options");
  console.log("");

  const restartAfterDeploy = await confirm({
    message: "Restart Supabase after deploying functions by default?",
    default: existing?.deploy.restartAfterDeploy ?? true,
  });

  let restartCommand = existing?.deploy.restartCommand ?? "";
  if (restartAfterDeploy) {
    const restartPrompt =
      target === "local"
        ? "Restart command to run locally after deploy"
        : "Restart command to run over SSH after deploy";

    restartCommand = await input({
      message: restartPrompt,
      default:
        restartCommand ||
        (target === "local" ? LOCAL_RESTART_DEFAULT : REMOTE_RESTART_DEFAULT),
      validate: (value) => (value.trim() ? true : "Restart command is required"),
    });
  }

  const linkProject =
    options?.linkProject ??
    (await confirm({
      message: "Link this project directory to this profile (.supabase-selfhosted-cli.json)?",
      default: true,
    }));

  const now = new Date().toISOString();
  const config: SupabaseSelfhostedConfig = {
    profile,
    target,
    ssh: {
      user: sshUser.trim(),
      host: sshHost.trim(),
      password: sshPassword,
    },
    functions: {
      localPath: localFunctionsPath.trim(),
      remotePath: functionsDestinationPath.trim(),
    },
    database: {
      tenantId: tenantId.trim(),
      password: dbPassword,
      host: dbHost.trim(),
      pushPort: pushPort ?? defaultPushPort,
      typesPort: typesPort ?? defaultTypesPort,
      database: "postgres",
    },
    deploy: {
      restartAfterDeploy,
      restartCommand: restartCommand.trim(),
    },
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  saveConfig(config);

  if (linkProject) {
    saveProjectLink(cwd, profile);
    logSuccess(`Linked ${cwd} to profile "${profile}".`);
  }

  printSummaryBlock("Setup complete", ...formatConfigSummary(config).split("\n"));

  return config;
}
