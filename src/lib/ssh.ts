import fs from "node:fs";
import path from "node:path";
import { Client } from "ssh2";
import SftpClient from "ssh2-sftp-client";
import type { SupabaseSelfhostedConfig } from "./config.js";
import { saveConfig } from "./config.js";
import {
  joinRemotePath,
  listLocalEntries,
} from "./function-sync.js";
import {
  persistScopedRestartCommand,
  resolveRestartCommand,
} from "./restart-command.js";
import { logInfo, logSuccess, logWarning, withSpinner } from "./ui.js";

type SshCredentials = SupabaseSelfhostedConfig["ssh"];

function withSshClient<T>(
  credentials: SshCredentials,
  run: (client: Client) => Promise<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const client = new Client();

    client
      .on("ready", () => {
        run(client)
          .then(resolve)
          .catch(reject)
          .finally(() => client.end());
      })
      .on("error", reject)
      .connect({
        host: credentials.host,
        port: 22,
        username: credentials.user,
        password: credentials.password,
        readyTimeout: 20_000,
      });
  });
}

export async function runRemoteCommand(
  credentials: SshCredentials,
  command: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return withSshClient(credentials, (client) =>
    new Promise((resolve, reject) => {
      client.exec(command, (error, stream) => {
        if (error) {
          reject(error);
          return;
        }

        let stdout = "";
        let stderr = "";

        stream
          .on("close", (code: number) => {
            resolve({ stdout, stderr, code: code ?? 1 });
          })
          .on("data", (data: Buffer) => {
            stdout += data.toString();
            process.stdout.write(data);
          });

        stream.stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
          process.stderr.write(data);
        });
      });
    }),
  );
}

async function uploadDirectory(
  sftp: SftpClient,
  localDir: string,
  remoteDir: string,
  onFile?: (relativePath: string) => void,
  baseDir = localDir,
): Promise<void> {
  await sftp.mkdir(remoteDir, true);

  for (const entry of fs.readdirSync(localDir, { withFileTypes: true })) {
    const localPath = path.join(localDir, entry.name);
    const remotePath = `${remoteDir}/${entry.name}`.replace(/\\/g, "/");

    if (entry.isDirectory()) {
      await uploadDirectory(sftp, localPath, remotePath, onFile, baseDir);
      continue;
    }

    if (entry.isFile()) {
      onFile?.(path.relative(baseDir, localPath).replace(/\\/g, "/"));
      await sftp.fastPut(localPath, remotePath);
    }
  }
}

async function pruneDirectory(
  sftp: SftpClient,
  localDir: string,
  remoteDir: string,
  remoteRoot: string,
  onPrune?: (relativePath: string) => void,
): Promise<number> {
  const localEntries = listLocalEntries(localDir);
  let remoteEntries: Array<{ name: string; type: string }>;

  try {
    remoteEntries = await sftp.list(remoteDir);
  } catch {
    return 0;
  }

  const localByName = new Map(localEntries.map((entry) => [entry.name, entry]));
  let pruned = 0;

  for (const remoteEntry of remoteEntries) {
    const localEntry = localByName.get(remoteEntry.name);
    const localPath = path.join(localDir, remoteEntry.name);
    const remotePath = joinRemotePath(remoteDir, remoteEntry.name);

    if (!localEntry) {
      if (remoteEntry.type === "d") {
        await sftp.rmdir(remotePath, true);
      } else {
        await sftp.delete(remotePath);
      }
      onPrune?.(remotePath.slice(remoteRoot.length + 1));
      pruned += 1;
      continue;
    }

    if (remoteEntry.type === "d" && localEntry.isDirectory) {
      pruned += await pruneDirectory(sftp, localPath, remotePath, remoteRoot, onPrune);
    }
  }

  return pruned;
}

export async function deployFunctionsDirectory(
  config: SupabaseSelfhostedConfig,
  localFunctionsPath: string,
  options?: { prune?: boolean },
): Promise<void> {
  const sftp = new SftpClient();

  try {
    await sftp.connect({
      host: config.ssh.host,
      port: 22,
      username: config.ssh.user,
      password: config.ssh.password,
      readyTimeout: 20_000,
    });

    logInfo(
      `Uploading ${localFunctionsPath} -> ${config.ssh.user}@${config.ssh.host}:${config.functions.remotePath}`,
    );

    if (options?.prune) {
      const removed = await pruneDirectory(
        sftp,
        localFunctionsPath,
        config.functions.remotePath,
        config.functions.remotePath,
        (relativePath) => {
          logInfo(`Pruned remote-only path: ${relativePath}`);
        },
      );
      if (removed > 0) {
        logSuccess(`Pruned ${removed} remote-only path(s).`);
      }
    }

    let uploaded = 0;
    await withSpinner("Uploading function files...", async () => {
      await uploadDirectory(sftp, localFunctionsPath, config.functions.remotePath, () => {
        uploaded += 1;
      });
    });

    logSuccess(`Functions uploaded successfully (${uploaded} file(s)).`);
  } finally {
    await sftp.end();
  }
}

export async function restartSupabaseInstance(config: SupabaseSelfhostedConfig): Promise<void> {
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
  const result = await withSpinner("Restarting Supabase runtime...", async () =>
    runRemoteCommand(config.ssh, resolved.command),
  );

  if (result.code !== 0) {
    throw new Error(`Restart command failed with exit code ${result.code}`);
  }

  logSuccess("Restart completed.");
}
