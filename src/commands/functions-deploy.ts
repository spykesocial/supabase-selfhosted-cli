import path from "node:path";
import fs from "node:fs";
import { confirmPrompt } from "../lib/prompts.js";
import {
  formatProjectContextSummary,
  resolveProjectContext,
} from "../lib/config.js";
import { resolveShouldPrune, resolveShouldRestart, type FunctionsDeployOptions } from "../lib/deploy-options.js";
import { engineRequest, hasEngineSession } from "../lib/engine.js";
import { deployFunctionsLocal, listPrunableLocalPaths, restartLocal } from "../lib/local-deploy.js";
import { resolveLocalFunctionsPath } from "../lib/paths.js";
import { requireConfig } from "../lib/require-config.js";
import { deployFunctionsDirectory, listPrunableRemotePaths, restartSupabaseInstance } from "../lib/ssh.js";
import { logInfo, logWarning, logSuccess, logDetail, printSummaryBlock, withSpinner } from "../lib/ui.js";

export async function runFunctionsDeploy(options?: FunctionsDeployOptions): Promise<void> {
  const config = await requireConfig(options?.environment);
  if (!config) {
    return;
  }

  if (hasEngineSession()) {
    await runFunctionsDeployViaEngine(config, options);
    return;
  }

  const context = resolveProjectContext(process.cwd(), options?.environment);
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
        logDetail(name);
      }
      shouldPrune = await confirmPrompt({
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
    shouldRestart = await confirmPrompt({
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

async function runFunctionsDeployViaEngine(
  config: NonNullable<Awaited<ReturnType<typeof requireConfig>>>,
  options?: FunctionsDeployOptions,
): Promise<void> {
  const localPath = resolveLocalFunctionsPath(process.cwd(), config.functions.localPath);
  logInfo("Deploying functions via the Velocilabs Engine…");

  const pruneDecision = resolveShouldPrune(config, options);
  const shouldPrune = pruneDecision === true || (pruneDecision !== false && config.deploy.pruneAfterDeploy);
  const restartDecision = resolveShouldRestart(config, options);
  const shouldRestart = restartDecision === true || (restartDecision !== false && config.deploy.restartAfterDeploy);

  const files = collectFunctionFiles(localPath);
  logInfo(`Uploading ${files.length} file(s) to the engine.`);

  const result = await engineRequest<{
    success: boolean;
    uploaded: number;
    pruned: number;
    restarted: boolean;
  }>("POST", "/api/v1/functions/deploy", {
    target: config.target,
    ssh: config.target === "ssh" ? config.ssh : undefined,
    files,
    remotePath: config.functions.remotePath,
    prune: shouldPrune,
    restart: shouldRestart,
    restartCommand: config.deploy.restartCommand || undefined,
  });

  logSuccess(`Functions uploaded (${result.uploaded} file(s)).`);
  if (result.pruned > 0) {
    logInfo(`Pruned ${result.pruned} remote-only path(s).`);
  }
  if (result.restarted) {
    logSuccess("Restart completed.");
  } else {
    logWarning("Skipped restart.");
  }
}

function collectFunctionFiles(dir: string): { path: string; content: string }[] {
  const files: { path: string; content: string }[] = [];
  const walk = (current: string, relative: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      const relativePath = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(entryPath, relativePath);
      } else if (entry.isFile()) {
        files.push({ path: relativePath, content: fs.readFileSync(entryPath, "utf8") });
      }
    }
  };
  walk(dir, "");
  return files;
}
