import { select } from "@inquirer/prompts";
import { loadConfig, resolveProjectContext } from "./config.js";
import { logError, logWarning } from "./ui.js";

export async function requireConfig(environment?: string) {
  const cwd = process.cwd();
  const context = resolveProjectContext(cwd, environment);

  let resolvedEnvironment: string;

  if (environment) {
    resolvedEnvironment = environment;
  } else if (context.isLinked && context.environments.length > 0) {
    if (context.environments.length === 1) {
      resolvedEnvironment = context.environments[0];
    } else {
      resolvedEnvironment = await select({
        message: "Which environment do you want to use?",
        choices: context.environments.map((name) => ({
          name,
          value: name,
        })),
      });
    }
  } else {
    logError(
      `This directory (${context.projectRoot}) is not linked to a Supabase environment.`,
    );
    logError(
      `Run \`supabase-selfhosted-cli projects\` to link it or \`supabase-selfhosted-cli setup\` to create "${context.suggestedEnvironmentName}".`,
    );
    process.exitCode = 1;
    return null;
  }

  const config = loadConfig(resolvedEnvironment, context.projectId);

  if (!config) {
    logError(
      `No environment "${resolvedEnvironment}" found. Run \`supabase-selfhosted-cli setup -e ${resolvedEnvironment}\` first.`,
    );
    if (context.environments.length > 0) {
      logError(`Linked environments for this project: ${context.environments.join(", ")}`);
    }
    process.exitCode = 1;
    return null;
  }

  if (
    environment &&
    context.environments.length > 0 &&
    !context.environments.includes(environment)
  ) {
    logWarning(
      `Environment "${environment}" is not linked to this project (linked: ${context.environments.join(", ")}). Using it for this command only.`,
    );
  }

  return config;
}
