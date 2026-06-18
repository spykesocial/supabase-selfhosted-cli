import { buildDbUrl } from "../lib/config.js";
import { requireConfig } from "../lib/require-config.js";
import { pushDatabaseMigrations } from "../lib/supabase-runner.js";

export async function runDbPush(options?: {
  profile?: string;
  debug?: boolean;
}): Promise<void> {
  const config = await requireConfig(options?.profile);
  if (!config) {
    return;
  }

  const dbUrl = buildDbUrl(config, "push");
  await pushDatabaseMigrations(dbUrl, { debug: options?.debug, cwd: process.cwd() });
}
