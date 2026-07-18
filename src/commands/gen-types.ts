import path from "node:path";
import {
  formatProjectContextSummary,
  getAlternateDbPort,
  resolveProjectContext,
} from "../lib/config.js";
import { requireConfig } from "../lib/require-config.js";
import { generateTypeScriptTypes, withDbPortFallback } from "../lib/supabase-runner.js";
import { printSummaryBlock } from "../lib/ui.js";

export async function runGenTypes(options?: {
  profile?: string;
  output?: string;
  schema?: string;
  debug?: boolean;
}): Promise<void> {
  const config = await requireConfig(options?.profile);
  if (!config) {
    return;
  }

  const context = resolveProjectContext(process.cwd(), options?.profile);
  const alternatePort = getAlternateDbPort(config, "types");
  printSummaryBlock(
    "Generating types with",
    ...formatProjectContextSummary(context).split("\n"),
    `Target: ${config.target === "local" ? "local machine" : `${config.ssh.user}@${config.ssh.host}`}`,
    `DB host: ${config.database.host}:${config.database.typesPort}` +
      (alternatePort !== undefined ? ` (fallback: ${alternatePort})` : ""),
    `DB tenant: postgres.${config.database.tenantId}`,
  );

  const outputFile = path.resolve(
    process.cwd(),
    options?.output ?? "database.types.ts",
  );

  await withDbPortFallback(config, "types", async (dbUrl) => {
    await generateTypeScriptTypes(dbUrl, outputFile, {
      debug: options?.debug,
      cwd: process.cwd(),
      schema: options?.schema,
    });
  });
}
