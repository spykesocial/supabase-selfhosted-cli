import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dbErrorHint,
  findContainerByPort,
  grantCreateSql,
  parseDbUrl,
  rankDbCandidates,
} from "./db-access.js";

const ctx = { role: "postgres", database: "postgres" };

describe("grantCreateSql", () => {
  it("quotes identifiers and escapes embedded quotes", () => {
    assert.equal(
      grantCreateSql("postgres", "postgres"),
      `GRANT CREATE ON DATABASE "postgres" TO "postgres";`,
    );
    assert.equal(
      grantCreateSql('we"ird', "db"),
      `GRANT CREATE ON DATABASE "db" TO "we""ird";`,
    );
  });
});

describe("parseDbUrl", () => {
  it("names the role a Supavisor tenant login connects as", () => {
    assert.deepEqual(
      parseDbUrl(
        "postgresql://postgres.03fe3192-86ac-41af-872a-fc0afe6b2d16:pw@host:5434/postgres?sslmode=disable",
      ),
      { role: "postgres", database: "postgres" },
    );
  });

  it("keeps plain logins and non-default databases as given", () => {
    assert.deepEqual(parseDbUrl("postgresql://alice:pw@host:5432/acme"), {
      role: "alice",
      database: "acme",
    });
  });

  it("falls back safely on garbage", () => {
    assert.deepEqual(parseDbUrl("not a url"), {
      role: "postgres",
      database: "postgres",
    });
  });
});

describe("findContainerByPort", () => {
  const ps = [
    "financial-wisdom-supabase-8rcgv9-supabase-db|0.0.0.0:5433->5432/tcp, :::5433->5432/tcp",
    "bni-supabase-vsuly4-supavisor-1|0.0.0.0:5434->5432/tcp, 0.0.0.0:6434->6543/tcp",
  ].join("\n");

  it("matches on the published port, whatever the name looks like", () => {
    assert.equal(findContainerByPort(ps, 5434), "bni-supabase-vsuly4-supavisor-1");
    assert.equal(findContainerByPort(ps, 6434), "bni-supabase-vsuly4-supavisor-1");
    assert.equal(findContainerByPort(ps, 5433), "financial-wisdom-supabase-8rcgv9-supabase-db");
  });

  it("never matches a port that is only a prefix of another", () => {
    assert.equal(findContainerByPort(ps, 543), null);
    assert.equal(findContainerByPort(ps, 434), null);
  });

  it("returns null when nothing publishes the port", () => {
    assert.equal(findContainerByPort(ps, 5999), null);
    assert.equal(findContainerByPort("", 5434), null);
  });
});

describe("rankDbCandidates", () => {
  it("keeps the port container first, then database-named siblings", () => {
    assert.deepEqual(
      rankDbCandidates("bni-supabase-vsuly4-supavisor-1", [
        "bni-supabase-vsuly4-kong-1",
        "bni-supabase-vsuly4-db-1",
        "bni-supabase-vsuly4-supavisor-1",
      ]),
      [
        "bni-supabase-vsuly4-supavisor-1",
        "bni-supabase-vsuly4-db-1",
        "bni-supabase-vsuly4-kong-1",
      ],
    );
  });

  it("dedupes and trims without inventing candidates", () => {
    assert.deepEqual(rankDbCandidates(null, [" db-1 ", "db-1", "kong"]), [
      "db-1",
      "kong",
    ]);
    assert.deepEqual(rankDbCandidates("solo", []), ["solo"]);
  });
});

describe("dbErrorHint", () => {
  it("explains the migration-table permission failure with the exact grant", () => {
    const hint = dbErrorHint(
      "failed to create migration table: ERROR: permission denied for database postgres (SQLSTATE 42501)",
      ctx,
    );
    assert.ok(hint);
    assert.match(hint, /supabase\/cli#3531/);
    assert.match(hint, /GRANT CREATE ON DATABASE "postgres" TO "postgres";/);
  });

  it("explains the schema-level variant", () => {
    const hint = dbErrorHint(
      "failed to create migration table: ERROR: permission denied for schema supabase_migrations (SQLSTATE 42501)",
      ctx,
    );
    assert.ok(hint);
    assert.match(hint, /GRANT CREATE, USAGE ON SCHEMA supabase_migrations TO "postgres";/);
  });

  it("explains the Supavisor prepared-statement clash", () => {
    const hint = dbErrorHint(
      `failed to parse rows: ERROR: prepared statement "lrupsc_1_0" already exists (SQLSTATE 42P05)`,
      ctx,
    );
    assert.ok(hint);
    assert.match(hint, /transaction pooling/);
    assert.match(hint, /migration port/);
  });

  it("explains the TLS refusal of bare supabase CLI runs", () => {
    const hint = dbErrorHint("tls error: server refused TLS connection", ctx);
    assert.ok(hint);
    assert.match(hint, /PGSSLMODE=disable/);
  });

  it("stays quiet on anything it does not know", () => {
    assert.equal(dbErrorHint("relation \"foo\" does not exist", ctx), null);
    assert.equal(dbErrorHint("", ctx), null);
  });
});
