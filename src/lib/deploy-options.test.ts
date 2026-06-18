import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveShouldRestart } from "./deploy-options.js";
import type { SupabaseSelfhostedConfig } from "./config.js";

const baseConfig = {
  profile: "default",
  target: "ssh",
  deploy: {
    restartAfterDeploy: true,
    restartCommand: "docker restart edge",
  },
} as SupabaseSelfhostedConfig;

describe("resolveShouldRestart", () => {
  it("forces restart when --restart is passed", () => {
    assert.equal(resolveShouldRestart(baseConfig, { restart: true }), true);
  });

  it("skips restart when --no-restart is passed", () => {
    assert.equal(resolveShouldRestart(baseConfig, { restart: false }), false);
  });

  it("prompts with yes default when restart-after-deploy is enabled", () => {
    assert.equal(resolveShouldRestart(baseConfig), "prompt-default-yes");
  });

  it("prompts with no default when restart-after-deploy is disabled", () => {
    const config = {
      ...baseConfig,
      deploy: { ...baseConfig.deploy, restartAfterDeploy: false },
    };
    assert.equal(resolveShouldRestart(config), "prompt-default-no");
  });
});
