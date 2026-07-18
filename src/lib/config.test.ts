import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildDbUrl,
  getAlternateDbPort,
  getDbPortsWithFallback,
  maskSecret,
  suggestProfileName,
  type SupabaseSelfhostedConfig,
} from "./config.js";

const sampleConfig: SupabaseSelfhostedConfig = {
  profile: "default",
  target: "ssh",
  ssh: {
    user: "root",
    host: "203.0.113.10",
    password: "ssh-secret",
  },
  functions: {
    localPath: "supabase/functions",
    remotePath: "/etc/supabase/volumes/functions",
  },
  database: {
    tenantId: "your-tenant-id",
    password: "db/p@ss",
    host: "203.0.113.10",
    pushPort: 5453,
    typesPort: 6438,
    database: "postgres",
  },
  deploy: {
    restartAfterDeploy: true,
    restartCommand: "docker restart edge-runtime",
  },
  createdAt: "2026-06-18T00:00:00.000Z",
  updatedAt: "2026-06-18T00:00:00.000Z",
};

describe("buildDbUrl", () => {
  it("builds push and types URLs with encoded password", () => {
    const pushUrl = buildDbUrl(sampleConfig, "push");
    const typesUrl = buildDbUrl(sampleConfig, "types");

    assert.equal(
      pushUrl,
      "postgresql://postgres.your-tenant-id:db%2Fp%40ss@203.0.113.10:5453/postgres",
    );
    assert.equal(
      typesUrl,
      "postgresql://postgres.your-tenant-id:db%2Fp%40ss@203.0.113.10:6438/postgres",
    );
  });

  it("honors an explicit port override", () => {
    assert.equal(
      buildDbUrl(sampleConfig, "push", { port: 6438 }),
      "postgresql://postgres.your-tenant-id:db%2Fp%40ss@203.0.113.10:6438/postgres",
    );
  });
});

describe("getDbPortsWithFallback", () => {
  it("returns primary then alternate when ports differ", () => {
    assert.deepEqual(getDbPortsWithFallback(sampleConfig, "push"), [5453, 6438]);
    assert.deepEqual(getDbPortsWithFallback(sampleConfig, "types"), [6438, 5453]);
    assert.equal(getAlternateDbPort(sampleConfig, "push"), 6438);
  });

  it("omits fallback when both ports are the same", () => {
    const samePorts = {
      ...sampleConfig,
      database: { ...sampleConfig.database, pushPort: 5432, typesPort: 5432 },
    };
    assert.deepEqual(getDbPortsWithFallback(samePorts, "push"), [5432]);
    assert.equal(getAlternateDbPort(samePorts, "types"), undefined);
  });
});

describe("maskSecret", () => {
  it("masks secrets without exposing full value", () => {
    assert.equal(maskSecret("ab"), "****");
    assert.match(maskSecret("super-secret-password"), /^su\*+rd$/);
  });
});

describe("suggestProfileName", () => {
  it("derives a safe profile name from the directory basename", () => {
    assert.equal(
      suggestProfileName("/Users/dev/Documents/GitHub/supabase-keepalive"),
      "supabase-keepalive",
    );
    assert.equal(
      suggestProfileName("/Users/dev/My Cool Project"),
      "my-cool-project",
    );
  });
});

describe("loadConfig normalization", () => {
  it("defaults missing target to ssh", () => {
    const normalized = { ...sampleConfig, target: sampleConfig.target ?? "ssh" };
    assert.equal(normalized.target, "ssh");
  });
});
