import {
  buildDbUrl,
  formatProjectContextSummary,
  getAlternateDbPort,
  resolveProjectContext,
  type SupabaseSelfhostedConfig,
} from "../lib/config.js";
import {
  checkCreatePrivilege,
  grantCreatePrivilege,
  grantCreateSql,
} from "../lib/db-access.js";
import { engineRequest, hasEngineSession } from "../lib/engine.js";
import { requireConfig } from "../lib/require-config.js";
import { pushDatabaseMigrations, withDbPortFallback } from "../lib/supabase-runner.js";
import { logError, logInfo, logSuccess, logWarning, printSummaryBlock } from "../lib/ui.js";

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

  await ensurePushPrivileges(config);

  await withDbPortFallback(config, "push", async (dbUrl) => {
    await pushDatabaseMigrations(dbUrl, { debug: options?.debug, cwd: process.cwd() });
  });
}

/**
 * The preflight (supabase/cli#3531): `db push` runs `CREATE SCHEMA IF NOT
 * EXISTS` for its migration table, which PostgreSQL 15+ refuses without
 * `CREATE` on the database — before the "already exists" skip. Self-hosted
 * Supavisor tenant roles rarely hold it, so one missing grant fails every push
 * of every project. Check first, grant once through the project's db
 * container, and say exactly what to run when neither can happen.
 */
async function ensurePushPrivileges(config: SupabaseSelfhostedConfig): Promise<void> {
  const dbUrl = buildDbUrl(config, "push", { port: config.database.pushPort });
  const check = await checkCreatePrivilege(dbUrl);
  if (check.ok === true) return;
  if (check.ok === "unknown") {
    logInfo(`Migration-privilege preflight skipped (${check.reason}).`);
    return;
  }

  logWarning(
    `Role "${check.role}" lacks CREATE on database "${check.database}" — supabase db push ` +
      `would fail with "permission denied for database" (supabase/cli#3531). Granting it once…`,
  );
  const granted = await grantCreatePrivilege(config, check.role, check.database);
  if (granted.ok) {
    logSuccess(`Privilege granted (${granted.detail}).`);
    return;
  }
  logWarning(`Could not grant automatically: ${granted.detail}`);
  logWarning(
    "Grant it yourself as a superuser (Studio SQL editor, or " +
      "docker exec <db-container> psql -U supabase_admin):\n  " +
      grantCreateSql(check.role, check.database),
  );
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
