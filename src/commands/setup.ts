import path from "node:path";
import {
  confirm,
  input,
  number,
  password,
  select,
} from "@inquirer/prompts";
import {
  formatConfigSummary,
  loadConfig,
  resolveProjectContext,
  saveConfig,
  saveProjectLink,
  type DeployTarget,
  type SupabaseSelfhostedConfig,
} from "../lib/config.js";
import { findSupabaseProjectRoot } from "../lib/paths.js";
import { promptEnvironmentProfileName } from "../lib/profile-prompt.js";
import {
  buildProjectScopedRestartCommand,
  isUnsafeGlobalRestartCommand,
  UNSAFE_GLOBAL_EDGE_RESTART,
} from "../lib/restart-command.js";
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

function defaultRestartCommand(functionsPath: string): string {
  return (
    buildProjectScopedRestartCommand(functionsPath) ?? UNSAFE_GLOBAL_EDGE_RESTART
  );
}

export async function runSetup(options?: {
  profile?: string;
  linkProject?: boolean;
  forceUpdate?: boolean;
}): Promise<SupabaseSelfhostedConfig | null> {
  const cwd = process.cwd();
  const context = resolveProjectContext(cwd, options?.profile);

  let profile = options?.profile;
  if (!profile) {
    console.log(showBrandBanner());
    const picked = await promptEnvironmentProfileName({
      message: "Which environment profile are you setting up?",
      defaultName: context.isLinked
        ? (context.activeProfile ?? "development")
        : "development",
      allowCancel: true,
      suggestedCustomName: context.suggestedProfileName,
    });
    if (picked.kind === "cancel" || picked.kind === "existing") {
      logWarning("Setup cancelled.");
      return null;
    }
    profile = picked.name;
  }

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

  if (options?.profile) {
    console.log(showBrandBanner());
  }
  logInfo(`Setting up profile "${profile}" for ${path.basename(context.projectRoot)}`);
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

    const suggestedDefault = defaultRestartCommand(functionsDestinationPath.trim());
    const existingIsUnsafe =
      restartCommand.trim().length > 0 &&
      isUnsafeGlobalRestartCommand(restartCommand);

    if (existingIsUnsafe && buildProjectScopedRestartCommand(functionsDestinationPath.trim())) {
      logWarning(
        "Existing restart command matches any edge container on the host. Suggesting a project-scoped command instead.",
      );
      restartCommand = suggestedDefault;
    }

    restartCommand = await input({
      message: restartPrompt,
      default: restartCommand.trim() || suggestedDefault,
      validate: (value) => (value.trim() ? true : "Restart command is required"),
    });

    if (isUnsafeGlobalRestartCommand(restartCommand)) {
      logWarning(
        "This restart command restarts the first edge container on the host. With multiple Supabase projects, that can hit the wrong stack.",
      );
    }
  }

  const alreadyLinked = context.profiles.includes(profile);
  const linkMessage = alreadyLinked
    ? `Keep "${profile}" linked to this project and set it as active?`
    : context.isLinked
      ? `Add "${profile}" to this project's environments and make it active?`
      : `Link this project to profile "${profile}" (.supabase-selfhosted-cli.json)?`;

  const linkProject =
    options?.linkProject ??
    (await confirm({
      message: linkMessage,
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
    saveProjectLink(cwd, profile, path.basename(context.projectRoot));
    const next = resolveProjectContext(cwd);
    const linkedLabel = next.profiles.join(", ");
    logSuccess(
      next.profiles.length > 1
        ? `Active profile "${profile}". Linked environments: ${linkedLabel}.`
        : `Linked ${context.projectRoot} to profile "${profile}".`,
    );
  }

  printSummaryBlock("Setup complete", ...formatConfigSummary(config).split("\n"));

  return config;
}
