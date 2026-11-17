import { execFileSync } from "node:child_process";
import pg from "pg";
import type { SupabaseSelfhostedConfig } from "./config.js";
import { runRemoteCommandQuiet } from "./ssh.js";

/**
 * Migration-privilege plumbing for `db push` (supabase/cli#3531).
 *
 * The Supabase CLI's push always runs `CREATE SCHEMA IF NOT EXISTS
 * supabase_migrations`, and on PostgreSQL 15+ that needs `CREATE` on the
 * database itself — checked before the "already exists" skip. Self-hosted
 * Supavisor tenant roles rarely hold it, so `db push` dies with
 * `failed to create migration table: ERROR: permission denied for database
 * postgres` on every push of every project until someone grants it once.
 *
 * Three layers here: a cheap preflight against the real connection, an
 * automatic one-time fix over SSH/local Docker (the grant the Supabase
 * knowledge base prescribes), and plain-language hints for the known failure
 * modes when neither can run.
 */

export type PrivilegeCheck =
  /** The role can create schemas — push can run. */
  | { ok: true }
  /** The role is connected but lacks `CREATE` on the database. */
  | { ok: false; role: string; database: string }
  /** Could not determine (connection failed) — never blocks the push. */
  | { ok: "unknown"; reason: string };

/** Can the push role create schemas on its database? Never throws. */
export async function checkCreatePrivilege(dbUrl: string): Promise<PrivilegeCheck> {
  const client = new pg.Client({ connectionString: dbUrl, ssl: false });
  try {
    await client.connect();
    const { rows } = await client.query<{
      role: string;
      database: string;
      can_create: boolean;
    }>(
      `select current_user as role,
              current_database() as database,
              has_database_privilege(current_user, current_database(), 'CREATE') as can_create`,
    );
    const row = rows[0];
    if (!row) return { ok: "unknown", reason: "empty result" };
    return row.can_create
      ? { ok: true }
      : { ok: false, role: row.role, database: row.database };
  } catch (error) {
    return {
      ok: "unknown",
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** `GRANT CREATE ON DATABASE … TO …` with identifiers quoted. */
export function grantCreateSql(role: string, database: string): string {
  return `GRANT CREATE ON DATABASE ${quoteIdent(database)} TO ${quoteIdent(role)};`;
}

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * The role and database behind a `postgresql://` URL, for error hints. A
 * Supavisor tenant login (`postgres.<tenant-uuid>`) connects as its prefix, so
 * that is the role a grant must name.
 */
export function parseDbUrl(dbUrl: string): { role: string; database: string } {
  try {
    const url = new URL(dbUrl);
    const rawRole = decodeURIComponent(url.username || "postgres");
    const role = /^[^.]+\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      rawRole,
    )
      ? rawRole.split(".")[0]!
      : rawRole;
    const database = decodeURIComponent(url.pathname.replace(/^\//, "")) || "postgres";
    return { role, database };
  } catch {
    return { role: "postgres", database: "postgres" };
  }
}

/**
 * The Docker container publishing a host port — matched exactly on the
 * published port (`:5434->`), never by name. On most stacks that is the
 * pooler (Supavisor), which proxies to the db container — so this is the
 * stack's anchor, and `grantCreatePrivilege` walks from it to the container
 * that actually runs `psql`.
 */
export function findContainerByPort(dockerPsOutput: string, hostPort: number): string | null {
  for (const line of dockerPsOutput.split("\n")) {
    const [name, ports] = line.split("|");
    if (!name || !ports) continue;
    if (ports.split(/[\s,]+/).some((entry) => entry.includes(`:${hostPort}->`))) {
      return name.trim();
    }
  }
  return null;
}

/**
 * Containers to try for `docker exec … psql`, best first: the port's own
 * container (direct Postgres publishes), then the stack's containers whose
 * naming says database. Names differ per orchestrator (Dokploy folder ids vs
 * compose names), so this only orders — every candidate is probed for `psql`
 * before it is used.
 */
export function rankDbCandidates(
  portContainer: string | null,
  stackContainers: string[],
): string[] {
  const looksLikeDb = (name: string) => /(^|[-_])(db|postgres|pg)([-_]|$)/i.test(name);
  const anchor = (portContainer ?? "").trim();
  const names = [...new Set([anchor, ...stackContainers].map((name) => name.trim()).filter(Boolean))];
  return [
    ...names.filter((name) => name === anchor),
    ...names.filter((name) => name !== anchor && looksLikeDb(name)),
    ...names.filter((name) => name !== anchor && !looksLikeDb(name)),
  ];
}

async function runDocker(
  config: SupabaseSelfhostedConfig,
  command: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  if (config.target === "ssh") {
    return runRemoteCommandQuiet(config.ssh, command);
  }
  try {
    const stdout = execFileSync("/bin/sh", ["-c", command], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { stdout, stderr: "", code: 0 };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? String(error),
      code: failure.status ?? 1,
    };
  }
}

/**
 * The one-time fix: grant `CREATE` on the database to the push role, through
 * `psql -U supabase_admin` in the project's db container (the bootstrap
 * superuser of every Supabase stack). The stack is located by its published
 * port and then followed to a container that really runs `psql` — the port is
 * often the pooler's. Returns what happened, never throws.
 */
export async function grantCreatePrivilege(
  config: SupabaseSelfhostedConfig,
  role: string,
  database: string,
): Promise<{ ok: boolean; detail: string }> {
  const where =
    config.target === "ssh"
      ? `${config.ssh.user}@${config.ssh.host}`
      : "the local machine";

  const listed = await runDocker(config, `docker ps --format '{{.Names}}|{{.Ports}}'`);
  if (listed.code !== 0) {
    return {
      ok: false,
      detail: `could not list Docker containers on ${where}: ${listed.stderr.trim() || "docker ps failed"}`,
    };
  }

  const allNames = listed.stdout
    .split("\n")
    .map((line) => line.split("|")[0]?.trim() ?? "")
    .filter(Boolean);
  const portContainer = findContainerByPort(listed.stdout, config.database.pushPort);
  if (!portContainer && allNames.length === 0) {
    return {
      ok: false,
      detail: `no running containers found on ${where} (is the stack up?)`,
    };
  }

  const stackContainers = await resolveStackContainers(config, portContainer, allNames);
  const candidates = rankDbCandidates(portContainer, stackContainers);
  if (candidates.length === 0) {
    return {
      ok: false,
      detail:
        `no container publishes port ${config.database.pushPort} on ${where} ` +
        `(is the stack running?); looked for: ${grantCreateSql(role, database)}`,
    };
  }

  const sql = grantCreateSql(role, database);
  const failures: string[] = [];
  for (const container of candidates) {
    for (const psqlUser of ["supabase_admin", "postgres"]) {
      const attempt = await runDocker(
        config,
        `docker exec ${shellQuote(container)} psql -U ${psqlUser} -v ON_ERROR_STOP=1 -c ${shellQuote(sql)}`,
      );
      if (attempt.code === 0) {
        return {
          ok: true,
          detail: `granted via docker exec ${container} psql -U ${psqlUser}`,
        };
      }
      failures.push(`${container} (${psqlUser}): ${firstLine(attempt.stderr)}`);
    }
  }

  return {
    ok: false,
    detail:
      `no candidate container ran the grant — tried ${failures.join("; ")}. ` +
      `Run it as a superuser yourself: ${sql}`,
  };
}

/**
 * Everything that belongs to the stack owning the port: the containers sharing
 * the Docker Compose project of the port's container (the pooler and the db of
 * one stack share it), or — without compose labels — the names sharing the
 * port container's first name segment.
 */
async function resolveStackContainers(
  config: SupabaseSelfhostedConfig,
  portContainer: string | null,
  allNames: string[],
): Promise<string[]> {
  if (!portContainer) return [];

  const inspected = await runDocker(
    config,
    `docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' ${shellQuote(portContainer)}`,
  );
  const project = inspected.stdout.trim();
  if (inspected.code === 0 && project) {
    const scoped = await runDocker(
      config,
      `docker ps --filter label=com.docker.compose.project=${shellQuote(project)} --format '{{.Names}}'`,
    );
    if (scoped.code === 0) {
      return scoped.stdout.split("\n").map((name) => name.trim()).filter(Boolean);
    }
  }

  const prefix = portContainer.split(/[-_]/)[0] ?? "";
  return prefix ? allNames.filter((name) => name.startsWith(prefix)) : [];
}

function firstLine(text: string): string {
  return (text.trim().split("\n")[0] ?? "").trim() || "failed";
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * The known `supabase db push` failures of self-hosted Supavisor setups, in
 * plain words with the fix that works — so a failed push never ends at a bare
 * Go error again. Returns null for anything unrecognized.
 */
export function dbErrorHint(
  output: string,
  ctx: { role: string; database: string },
): string | null {
  const grant = grantCreateSql(ctx.role, ctx.database);

  if (/failed to create migration table:.*permission denied for database/i.test(output)) {
    return [
      "Known issue (supabase/cli#3531): the migration role has no CREATE on the",
      "database, and PostgreSQL 15+ checks that before the schema's",
      "'already exists' skip — so every push fails even though the schema is fine.",
      `Fix (once per database), as a superuser — Studio SQL editor or`,
      `docker exec <db-container> psql -U supabase_admin:`,
      `  ${grant}`,
    ].join("\n");
  }

  if (/failed to create migration table:.*permission denied for schema/i.test(output)) {
    return [
      "Known issue: the migration role cannot write to the supabase_migrations schema.",
      `Fix (once), as a superuser:`,
      `  GRANT CREATE, USAGE ON SCHEMA supabase_migrations TO "${ctx.role}";`,
    ].join("\n");
  }

  if (/prepared statement .* already exists/i.test(output)) {
    return [
      "Known issue: the Supabase CLI's prepared statements clash with",
      "Supavisor/pgbouncer transaction pooling on this port.",
      "Fix: retry (pool state varies), or set the migration port in",
      "`supabase-selfhosted-cli setup` to the stack's direct Postgres port",
      "(the 54xx migration port rather than the 64xx pooler port).",
    ].join("\n");
  }

  if (/server refused TLS connection|tls error|SSL connection has been closed|does not support TLS/i.test(output)) {
    return [
      "Known issue: self-hosted Supavisor has no TLS, and recent Supabase CLI",
      "versions force TLS for remote --db-url hosts.",
      "Fix: run through supabase-selfhosted-cli (it sets PGSSLMODE=disable), or",
      "prefix the raw command with PGSSLMODE=disable.",
    ].join("\n");
  }

  return null;
}
