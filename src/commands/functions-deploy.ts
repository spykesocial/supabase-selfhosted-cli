import { confirm } from "@inquirer/prompts";
import { resolveShouldRestart, type FunctionsDeployOptions } from "../lib/deploy-options.js";
import { deployFunctionsLocal, restartLocal } from "../lib/local-deploy.js";
import { resolveLocalFunctionsPath } from "../lib/paths.js";
import { requireConfig } from "../lib/require-config.js";
import { deployFunctionsDirectory, restartSupabaseInstance } from "../lib/ssh.js";
import { logWarning } from "../lib/ui.js";

export async function runFunctionsDeploy(options?: FunctionsDeployOptions): Promise<void> {
  const config = await requireConfig(options?.profile);
  if (!config) {
    return;
  }

  const localPath = resolveLocalFunctionsPath(process.cwd(), config.functions.localPath);

  if (config.target === "local") {
    await deployFunctionsLocal(config, localPath, { prune: options?.prune });
  } else {
    await deployFunctionsDirectory(config, localPath, { prune: options?.prune });
  }

  const restartDecision = resolveShouldRestart(config, options);
  let shouldRestart = false;

  if (restartDecision === true) {
    shouldRestart = true;
  } else if (restartDecision === false) {
    shouldRestart = false;
  } else {
    shouldRestart = await confirm({
      message: "Restart Supabase instance now?",
      default: restartDecision === "prompt-default-yes",
    });
  }

  if (shouldRestart) {
    if (config.target === "local") {
      await restartLocal(config);
    } else {
      await restartSupabaseInstance(config);
    }
  } else {
    logWarning("Skipped restart.");
  }
}
