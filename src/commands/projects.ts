import path from "node:path";
import { confirm, select } from "@inquirer/prompts";
import {
  addProjectEnvironment,
  deleteConfig,
  formatConfigSummary,
  formatEnvironmentTargetSummary,
  formatLinkedEnvironmentsLabel,
  formatProjectContextSummary,
  listEnvironments,
  listRegisteredProjects,
  loadConfig,
  removeProjectEnvironment,
  removeProjectLink,
  resolveProjectContext,
  type ProjectEntry,
} from "../lib/config.js";
import { promptEnvironmentName } from "../lib/environment-prompt.js";
import {
  logError,
  logInfo,
  logReview,
  logSuccess,
  logWarning,
  paint,
  printSummaryBlock,
} from "../lib/ui.js";
import { runSetup } from "./setup.js";

function formatProjectRow(entry: ProjectEntry): string {
  const environments = entry.environments?.length ? entry.environments : [];
  const firstEnv = environments[0];
  const config = loadConfig(firstEnv, entry.projectId);
  const target = config ? formatEnvironmentTargetSummary(config) : "(environment missing)";
  const envLabel =
    environments.length === 1
      ? firstEnv
      : environments.join(", ");
  return `${entry.name} → ${envLabel} · ${target}`;
}

function environmentChoiceLabel(name: string, projectId?: string | null): string {
  const config = loadConfig(name, projectId);
  const target = config ? formatEnvironmentTargetSummary(config) : "missing credentials";
  return `${name}  ·  ${target}`;
}

function printProjectsList(): void {
  const registered = listRegisteredProjects();
  const environments = listEnvironments();
  const cwd = process.cwd();
  const context = resolveProjectContext(cwd);

  printSummaryBlock("Current directory", ...formatProjectContextSummary(context).split("\n"));

  if (registered.length === 0) {
    logReview("No linked projects yet. Link this directory from the menu below.");
    console.log("");
  } else {
    console.log(paint("Linked projects", "blue"));
    for (const entry of registered) {
      const marker = entry.path === context.projectRoot ? " (here)" : "";
      console.log(`  • ${formatProjectRow(entry)}${marker}`);
      console.log(`    ${entry.path}`);
    }
    console.log("");
  }

  const linkedNames = new Set(
    registered.flatMap((entry) => entry.environments),
  );
  const orphanEnvironments = environments.filter((environment) => !linkedNames.has(environment));

  if (orphanEnvironments.length > 0) {
    console.log(paint("Environments not linked to any project", "blue"));
    for (const environment of orphanEnvironments) {
      const config = loadConfig(environment);
      const target = config ? formatEnvironmentTargetSummary(config) : "(missing config)";
      console.log(`  • ${environment} (${target})`);
    }
    console.log("");
  }
}

async function linkOrSetupEnvironment(
  cwd: string,
  environmentName: string,
  context: ReturnType<typeof resolveProjectContext>,
): Promise<void> {
  if (context.environments.includes(environmentName)) {
    logWarning(`"${environmentName}" is already linked to this project.`);
    return;
  }

  if (loadConfig(environmentName, context.projectId)) {
    addProjectEnvironment(cwd, environmentName);
    const next = resolveProjectContext(cwd);
    logSuccess(`Linked "${environmentName}".`);
    logReview(`Environments: ${formatLinkedEnvironmentsLabel(next)}`);
    return;
  }

  await runSetup({
    environment: environmentName,
    linkProject: true,
  });
}

async function linkCurrentDirectory(): Promise<void> {
  const cwd = process.cwd();
  const context = resolveProjectContext(cwd);
  const environments = listEnvironments();
  const linked = new Set(context.environments);

  logInfo(
    context.isLinked
      ? `Adding another environment to ${path.basename(context.projectRoot)}.`
      : `Link ${path.basename(context.projectRoot)} to an environment.`,
  );

  const availableExisting = environments.filter(
    (name) => !linked.has(name) && name !== "development" && name !== "production",
  );

  const defaultName = !linked.has("development")
    ? "development"
    : !linked.has("production")
      ? "production"
      : "development";

  const pick = await promptEnvironmentName({
    message: context.isLinked
      ? "Which environment do you want to add?"
      : "Which environment do you want to link?",
    defaultName,
    allowCancel: true,
    offerExisting: availableExisting.length > 0,
    suggestedCustomName: context.suggestedEnvironmentName,
    projectId: context.projectId,
  });

  if (pick.kind === "cancel") {
    return;
  }

  if (pick.kind === "existing") {
    const environment = await select({
      message: "Choose an environment to add",
      choices: availableExisting.map((name) => ({
        name: environmentChoiceLabel(name, context.projectId),
        value: name,
      })),
    });
    await linkOrSetupEnvironment(cwd, environment, context);
    return;
  }

  await linkOrSetupEnvironment(cwd, pick.name, context);
}

async function editEnvironment(): Promise<void> {
  const cwd = process.cwd();
  const context = resolveProjectContext(cwd);
  const environments = listEnvironments();

  const environment =
    environments.length === 0
      ? context.suggestedEnvironmentName
      : await select({
          message: "Edit which environment?",
          choices: environments.map((name) => ({
            name: environmentChoiceLabel(name, context.projectId),
            value: name,
          })),
          default: context.environment,
        });

  await runSetup({ environment, linkProject: true, forceUpdate: true });
}

