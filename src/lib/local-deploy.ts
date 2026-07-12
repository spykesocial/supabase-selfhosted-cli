import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import type { SupabaseSelfhostedConfig } from "./config.js";
import { saveConfig } from "./config.js";
import { joinRemotePath, listLocalEntries } from "./function-sync.js";
import {
  persistScopedRestartCommand,
  resolveRestartCommand,
} from "./restart-command.js";
import { logInfo, logSuccess, logWarning, withSpinner } from "./ui.js";

function copyDirectory(
  localDir: string,
  targetDir: string,
  onFile?: (relativePath: string) => void,
  baseDir = localDir,
): void {
  fs.mkdirSync(targetDir, { recursive: true });

  for (const entry of fs.readdirSync(localDir, { withFileTypes: true })) {
    const localPath = path.join(localDir, entry.name);
    const destPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      copyDirectory(localPath, destPath, onFile, baseDir);
      continue;
    }

    if (entry.isFile()) {
      onFile?.(path.relative(baseDir, localPath).replace(/\\/g, "/"));
      fs.copyFileSync(localPath, destPath);
    }
  }
}

function pruneLocalDirectory(
  localDir: string,
  targetDir: string,
  targetRoot: string,
  onPrune?: (relativePath: string) => void,
): number {
  if (!fs.existsSync(targetDir)) {
    return 0;
  }

  const localEntries = listLocalEntries(localDir);
  const targetEntries = fs.readdirSync(targetDir, { withFileTypes: true });
  const localByName = new Map(localEntries.map((entry) => [entry.name, entry]));
  let pruned = 0;

  for (const targetEntry of targetEntries) {
    const localEntry = localByName.get(targetEntry.name);
    const localPath = path.join(localDir, targetEntry.name);
    const entryPath = joinRemotePath(targetDir, targetEntry.name);

    if (!localEntry) {
      fs.rmSync(entryPath, { recursive: true, force: true });
      onPrune?.(entryPath.slice(targetRoot.length + 1));
      pruned += 1;
      continue;
    }

    if (targetEntry.isDirectory() && localEntry.isDirectory) {
      pruned += pruneLocalDirectory(localPath, entryPath, targetRoot, onPrune);
    }
  }

  return pruned;
}

export async function deployFunctionsLocal(
  config: SupabaseSelfhostedConfig,
  localFunctionsPath: string,
  options?: { prune?: boolean },
): Promise<void> {
  const targetPath = path.resolve(config.functions.remotePath);

  logInfo(`Copying ${localFunctionsPath} -> ${targetPath}`);

  if (options?.prune) {
    const removed = pruneLocalDirectory(
      localFunctionsPath,
      targetPath,
      targetPath,
      (relativePath) => {
        logInfo(`Pruned destination-only path: ${relativePath}`);
      },
    );
    if (removed > 0) {
      logSuccess(`Pruned ${removed} destination-only path(s).`);
    }
  }

  let uploaded = 0;
  await withSpinner("Copying function files...", async () => {
    copyDirectory(localFunctionsPath, targetPath, () => {
      uploaded += 1;
    });
  });

  logSuccess(`Functions copied successfully (${uploaded} file(s)).`);
}

export async function restartLocal(config: SupabaseSelfhostedConfig): Promise<void> {
  const resolved = resolveRestartCommand(config);
  if (resolved.autoScoped) {
    logWarning(
      resolved.projectId
        ? `Restart command was host-wide; scoping to project "${resolved.projectId}" from functions path.`
        : "Restart command was incomplete; using project-scoped command derived from functions path.",
    );
    if (config.deploy.restartCommand.trim() !== resolved.command) {
      saveConfig(persistScopedRestartCommand(config, resolved.command));
      logInfo(
        `Updated profile "${config.profile}" restart command to the project-scoped version.`,
      );
    }
  }

  logInfo(`Running restart command: ${resolved.command}`);
  try {
    await withSpinner("Restarting Supabase runtime...", async () => {
      execSync(resolved.command, { stdio: "inherit", shell: "/bin/sh" });
    });
  } catch {
    throw new Error("Restart command failed");
  }

  logSuccess("Restart completed.");
}
