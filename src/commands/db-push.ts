import {
  formatProjectContextSummary,
  getAlternateDbPort,
  resolveProjectContext,
} from "../lib/config.js";
import { engineRequest, hasEngineSession } from "../lib/engine.js";
import { requireConfig } from "../lib/require-config.js";
import { pushDatabaseMigrations, withDbPortFallback } from "../lib/supabase-runner.js";
import { logError, logInfo, printSummaryBlock } from "../lib/ui.js";

export async function runDbPush(options?: {
  environment?: string;
  debug?: boolean;
}): Promise<void> {
  const config = await requireConfig(options?.environment);
  if (!config) {
    return;
  }

  if (hasEngineSession()) {
    await runDbPushViaEngine(config, options);
    return;
  }

  const context = resolveProjectContext(process.cwd(), options?.environment);
  const alternatePort = getAlternateDbPort(config, "push");
  printSummaryBlock(
    "Pushing migrations with",
    ...formatProjectContextSummary(context).split("\n"),
    `Target: ${config.target === "local" ? "local machine" : `${config.ssh.user}@${config.ssh.host}`}`,
    `DB host: ${config.database.host}:${config.database.pushPort}` +
      (alternatePort !== undefined ? ` (fallback: ${alternatePort})` : ""),
    `DB tenant: postgres.${config.database.tenantId}`,
  );

  await withDbPortFallback(config, "push", async (dbUrl) => {
    await pushDatabaseMigrations(dbUrl, { debug: options?.debug, cwd: process.cwd() });
  });
}

async function runDbPushViaEngine(
  config: NonNullable<Awaited<ReturnType<typeof requireConfig>>>,
  options?: { debug?: boolean },
): Promise<void> {
  logInfo("Pushing migrations via the Velocilabs Engine…");
  const result = await engineRequest<{
    success: boolean;
    stdout: string;
    stderr: string;
    code: number;
  }>("POST", "/api/v1/db/push", {
    tenantId: config.database.tenantId,
    password: config.database.password,
    host: config.database.host,
    pushPort: config.database.pushPort,
    typesPort: config.database.typesPort,
    database: config.database.database,
    debug: options?.debug,
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.code !== 0) {
    logError(result.stderr || "DB push failed.");
    process.exitCode = 1;
  }
}
