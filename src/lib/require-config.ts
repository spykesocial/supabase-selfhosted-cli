import { loadConfig, resolveProjectContext } from "./config.js";
import { logError, logWarning } from "./ui.js";

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
      if (context.profiles.length > 0) {
        logError(`Linked profiles for this project: ${context.profiles.join(", ")}`);
      }
    }
    process.exitCode = 1;
    return null;
  }

  if (
    profile &&
    context.profiles.length > 0 &&
    !context.profiles.includes(profile)
  ) {
    logWarning(
      `Profile "${profile}" is not linked to this project (linked: ${context.profiles.join(", ")}). Using it for this command only.`,
    );
  }

  return config;
}
