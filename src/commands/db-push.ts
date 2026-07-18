import {
  formatProjectContextSummary,
  getAlternateDbPort,
  resolveProjectContext,
} from "../lib/config.js";
import { requireConfig } from "../lib/require-config.js";
import { pushDatabaseMigrations, withDbPortFallback } from "../lib/supabase-runner.js";
import { printSummaryBlock } from "../lib/ui.js";

export async function runDbPush(options?: {
  profile?: string;
  debug?: boolean;
}): Promise<void> {
  const config = await requireConfig(options?.profile);
  if (!config) {
    return;
  }

  const context = resolveProjectContext(process.cwd(), options?.profile);
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
