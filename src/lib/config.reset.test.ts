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

function tempProfile(name: string): SupabaseSelfhostedConfig {
  return {
    profile: name,
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
    profiles: ["dev", "prod"],
    activeProfile: "dev",
    profile: "dev",
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
  it("deletes all profile files, the link file, and the registry entry", () => {
    saveConfig(tempProfile("dev"), projectId);
    saveConfig(tempProfile("prod"), projectId);
    writeProjectLinkFile(tempProjectDir, projectId);

    const profilesDir = path.join(configHome(), "profiles", projectId);

    assert.ok(fs.existsSync(path.join(profilesDir, "dev.json")), "dev fixture should exist");
    assert.ok(fs.existsSync(path.join(profilesDir, "prod.json")), "prod fixture should exist");
    assert.ok(
      fs.existsSync(path.join(tempProjectDir, ".supabase-selfhosted-cli.json")),
      "link file should exist",
    );

    const result: ResetResult = resetProjectSetup(tempProjectDir);

    assert.deepEqual(result.profilesRemoved.sort(), ["dev", "prod"]);
    assert.equal(result.linkFileDeleted, true);
    assert.equal(result.registryEntryRemoved, true);

    assert.ok(!fs.existsSync(profilesDir), "profiles directory should be deleted");
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

    assert.deepEqual(result.profilesRemoved, []);
    assert.equal(result.linkFileDeleted, false);
    assert.equal(result.registryEntryRemoved, false);
  });

  it("handles a project with a link file but no namespaced profile files", () => {
    writeProjectLinkFile(tempProjectDir, projectId);

    const result: ResetResult = resetProjectSetup(tempProjectDir);

    assert.deepEqual(result.profilesRemoved, []);
    assert.equal(result.linkFileDeleted, true);
  });

  it("does not crash when the namespaced profiles directory exists but is empty", () => {
    writeProjectLinkFile(tempProjectDir, projectId);
    const profilesDir = path.join(configHome(), "profiles", projectId);
    fs.mkdirSync(profilesDir, { recursive: true });

    const result: ResetResult = resetProjectSetup(tempProjectDir);

    assert.deepEqual(result.profilesRemoved, []);
    assert.equal(result.linkFileDeleted, true);
    assert.ok(!fs.existsSync(profilesDir), "empty profiles directory should be removed");
  });
});
