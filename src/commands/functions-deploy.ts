import path from "node:path";
import { confirm } from "@inquirer/prompts";
import {
  formatProjectContextSummary,
  resolveProjectContext,
} from "../lib/config.js";
import { resolveShouldPrune, resolveShouldRestart, type FunctionsDeployOptions } from "../lib/deploy-options.js";
import { deployFunctionsLocal, listPrunableLocalPaths, restartLocal } from "../lib/local-deploy.js";
import { resolveLocalFunctionsPath } from "../lib/paths.js";
import { requireConfig } from "../lib/require-config.js";
import { deployFunctionsDirectory, listPrunableRemotePaths, restartSupabaseInstance } from "../lib/ssh.js";
import { logInfo, logWarning, logSuccess, printSummaryBlock, withSpinner } from "../lib/ui.js";

export async function runFunctionsDeploy(options?: FunctionsDeployOptions): Promise<void> {
  const config = await requireConfig(options?.profile);
  if (!config) {
    return;
  }

  const context = resolveProjectContext(process.cwd(), options?.profile);
  printSummaryBlock(
    "Deploying with",
    ...formatProjectContextSummary(context).split("\n"),
    `Target: ${config.target === "local" ? "local machine" : `${config.ssh.user}@${config.ssh.host}`}`,
    `Functions destination: ${config.functions.remotePath}`,
    `DB tenant: postgres.${config.database.tenantId}`,
  );

  const localPath = resolveLocalFunctionsPath(process.cwd(), config.functions.localPath);
  logInfo(`Local functions: ${localPath}`);

  const pruneDecision = resolveShouldPrune(config, options);
  let shouldPrune = false;

  if (pruneDecision === true) {
    shouldPrune = true;
  } else if (pruneDecision === false) {
    shouldPrune = false;
  } else {
    const prunable = await withSpinner("Checking for stale functions...", async () =>
      config.target === "local"
        ? listPrunableLocalPaths(localPath, path.resolve(config.functions.remotePath))
        : listPrunableRemotePaths(config, localPath),
    );

    if (prunable.length === 0) {
      logSuccess("No stale functions found — skipping prune.");
    } else {
      logWarning(`Found ${prunable.length} stale entr${prunable.length === 1 ? "y" : "ies"} on the server not present locally:`);
      for (const name of prunable) {
        logInfo(`  ${name}`);
      }
      shouldPrune = await confirm({
        message: "Prune these stale entries?",
        default: pruneDecision === "prompt-default-yes",
      });
    }
  }

  if (config.target === "local") {
    await deployFunctionsLocal(config, localPath, { prune: shouldPrune });
  } else {
    await deployFunctionsDirectory(config, localPath, { prune: shouldPrune });
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
