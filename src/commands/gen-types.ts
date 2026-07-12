import path from "node:path";
import {
  buildDbUrl,
  formatProjectContextSummary,
  resolveProjectContext,
} from "../lib/config.js";
import { requireConfig } from "../lib/require-config.js";
import { generateTypeScriptTypes } from "../lib/supabase-runner.js";
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
  printSummaryBlock(
    "Generating types with",
    ...formatProjectContextSummary(context).split("\n"),
    `Target: ${config.target === "local" ? "local machine" : `${config.ssh.user}@${config.ssh.host}`}`,
    `DB host: ${config.database.host}:${config.database.typesPort}`,
    `DB tenant: postgres.${config.database.tenantId}`,
  );

  const outputFile = path.resolve(
    process.cwd(),
    options?.output ?? "database.types.ts",
  );
  const dbUrl = buildDbUrl(config, "types");

  await generateTypeScriptTypes(dbUrl, outputFile, {
    debug: options?.debug,
    cwd: process.cwd(),
    schema: options?.schema,
  });
}
