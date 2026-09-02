import path from "node:path";
import fs from "node:fs";
import {
  formatProjectContextSummary,
  getAlternateDbPort,
  resolveProjectContext,
} from "../lib/config.js";
import { engineRequest, hasEngineSession } from "../lib/engine.js";
import { requireConfig } from "../lib/require-config.js";
import { generateTypeScriptTypes, withDbPortFallback } from "../lib/supabase-runner.js";
import { logError, logInfo, printSummaryBlock } from "../lib/ui.js";

export async function runGenTypes(options?: {
  environment?: string;
  output?: string;
  schema?: string;
  debug?: boolean;
}): Promise<void> {
  const config = await requireConfig(options?.environment);
  if (!config) {
    return;
  }

  const outputFile = path.resolve(
    process.cwd(),
    options?.output ?? "database.types.ts",
  );

  if (hasEngineSession()) {
    await runGenTypesViaEngine(config, options, outputFile);
    return;
  }

  const context = resolveProjectContext(process.cwd(), options?.environment);
  const alternatePort = getAlternateDbPort(config, "types");
  printSummaryBlock(
    "Generating types with",
    ...formatProjectContextSummary(context).split("\n"),
    `Target: ${config.target === "local" ? "local machine" : `${config.ssh.user}@${config.ssh.host}`}`,
    `DB host: ${config.database.host}:${config.database.typesPort}` +
      (alternatePort !== undefined ? ` (fallback: ${alternatePort})` : ""),
    `DB tenant: postgres.${config.database.tenantId}`,
  );

  await withDbPortFallback(config, "types", async (dbUrl) => {
    await generateTypeScriptTypes(dbUrl, outputFile, {
      debug: options?.debug,
      cwd: process.cwd(),
      schema: options?.schema,
    });
  });
}

async function runGenTypesViaEngine(
  config: NonNullable<Awaited<ReturnType<typeof requireConfig>>>,
  options: { schema?: string; debug?: boolean } | undefined,
  outputFile: string,
): Promise<void> {
  logInfo("Generating types via the Velocilabs Engine…");
  const result = await engineRequest<{ success: boolean; output: string }>(
    "POST",
    "/api/v1/db/gen-types",
    {
      tenantId: config.database.tenantId,
      password: config.database.password,
      host: config.database.host,
      pushPort: config.database.pushPort,
      typesPort: config.database.typesPort,
      database: config.database.database,
      schema: options?.schema,
      debug: options?.debug,
    },
  );

  if (!result.output) {
    logError("The engine returned no type definitions.");
    process.exitCode = 1;
    return;
  }

  fs.writeFileSync(outputFile, result.output);
  logInfo(`Wrote ${outputFile}`);
}