async function deleteEnvironment(): Promise<void> {
  const environments = listEnvironments();

  if (environments.length === 0) {
    logError("No environments to delete.");
    process.exitCode = 1;
    return;
  }

  const environment = await select({
    message: "Delete which environment? (removes stored passwords)",
    choices: environments.map((name) => ({ name, value: name })),
  });

  const confirmed = await confirm({
    message: `Delete environment "${environment}" and remove stored passwords?`,
    default: false,
  });

  if (!confirmed) {
    logWarning("Cancelled.");
    return;
  }

  deleteConfig(environment);
  logSuccess(`Deleted environment "${environment}".`);

  const remaining = listEnvironments();
  if (remaining.length === 0) {
    logReview("No environments remain. Run `supabase-selfhosted-cli setup` to configure again.");
  }
}

async function unlinkCurrentDirectory(): Promise<void> {
  const cwd = process.cwd();
  const context = resolveProjectContext(cwd);

  if (!context.isLinked || context.environments.length === 0) {
    logWarning("This directory is not linked to any environment.");
    return;
  }

  if (context.environments.length === 1) {
    const environment = context.environments[0];
    const confirmed = await confirm({
      message: `Unlink ${path.basename(context.projectRoot)} from "${environment}"? (credentials kept)`,
      default: false,
    });

    if (!confirmed) {
      logWarning("Cancelled.");
      return;
    }

    removeProjectLink(cwd);
    logSuccess(`Unlinked ${context.projectRoot}. Environment "${environment}" was kept.`);
    return;
  }

  const mode = await select({
    message: "Unlink",
    choices: [
      { name: "Remove one environment from this project", value: "one" },
      { name: "Unlink all environments from this project", value: "all" },
      { name: "Cancel", value: "cancel" },
    ],
  });

  if (mode === "cancel") {
    return;
  }

  if (mode === "all") {
    const confirmed = await confirm({
      message: `Unlink all environments (${context.environments.join(", ")})? Credentials stay on disk.`,
      default: false,
    });
    if (!confirmed) {
      logWarning("Cancelled.");
      return;
    }

    removeProjectLink(cwd);
    logSuccess(`Unlinked ${context.projectRoot}. Environments were kept.`);
    return;
  }

  const environment = await select({
    message: "Remove which environment from this project?",
    choices: context.environments.map((name) => ({
      name: environmentChoiceLabel(name),
      value: name,
    })),
  });

  const confirmed = await confirm({
    message: `Remove "${environment}" from this project? (credentials kept)`,
    default: false,
  });

  if (!confirmed) {
    logWarning("Cancelled.");
    return;
  }

  const next = removeProjectEnvironment(cwd, environment);
  if (!next) {
    logSuccess(`Removed "${environment}" and unlinked the project (no environments left).`);
    return;
  }

  logSuccess(`Removed "${environment}" from this project.`);
  logReview(
    `Linked: ${next.environments.join(", ")}`,
  );
}

async function showEnvironmentDetails(): Promise<void> {
  const cwd = process.cwd();
  const context = resolveProjectContext(cwd);

  if (!context.isLinked && context.environments.length === 0) {
    logError("No environment linked. Run setup or add an environment for this directory.");
    process.exitCode = 1;
    return;
  }

  let environment = context.environment;
  if (context.environments.length > 1) {
    environment = await select({
      message: "Show details for which environment?",
      choices: context.environments.map((name) => ({
        name: environmentChoiceLabel(name, context.projectId),
        value: name,
      })),
      default: environment,
    });
  }

  const config = loadConfig(environment, context.projectId);
  if (!config) {
    logError(
      `Environment "${environment}" is linked but missing. Run setup to recreate it.`,
    );
    process.exitCode = 1;
    return;
  }

  printSummaryBlock(
    "Environment details",
    ...formatProjectContextSummary(context).split("\n"),
    "",
    ...formatConfigSummary(config).split("\n"),
  );
}

export async function runProjects(options?: {
  list?: boolean;
  link?: boolean;
  edit?: boolean;
  delete?: boolean;
  unlink?: boolean;
  show?: boolean;
  environment?: string;
}): Promise<void> {
  if (options?.list) {
    printProjectsList();
    return;
  }

  if (options?.link) {
    await linkCurrentDirectory();
    return;
  }

  if (options?.edit) {
    await editEnvironment();
    return;
  }

  if (options?.delete) {
    await deleteEnvironment();
    return;
  }

  if (options?.unlink) {
    await unlinkCurrentDirectory();
    return;
  }

  if (options?.show) {
    await showEnvironmentDetails();
    return;
  }

  const context = resolveProjectContext(process.cwd());
  if (context.isLinked) {
    logInfo(
      `${path.basename(context.projectRoot)}  ·  ${formatLinkedEnvironmentsLabel(context)}`,
    );
  }

  const action = await select({
    message: "Projects",
    choices: [
      { name: "List linked projects and environments", value: "list" },
      {
        name: context.isLinked
          ? "Add another environment (e.g. production)"
          : "Link this directory to an environment",
        value: "link",
      },
      { name: "Show environment details", value: "show" },
      { name: "Edit environment credentials", value: "edit" },
      {
        name: context.environments.length > 1
          ? "Unlink an environment (or all)"
          : "Unlink this directory (keep environment)",
        value: "unlink",
      },
      { name: "Delete a stored environment", value: "delete" },
      { name: "Cancel", value: "cancel" },
    ],
  });

  if (action === "cancel") {
    return;
  }

  switch (action) {
    case "list":
      await runProjects({ list: true, environment: options?.environment });
      break;
    case "link":
      await runProjects({ link: true, environment: options?.environment });
      break;
    case "show":
      await runProjects({ show: true, environment: options?.environment });
      break;
    case "edit":
      await runProjects({ edit: true, environment: options?.environment });
      break;
    case "unlink":
      await runProjects({ unlink: true, environment: options?.environment });
      break;
    case "delete":
      await runProjects({ delete: true, environment: options?.environment });
      break;
    default:
      break;
  }
}
