import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildDbUrl,
  formatLinkedProfilesLabel,
  getAlternateDbPort,
  getDbPortsWithFallback,
  maskSecret,
  normalizeProjectLink,
  suggestProfileName,
  type ProjectContext,
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
    pruneAfterDeploy: false,
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
      "postgresql://postgres.your-tenant-id:db%2Fp%40ss@203.0.113.10:5453/postgres?sslmode=disable",
    );
    assert.equal(
      typesUrl,
      "postgresql://postgres.your-tenant-id:db%2Fp%40ss@203.0.113.10:6438/postgres?sslmode=disable",
    );
  });

  it("honors an explicit port override", () => {
    assert.equal(
      buildDbUrl(sampleConfig, "push", { port: 6438 }),
      "postgresql://postgres.your-tenant-id:db%2Fp%40ss@203.0.113.10:6438/postgres?sslmode=disable",
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

describe("normalizeProjectLink", () => {
  it("upgrades a legacy single-profile link", () => {
    const result = normalizeProjectLink({ profile: "development" });
    assert.equal(result?.profiles.length, 1);
    assert.equal(result?.profiles[0], "development");
    assert.equal(result?.activeProfile, "development");
    assert.equal(result?.profile, "development");
    assert.ok(typeof result?.projectId === "string" && result.projectId.length > 0);
  });

  it("keeps multiple profiles and an active selection", () => {
    const result = normalizeProjectLink({
      profiles: ["development", "production"],
      activeProfile: "production",
      projectId: "test-uuid-123",
    });
    assert.deepEqual(result, {
      profiles: ["development", "production"],
      activeProfile: "production",
      profile: "production",
      projectId: "test-uuid-123",
    });
  });

  it("falls back to the first profile when active is missing from the set", () => {
    const result = normalizeProjectLink({
      profiles: ["development", "production"],
      activeProfile: "staging",
    });
    assert.equal(result?.activeProfile, "development");
    assert.equal(result?.profiles.length, 2);
    assert.ok(typeof result?.projectId === "string");
  });

  it("returns null for empty links", () => {
    assert.equal(normalizeProjectLink({}), null);
    assert.equal(normalizeProjectLink(null), null);
  });
});

describe("formatLinkedProfilesLabel", () => {
  it("describes unlinked projects", () => {
    const context: ProjectContext = {
      cwd: "/tmp/app",
      projectRoot: "/tmp/app",
      profile: "app",
      profiles: [],
      activeProfile: null,
      isLinked: false,
      suggestedProfileName: "app",
    };
    assert.match(formatLinkedProfilesLabel(context), /not linked/);
  });

  it("shows active and additional environments", () => {
    const context: ProjectContext = {
      cwd: "/tmp/app",
      projectRoot: "/tmp/app",
      profile: "development",
      profiles: ["development", "production"],
      activeProfile: "development",
      isLinked: true,
      suggestedProfileName: "app",
    };
    assert.equal(
      formatLinkedProfilesLabel(context),
      "development  ·  also: production",
    );
  });
});
