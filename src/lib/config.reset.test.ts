import { describe, it, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  resetProjectSetup,
  saveConfig,
  type ResetResult,
  type SupabaseSelfhostedConfig,
} from "./config.js";

let tempProjectDir: string;
let projectId: string;

function configHome(): string {
  return path.join(os.homedir(), ".supabase-selfhosted-cli");
}

function tempEnvironment(name: string): SupabaseSelfhostedConfig {
  return {
    environment: name,
    target: "ssh",
    ssh: { user: "root", host: "example.com", password: "secret" },
    functions: { localPath: "supabase/functions", remotePath: "/tmp/functions" },
    database: {
      tenantId: "test",
      password: "test",
      host: "localhost",
      pushPort: 5432,
      typesPort: 5432,
      database: "postgres",
    },
    deploy: {
      restartAfterDeploy: true,
      restartCommand: "",
      pruneAfterDeploy: false,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function writeProjectLinkFile(projectRoot: string, id: string): void {
  const link = {
    environments: ["dev", "prod"],
    projectId: id,
  };
  fs.writeFileSync(
    path.join(projectRoot, ".supabase-selfhosted-cli.json"),
    `${JSON.stringify(link, null, 2)}\n`,
  );
}

beforeEach(() => {
  projectId = `test-reset-${crypto.randomUUID()}`;
  tempProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), "reset-project-"));
});

afterEach(() => {
  try {
    fs.rmSync(tempProjectDir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }

  try {
    const profilesDir = path.join(configHome(), "profiles", projectId);
    if (fs.existsSync(profilesDir)) {
      fs.rmSync(profilesDir, { recursive: true, force: true });
    }
  } catch {
    /* best-effort */
  }
});

describe("resetProjectSetup", () => {
  it("deletes all environment files, the link file, and the registry entry", () => {
    saveConfig(tempEnvironment("dev"), projectId);
    saveConfig(tempEnvironment("prod"), projectId);
    writeProjectLinkFile(tempProjectDir, projectId);

    const profilesDir = path.join(configHome(), "profiles", projectId);

    assert.ok(fs.existsSync(path.join(profilesDir, "dev.json")), "dev fixture should exist");
    assert.ok(fs.existsSync(path.join(profilesDir, "prod.json")), "prod fixture should exist");
    assert.ok(
      fs.existsSync(path.join(tempProjectDir, ".supabase-selfhosted-cli.json")),
      "link file should exist",
    );

    const result: ResetResult = resetProjectSetup(tempProjectDir);

    assert.deepEqual(result.environmentsRemoved.sort(), ["dev", "prod"]);
    assert.equal(result.linkFileDeleted, true);
    assert.equal(result.registryEntryRemoved, true);

    assert.ok(!fs.existsSync(profilesDir), "environments directory should be deleted");
    assert.ok(
      !fs.existsSync(path.join(tempProjectDir, ".supabase-selfhosted-cli.json")),
      "link file should be deleted",
    );

    const registryPath = path.join(configHome(), "projects.json");
    if (fs.existsSync(registryPath)) {
      const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
      const stillPresent = registry.projects.some(
        (p: Record<string, unknown>) => p.projectId === projectId,
      );
      assert.equal(stillPresent, false, "project should not appear in the registry");
    }
  });

  it("handles a project with no link file gracefully", () => {
    const result: ResetResult = resetProjectSetup(tempProjectDir);

    assert.deepEqual(result.environmentsRemoved, []);
    assert.equal(result.linkFileDeleted, false);
    assert.equal(result.registryEntryRemoved, false);
  });

  it("handles a project with a link file but no namespaced environment files", () => {
    writeProjectLinkFile(tempProjectDir, projectId);

    const result: ResetResult = resetProjectSetup(tempProjectDir);

    assert.deepEqual(result.environmentsRemoved, []);
    assert.equal(result.linkFileDeleted, true);
  });

  it("does not crash when the namespaced environments directory exists but is empty", () => {
    writeProjectLinkFile(tempProjectDir, projectId);
    const profilesDir = path.join(configHome(), "profiles", projectId);
    fs.mkdirSync(profilesDir, { recursive: true });

    const result: ResetResult = resetProjectSetup(tempProjectDir);

    assert.deepEqual(result.environmentsRemoved, []);
    assert.equal(result.linkFileDeleted, true);
    assert.ok(!fs.existsSync(profilesDir), "empty environments directory should be removed");
  });
});
