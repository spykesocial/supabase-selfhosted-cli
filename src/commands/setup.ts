import path from "node:path";
import {
  confirmPrompt,
  inputPrompt,
  numberPrompt,
  passwordPrompt,
  selectPrompt,
  withBack,
  type Backable,
} from "../lib/prompts.js";
import {
  formatConfigSummary,
  loadConfig,
  resolveProjectContext,
  saveConfig,
  saveProjectLink,
  type DeployTarget,
  type SupabaseSelfhostedConfig,
} from "../lib/config.js";
import { promptEnvironmentName } from "../lib/environment-prompt.js";
import { findSupabaseProjectRoot } from "../lib/paths.js";
import {
  buildProjectScopedRestartCommand,
  isUnsafeGlobalRestartCommand,
  UNSAFE_GLOBAL_EDGE_RESTART,
} from "../lib/restart-command.js";
import {
  logInfo,
  logSuccess,
  logWarning,
  printSection,
  printSummaryBlock,
  showBrandBanner,
} from "../lib/ui.js";

const BACK = Symbol("back");

function defaultRestartCommand(functionsPath: string): string {
  return (
    buildProjectScopedRestartCommand(functionsPath) ?? UNSAFE_GLOBAL_EDGE_RESTART
  );
}

async function promptSecret(options: {
  label: string;
  existing?: string;
}): Promise<Backable<string>> {
  if (options.existing) {
    const keep = await withBack(() =>
      confirmPrompt({
        message: `Keep existing ${options.label}?`,
        default: true,
      }),
    );
    if (keep.kind === "back") {
      return keep;
    }
    if (keep.value) {
      return { kind: "value", value: options.existing };
    }
  }

  const value = await withBack(() =>
    passwordPrompt({
      message: options.label,
      mask: "*",
      validate: (value) => (value ? true : "Password is required"),
    }),
  );
  if (value.kind === "back") {
    return value;
  }
  return { kind: "value", value: value.value };
}

type Answers = Record<string, unknown>;

type Field = {
  name: string;
  section?: string;
  skip?: (answers: Answers) => boolean;
  prompt: (answers: Answers) => Promise<Backable<unknown>>;
};

