import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  buildDbUrl,
  getDbPortsWithFallback,
  type SupabaseSelfhostedConfig,
} from "./config.js";
import { logSuccess, logWarning, withSpinner } from "./ui.js";

export async function withDbPortFallback<T>(
  config: SupabaseSelfhostedConfig,
  kind: "push" | "types",
  run: (dbUrl: string, port: number) => Promise<T>,
): Promise<T> {
  const ports = getDbPortsWithFallback(config, kind);
  let lastError: unknown;

  for (let index = 0; index < ports.length; index += 1) {
    const port = ports[index]!;
    try {
      return await run(buildDbUrl(config, kind, { port }), port);
    } catch (error) {
      lastError = error;
      const nextPort = ports[index + 1];
      if (nextPort !== undefined) {
        logWarning(
          `Failed on port ${port}. Retrying with the other configured port (${nextPort})...`,
        );
      }
    }
  }

  throw lastError;
}

function resolveSupabaseBinary(): string {
  const localBin = path.join(process.cwd(), "node_modules", ".bin", "supabase");
  if (fs.existsSync(localBin)) {
    return localBin;
  }

  return "npx";
}

function runSupabase(args: string[], options?: { cwd?: string; outputFile?: string }): void {
  const localBin = path.join(process.cwd(), "node_modules", ".bin", "supabase");
  const useNpx = !fs.existsSync(localBin);
  const command = useNpx ? "npx" : localBin;
  const finalArgs = useNpx ? ["supabase", ...args] : args;

  if (options?.outputFile) {
    const result = spawnSync(command, finalArgs, {
      cwd: options.cwd ?? process.cwd(),
      encoding: "utf8",
      shell: false,
    });

    if (result.error) {
      throw result.error;
    }

    if ((result.status ?? 1) !== 0) {
      throw new Error(result.stderr || result.stdout || "supabase command failed");
    }

    fs.writeFileSync(options.outputFile, result.stdout);
    return;
  }

  const result = spawnSync(command, finalArgs, {
    cwd: options?.cwd ?? process.cwd(),
    stdio: "inherit",
    shell: false,
  });

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 1) !== 0) {
    throw new Error("supabase command failed");
  }
}

export async function pushDatabaseMigrations(
  dbUrl: string,
  options?: { debug?: boolean; cwd?: string },
): Promise<void> {
  const args = ["db", "push", "--db-url", dbUrl, "--yes"];
  if (options?.debug) {
    args.push("--debug");
  }

  await withSpinner("Running supabase db push...", async () => {
    runSupabase(args, { cwd: options?.cwd });
  });
}

export async function generateTypeScriptTypes(
  dbUrl: string,
  outputFile: string,
  options?: { debug?: boolean; cwd?: string; schema?: string },
): Promise<void> {
  const args = [
    "gen",
    "types",
    "typescript",
    "--db-url",
    dbUrl,
    "--schema",
    options?.schema ?? "public",
  ];

  if (options?.debug) {
    args.push("--debug");
  }

  await withSpinner(`Generating TypeScript types -> ${outputFile}`, async () => {
    runSupabase(args, { cwd: options?.cwd, outputFile });
  });
  logSuccess(`Wrote ${outputFile}`);
}

export function assertSupabaseCliAvailable(): void {
  resolveSupabaseBinary();
}
