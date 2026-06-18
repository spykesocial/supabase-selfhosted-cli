import path from "node:path";
import { buildDbUrl } from "../lib/config.js";
import { requireConfig } from "../lib/require-config.js";
import { generateTypeScriptTypes } from "../lib/supabase-runner.js";

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
