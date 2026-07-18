import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseSelfhostedConfig } from "./config.js";
import { withDbPortFallback } from "./supabase-runner.js";

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

describe("withDbPortFallback", () => {
  it("uses the primary port when it succeeds", async () => {
    const ports: number[] = [];
    const result = await withDbPortFallback(sampleConfig, "push", async (_url, port) => {
      ports.push(port);
      return "ok";
    });

    assert.equal(result, "ok");
    assert.deepEqual(ports, [5453]);
  });

  it("retries with the other configured port after primary failure", async () => {
    const ports: number[] = [];
    const result = await withDbPortFallback(sampleConfig, "push", async (_url, port) => {
      ports.push(port);
      if (port === 5453) {
        throw new Error("primary failed");
      }
      return "recovered";
    });

    assert.equal(result, "recovered");
    assert.deepEqual(ports, [5453, 6438]);
  });

  it("rethrows when both ports fail", async () => {
    await assert.rejects(
      () =>
        withDbPortFallback(sampleConfig, "types", async () => {
          throw new Error("still down");
        }),
      /still down/,
    );
  });
});
