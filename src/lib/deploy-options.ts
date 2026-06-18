import type { SupabaseSelfhostedConfig } from "./config.js";

export type FunctionsDeployOptions = {
  profile?: string;
  restart?: boolean;
  prune?: boolean;
};

export function resolveShouldRestart(
  config: SupabaseSelfhostedConfig,
  options?: Pick<FunctionsDeployOptions, "restart">,
): boolean | "prompt-default-yes" | "prompt-default-no" {
  if (options?.restart === true) {
    return true;
  }

  if (options?.restart === false) {
    return false;
  }

  return config.deploy.restartAfterDeploy ? "prompt-default-yes" : "prompt-default-no";
}
