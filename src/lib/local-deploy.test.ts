import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { deployFunctionsLocal } from "./local-deploy.js";
import type { SupabaseSelfhostedConfig } from "./config.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "selfhosted-cli-test-"));
const localFunctionsDir = path.join(tempRoot, "functions-src");
const targetFunctionsDir = path.join(tempRoot, "functions-dest");

const config: SupabaseSelfhostedConfig = {
  profile: "test",
  target: "local",
  ssh: { user: "", host: "", password: "" },
  functions: {
    localPath: "supabase/functions",
    remotePath: targetFunctionsDir,
  },
  database: {
    tenantId: "test",
    password: "test",
    host: "127.0.0.1",
    pushPort: 5432,
    typesPort: 5432,
    database: "postgres",
  },
  deploy: {
    restartAfterDeploy: false,
    restartCommand: "",
  },
  createdAt: "2026-06-18T00:00:00.000Z",
  updatedAt: "2026-06-18T00:00:00.000Z",
};

before(() => {
  fs.mkdirSync(path.join(localFunctionsDir, "main"), { recursive: true });
  fs.writeFileSync(path.join(localFunctionsDir, "main", "index.ts"), "export {};\n");
  fs.mkdirSync(path.join(targetFunctionsDir, "stale-fn"), { recursive: true });
  fs.writeFileSync(path.join(targetFunctionsDir, "stale-fn", "index.ts"), "stale\n");
});

after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("deployFunctionsLocal", () => {
  it("copies local functions to the destination path", async () => {
    await deployFunctionsLocal(config, localFunctionsDir);
    assert.equal(
      fs.readFileSync(path.join(targetFunctionsDir, "main", "index.ts"), "utf8"),
      "export {};\n",
    );
  });

  it("prunes destination-only folders when --prune is used", async () => {
    await deployFunctionsLocal(config, localFunctionsDir, { prune: true });
    assert.equal(fs.existsSync(path.join(targetFunctionsDir, "stale-fn")), false);
    assert.equal(fs.existsSync(path.join(targetFunctionsDir, "main", "index.ts")), true);
  });
});
