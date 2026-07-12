import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseSelfhostedConfig } from "./config.js";
import {
  buildProjectScopedRestartCommand,
  extractComposeProjectId,
  isGeneratedRestartCommand,
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
    assert.equal(isGeneratedRestartCommand(scoped), true);
  });
});

describe("buildProjectScopedRestartCommand", () => {
  it("discovers the container by functions mount path, not folder id in the name", () => {
    const command = buildProjectScopedRestartCommand(
      "/etc/dokploy/compose/financial-wisdom-supabase-oy2cqz/files/volumes/functions",
    );
    assert.ok(command);
    assert.match(
      command,
      /path='\/etc\/dokploy\/compose\/financial-wisdom-supabase-oy2cqz\/files\/volumes\/functions'/,
    );
    assert.match(command, /docker inspect/);
    assert.match(command, /grep -qxF "\$path"/);
    assert.match(command, /No edge-functions container mounts functions path/);
    // Must not rely on Dokploy folder id matching the container name
    // (oy2cqz folder vs 8rcgv9 container prefix on real hosts).
    assert.doesNotMatch(command, /grep -F 'financial-wisdom-supabase-oy2cqz'/);
  });
});

describe("resolveRestartCommand", () => {
  it("auto-scopes unsafe defaults using the functions mount path", () => {
    const resolved = resolveRestartCommand(baseConfig());
    assert.equal(resolved.autoScoped, true);
    assert.equal(resolved.projectId, "financial-wisdom-supabase-oy2cqz");
    assert.match(resolved.command, /docker inspect/);
    assert.match(
      resolved.command,
      /financial-wisdom-supabase-oy2cqz\/files\/volumes\/functions/,
    );
  });

  it("upgrades old name-based generated commands to mount discovery", () => {
    const oldNameBased = [
      "name=$(docker ps --format '{{.Names}}' | grep -F 'financial-wisdom-supabase-oy2cqz' | grep -iE 'edge|functions' | head -n 1)",
      "[ -n \"$name\" ] || { echo \"No edge-functions container matched project 'financial-wisdom-supabase-oy2cqz'\" >&2; exit 1; }",
      'echo "Restarting $name"',
      'docker restart "$name"',
    ].join("; ");

    const resolved = resolveRestartCommand(
      baseConfig({
        deploy: { restartAfterDeploy: true, restartCommand: oldNameBased },
      }),
    );

    assert.equal(resolved.autoScoped, true);
    assert.match(resolved.command, /docker inspect/);
    assert.doesNotMatch(resolved.command, /matched project/);
  });

  it("keeps an explicit custom restart command", () => {
    const custom =
      "docker restart financial-wisdom-supabase-8rcgv9-supabase-edge-functions";
    const resolved = resolveRestartCommand(
      baseConfig({
        deploy: { restartAfterDeploy: true, restartCommand: custom },
      }),
    );
    assert.equal(resolved.autoScoped, false);
    assert.equal(resolved.command, custom);
  });

  it("scopes generic absolute functions paths via mount discovery", () => {
    const resolved = resolveRestartCommand(
      baseConfig({
        functions: {
          localPath: "supabase/functions",
          remotePath: "/etc/supabase/volumes/functions",
        },
      }),
    );
    assert.equal(resolved.autoScoped, true);
    assert.match(resolved.command, /path='\/etc\/supabase\/volumes\/functions'/);
  });
});
