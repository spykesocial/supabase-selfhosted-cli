import { loadConfig, resolveProjectContext } from "./config.js";
import { logError } from "./ui.js";

export async function requireConfig(profile?: string) {
  const cwd = process.cwd();
  const context = resolveProjectContext(cwd, profile);
  const resolvedProfile = context.profile;
  const config = loadConfig(resolvedProfile);

  if (!config) {
    if (!context.isLinked && !profile) {
      logError(
        `This directory (${context.projectRoot}) is not linked to a Supabase profile.`,
      );
      logError(
        `Run \`supabase-selfhosted-cli projects\` to link it or \`supabase-selfhosted-cli setup\` to create profile "${context.suggestedProfileName}".`,
      );
    } else {
      logError(
        `No profile "${resolvedProfile}" found. Run \`supabase-selfhosted-cli setup -p ${resolvedProfile}\` first.`,
      );
    }
    process.exitCode = 1;
    return null;
  }

  return config;
}