export async function runSetup(options?: {
  environment?: string;
  linkProject?: boolean;
  forceUpdate?: boolean;
}): Promise<SupabaseSelfhostedConfig | null> {
  const cwd = process.cwd();
  const context = resolveProjectContext(cwd, options?.environment);

  let environment = options?.environment;
  if (!environment) {
    console.log(showBrandBanner());
    const picked = await promptEnvironmentName({
      message: "Which environment are you setting up?",
      defaultName: "development",
      allowCancel: true,
      suggestedCustomName: context.suggestedEnvironmentName,
      projectId: context.projectId,
    });
    if (picked.kind === "cancel" || picked.kind === "existing") {
      logWarning("Setup cancelled.");
      return null;
    }
    environment = picked.name;
  }

  const existing = context.projectId
    ? loadConfig(environment, context.projectId)
    : null;

  if (existing && !options?.forceUpdate) {
    const overwrite = await withBack(() =>
      confirmPrompt({
        message: `Environment "${environment}" already exists. Overwrite it?`,
        default: false,
      }),
    );
    if (overwrite.kind === "back" || !overwrite.value) {
      logWarning("Setup cancelled.");
      return existing;
    }
  }

  if (options?.environment) {
    console.log(showBrandBanner());
  }
  logInfo(`Setting up environment "${environment}" for ${path.basename(context.projectRoot)}`);
  logInfo("These settings are stored locally in ~/.supabase-selfhosted-cli/");
  logInfo("Press Esc at any prompt to go back a step.");
  console.log("");

  const projectRoot = findSupabaseProjectRoot(cwd);
  const fields: Field[] = [
    {
      name: "target",
      section: "Supabase instance",
      prompt: async () => {
        const result = await withBack(() =>
          selectPrompt<DeployTarget | typeof BACK>({
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
              { name: "Back", value: BACK },
            ],
            default: existing?.target ?? "ssh",
          }),
        );
        if (result.kind === "back") {
          return result;
        }
        if (result.value === BACK) {
          return { kind: "back" };
        }
        return { kind: "value", value: result.value };
      },
    },
    {
      name: "sshUser",
      skip: (answers) => answers.target !== "ssh",
      prompt: async () =>
        withBack(() =>
          inputPrompt({
            message: "SSH user",
            default: existing?.ssh.user ?? "root",
          }),
        ),
    },
    {
      name: "sshHost",
      skip: (answers) => answers.target !== "ssh",
      prompt: async () =>
        withBack(() =>
          inputPrompt({
            message: "Server IP address or hostname",
            default: existing?.ssh.host ?? "",
            validate: (value) => (value.trim() ? true : "Host is required"),
          }),
        ),
    },
    {
      name: "sshPassword",
      skip: (answers) => answers.target !== "ssh",
      prompt: async () =>
        promptSecret({
          label: "SSH password (stored locally on this machine)",
          existing: existing?.ssh.password,
        }),
    },
    {
      name: "functionsRemotePath",
      prompt: async (answers) =>
        withBack(() =>
          inputPrompt({
            message:
              answers.target === "local"
                ? "Edge functions volume path on this machine (absolute path to Docker volume mount)"
                : "Remote edge functions path on the server",
            default:
              existing?.functions.remotePath ??
              (answers.target === "local"
                ? path.resolve(cwd, "volumes/functions")
                : "/etc/supabase/volumes/functions"),
            validate: (value) => (value.trim() ? true : "Functions path is required"),
          }),
        ),
    },
    {
      name: "functionsLocalPath",
      prompt: async () =>
        withBack(() =>
          inputPrompt({
            message: "Local functions folder (relative to project root or absolute)",
            default: projectRoot
              ? "supabase/functions"
              : existing?.functions.localPath ?? "supabase/functions",
            validate: (value) => (value.trim() ? true : "Local path is required"),
          }),
        ),
    },
    {
      name: "tenantId",
      section: "Database connection",
      prompt: async () =>
        withBack(() =>
          inputPrompt({
            message: "Postgres tenant id (the part after postgres.)",
            default: existing?.database.tenantId ?? "your-tenant-id",
            validate: (value) => (value.trim() ? true : "Tenant id is required"),
          }),
        ),
    },
    {
      name: "dbPassword",
      prompt: async () =>
        promptSecret({
          label: "Database password",
          existing: existing?.database.password,
        }),
    },
    {
      name: "dbHost",
      prompt: async (answers) =>
        withBack(() =>
          inputPrompt({
            message: "Database host",
            default:
              answers.target === "local"
                ? "127.0.0.1"
                : existing?.database.host ?? String(answers.sshHost ?? "").trim(),
            validate: (value) => (value.trim() ? true : "Database host is required"),
          }),
        ),
    },
    {
      name: "pushPort",
      prompt: async (answers) =>
        withBack(() =>
          numberPrompt({
            message: "Database port for migrations (supabase db push)",
            default:
              answers.target === "local"
                ? 5432
                : existing?.database.pushPort ?? 5453,
            min: 1,
            max: 65535,
          }),
        ),
    },
    {
      name: "typesPort",
      prompt: async (answers) =>
        withBack(() =>
          numberPrompt({
            message: "Database port for type generation (supabase gen types)",
            default:
              answers.target === "local"
                ? 5432
                : existing?.database.typesPort ?? 6438,
            min: 1,
            max: 65535,
          }),
        ),
    },
    {
      name: "restartAfterDeploy",
      section: "Deploy options",
      prompt: async () =>
        withBack(() =>
          confirmPrompt({
            message: "Restart Supabase after deploying functions by default?",
            default: existing?.deploy.restartAfterDeploy ?? true,
          }),
        ),
    },
    {
      name: "pruneAfterDeploy",
      prompt: async () =>
        withBack(() =>
          confirmPrompt({
            message:
              "Prune removed functions by default? (Deletes destination files not present locally)",
            default: existing?.deploy.pruneAfterDeploy ?? false,
          }),
        ),
    },
    {
      name: "restartCommand",
      skip: (answers) => answers.restartAfterDeploy !== true,
      prompt: async (answers) => {
        const functionsPath = String(answers.functionsRemotePath ?? "").trim();
        const suggestedDefault = defaultRestartCommand(functionsPath);
        let fallback = (existing?.deploy.restartCommand ?? "").trim() || suggestedDefault;

        if (
          fallback === (existing?.deploy.restartCommand ?? "").trim() &&
          isUnsafeGlobalRestartCommand(fallback) &&
          buildProjectScopedRestartCommand(functionsPath)
        ) {
          logWarning(
            "Existing restart command matches any edge container on the host. Suggesting a project-scoped command instead.",
          );
          fallback = suggestedDefault;
        }

        const restartPrompt =
          answers.target === "local"
            ? "Restart command to run locally after deploy"
            : "Restart command to run over SSH after deploy";

        const result = await withBack(() =>
          inputPrompt({
            message: restartPrompt,
            default: fallback,
            validate: (value) => (value.trim() ? true : "Restart command is required"),
          }),
        );
        if (result.kind === "back") {
          return result;
        }

        const command = result.value.trim();
        if (isUnsafeGlobalRestartCommand(command)) {
          logWarning(
            "This restart command restarts the first edge container on the host. With multiple Supabase projects, that can hit the wrong stack.",
          );
        }
        return { kind: "value", value: command };
      },
    },
    {
      name: "linkProject",
      skip: () => options?.linkProject !== undefined,
      prompt: async () => {
        const alreadyLinked = context.environments.includes(environment);
        const message = alreadyLinked
          ? `Keep "${environment}" linked to this project?`
          : context.isLinked
            ? `Add "${environment}" to this project's environments?`
            : `Link this project to environment "${environment}" (.supabase-selfhosted-cli.json)?`;

        return withBack(() =>
          confirmPrompt({
            message,
            default: true,
          }),
        );
      },
    },
  ];

  const answers: Answers = {};

  let step = 0;
  let lastSection = "";
  while (step < fields.length) {
    const field = fields[step];

    if (field.skip?.(answers)) {
      step += 1;
      continue;
    }

    if (field.section && field.section !== lastSection) {
      printSection(field.section);
      console.log("");
      lastSection = field.section;
    }

    const result = await field.prompt(answers);

    if (result.kind === "back") {
      step = previousStepIndex(fields, step, answers);
      if (step < 0) {
        logWarning("Setup cancelled.");
        return null;
      }
      lastSection = "";
      continue;
    }

    answers[field.name] = result.value;
    step += 1;
  }

  const target = (answers.target as DeployTarget) ?? existing?.target ?? "ssh";
  const now = new Date().toISOString();
  const defaultPushPort = target === "local" ? 5432 : 5453;
  const defaultTypesPort = target === "local" ? 5432 : 6438;

  const config: SupabaseSelfhostedConfig = {
    environment,
    target,
    ssh: {
      user: String(answers.sshUser ?? existing?.ssh.user ?? "root").trim(),
      host: String(answers.sshHost ?? existing?.ssh.host ?? "").trim(),
      password: String(answers.sshPassword ?? existing?.ssh.password ?? ""),
    },
    functions: {
      localPath: String(answers.functionsLocalPath ?? "").trim(),
      remotePath: String(answers.functionsRemotePath ?? "").trim(),
    },
    database: {
      tenantId: String(answers.tenantId ?? "").trim(),
      password: String(answers.dbPassword ?? ""),
      host: String(answers.dbHost ?? "").trim(),
      pushPort: (answers.pushPort as number | undefined) ?? defaultPushPort,
      typesPort: (answers.typesPort as number | undefined) ?? defaultTypesPort,
      database: "postgres",
    },
    deploy: {
      restartAfterDeploy: (answers.restartAfterDeploy as boolean) ?? existing?.deploy.restartAfterDeploy ?? true,
      restartCommand: String(answers.restartCommand ?? "").trim(),
      pruneAfterDeploy: (answers.pruneAfterDeploy as boolean) ?? existing?.deploy.pruneAfterDeploy ?? false,
    },
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const linkProject = options?.linkProject ?? (answers.linkProject as boolean | undefined) ?? true;

  if (linkProject) {
    const link = saveProjectLink(cwd, environment, path.basename(context.projectRoot));
    saveConfig(config, link.projectId);
    const next = resolveProjectContext(cwd);
    const linkedLabel = next.environments.join(", ");
    logSuccess(
      next.environments.length > 1
        ? `Environment "${environment}" configured. Linked environments: ${linkedLabel}.`
        : `Linked ${context.projectRoot} to environment "${environment}".`,
    );
  } else {
    saveConfig(config, context.projectId);
  }

  printSummaryBlock("Setup complete", ...formatConfigSummary(config).split("\n"));

  return config;
}

function previousStepIndex(fields: Field[], from: number, answers: Answers): number {
  for (let index = from - 1; index >= 0; index -= 1) {
    if (!fields[index].skip?.(answers)) {
      return index;
    }
  }
  return -1;
}
