import { confirm, select } from "@inquirer/prompts";
import {
  deleteConfig,
  formatConfigSummary,
  formatProjectContextSummary,
  listEnvironments,
  loadConfig,
  resetProjectSetup,
  resolveProjectContext,
} from "../lib/config.js";
import { logError, logReview, logSuccess, logWarning, printSummaryBlock } from "../lib/ui.js";
import { runSetup } from "./setup.js";

export async function runSettings(options?: { environment?: string }): Promise<void> {
  const cwd = process.cwd();
  const context = resolveProjectContext(cwd, options?.environment);
  const environment = context.environment;
  const config = loadConfig(environment, context.projectId);

  if (!config) {
    if (!context.isLinked && !options?.environment) {
      logError(
        `This directory is not linked to an environment. Run \`supabase-selfhosted-cli projects\` to link it, or \`supabase-selfhosted-cli setup\` to create one.`,
      );
    } else {
      logError(
        `No environment "${environment}" found. Run \`supabase-selfhosted-cli setup\` first.`,
      );
    }
    process.exitCode = 1;
    return;
  }

  const action = await select({
    message: `Settings · ${environment}${context.environments.length > 1 ? ` (${context.environments.length} environments)` : ""}`,
    choices: [
      { name: "Show current configuration", value: "show" },
      { name: "Re-run setup wizard (update credentials)", value: "setup" },
      { name: "Manage environments (add / unlink)", value: "projects" },
      { name: "Delete stored credentials for this environment", value: "delete" },
      { name: "Reset setup for this project (wipe all config & unlink)", value: "reset" },
      { name: "Cancel", value: "cancel" },
    ],
  });

  if (action === "cancel") {
    return;
  }

  if (action === "show") {
    printSummaryBlock(
      "Current configuration",
      ...formatProjectContextSummary(context).split("\n"),
      "",
      ...formatConfigSummary(config).split("\n"),
    );
    return;
  }

  if (action === "setup") {
    await runSetup({ environment, linkProject: true, forceUpdate: true });
    return;
  }

  if (action === "projects") {
    const { runProjects } = await import("./projects.js");
    await runProjects();
    return;
  }

  if (action === "delete") {
    const environments = listEnvironments(context.projectId);
    const confirmed = await confirm({
      message: `Delete environment "${environment}" and remove stored passwords?`,
      default: false,
    });

    if (!confirmed) {
      logWarning("Cancelled.");
      return;
    }

    deleteConfig(environment, context.projectId);
    logSuccess(`Deleted environment "${environment}".`);

    if (environments.length === 1) {
      logReview("No environments remain. Run `supabase-selfhosted-cli setup` to configure again.");
    }
  }

  if (action === "reset") {
    await runResetSetup();
  }
}

export async function runResetSetup(): Promise<void> {
  const cwd = process.cwd();
  const context = resolveProjectContext(cwd);

  if (!context.isLinked && context.environments.length === 0) {
    logError("This directory is not linked to any environments. Nothing to reset.");
    process.exitCode = 1;
    return;
  }

  const envCount = context.environments.length;
  const label = envCount > 0
    ? `${envCount} environment${envCount > 1 ? "s" : ""}`
    : "the project link";

  const confirmed = await confirm({
    message: `Reset setup for this project? This will wipe ${label} and delete the .supabase-selfhosted-cli.json file.`,
    default: false,
  });

  if (!confirmed) {
    logWarning("Cancelled.");
    return;
  }

  const result = resetProjectSetup(cwd);

  if (result.environmentsRemoved.length > 0) {
    logSuccess(`Deleted ${result.environmentsRemoved.length} environment(s): ${result.environmentsRemoved.join(", ")}.`);
  }

  if (result.linkFileDeleted) {
    logSuccess("Deleted .supabase-selfhosted-cli.json link file.");
  }

  logReview("Setup reset complete. Run `supabase-selfhosted-cli setup` to reconfigure.");
}
