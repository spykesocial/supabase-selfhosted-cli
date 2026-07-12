import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseSelfhostedConfig } from "./config.js";
import {
  buildProjectScopedRestartCommand,
  extractComposeProjectId,
  isUnsafeGlobalRestartCommand,
  resolveRestartCommand,
  UNSAFE_GLOBAL_EDGE_RESTART,
} from "./restart-command.js";

function baseConfig(
  overrides: Partial<SupabaseSelfhostedConfig> = {},
): SupabaseSelfhostedConfig {
  return {
    profile: "financial-wisdom-clientele",
    target: "ssh",
    ssh: { user: "root", host: "1.2.3.4", password: "secret" },
    functions: {
      localPath: "supabase/functions",
      remotePath:
        "/etc/dokploy/compose/financial-wisdom-supabase-oy2cqz/files/volumes/functions",
    },
    database: {
      tenantId: "tenant",
      password: "db",
      host: "1.2.3.4",
      pushPort: 5453,
      typesPort: 6438,
      database: "postgres",
    },
    deploy: {
      restartAfterDeploy: true,
      restartCommand: UNSAFE_GLOBAL_EDGE_RESTART,
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("extractComposeProjectId", () => {
  it("extracts Dokploy compose project id", () => {
    assert.equal(
      extractComposeProjectId(
        "/etc/dokploy/compose/financial-wisdom-supabase-oy2cqz/files/volumes/functions",
      ),
      "financial-wisdom-supabase-oy2cqz",
    );
  });

  it("extracts generic compose project id", () => {
    assert.equal(
      extractComposeProjectId("/opt/compose/my-stack/volumes/functions"),
      "my-stack",
    );
  });

  it("returns null for generic single-instance paths", () => {
    assert.equal(
      extractComposeProjectId("/etc/supabase/volumes/functions"),
      null,
    );
  });
});

describe("isUnsafeGlobalRestartCommand", () => {
  it("detects the historical default", () => {
    assert.equal(isUnsafeGlobalRestartCommand(UNSAFE_GLOBAL_EDGE_RESTART), true);
  });

  it("allows project-scoped commands", () => {
    const scoped = buildProjectScopedRestartCommand(
      "/etc/dokploy/compose/financial-wisdom-supabase-oy2cqz/files/volumes/functions",
    );
    assert.ok(scoped);
    assert.equal(isUnsafeGlobalRestartCommand(scoped), false);
  });
});

describe("buildProjectScopedRestartCommand", () => {
  it("requires the project id in the container name match", () => {
    const command = buildProjectScopedRestartCommand(
      "/etc/dokploy/compose/financial-wisdom-supabase-oy2cqz/files/volumes/functions",
    );
    assert.ok(command);
    assert.match(command, /grep -F 'financial-wisdom-supabase-oy2cqz'/);
    assert.match(command, /No edge-functions container matched project/);
    assert.doesNotMatch(command, /grep -i edge \| head -n 1 \| xargs/);
  });
});

describe("resolveRestartCommand", () => {
  it("auto-scopes unsafe defaults using the functions path", () => {
    const resolved = resolveRestartCommand(baseConfig());
    assert.equal(resolved.autoScoped, true);
    assert.equal(resolved.projectId, "financial-wisdom-supabase-oy2cqz");
    assert.match(resolved.command, /financial-wisdom-supabase-oy2cqz/);
    assert.doesNotMatch(
      resolved.command,
      /samco-water-tech|grep -i edge \| head -n 1 \| xargs/,
    );
  });

  it("keeps an explicit custom restart command", () => {
    const custom = "docker restart financial-wisdom-supabase-oy2cqz-supabase-edge-functions";
    const resolved = resolveRestartCommand(
      baseConfig({
        deploy: { restartAfterDeploy: true, restartCommand: custom },
      }),
    );
    assert.equal(resolved.autoScoped, false);
    assert.equal(resolved.command, custom);
  });

  it("throws when unsafe default cannot be scoped", () => {
    assert.throws(
      () =>
        resolveRestartCommand(
          baseConfig({
            functions: {
              localPath: "supabase/functions",
              remotePath: "/etc/supabase/volumes/functions",
            },
          }),
        ),
      /unsafe with multiple projects/i,
    );
  });
});
