import { loadConfig, resolveProfile } from "./config.js";
import { logError } from "./ui.js";

export async function requireConfig(profile?: string) {
  const cwd = process.cwd();
  const resolvedProfile = resolveProfile(cwd, profile);
  const config = loadConfig(resolvedProfile);

  if (!config) {
    logError(
      `No profile "${resolvedProfile}" found. Run \`supabase-selfhosted-cli setup\` first.`,
    );
    process.exitCode = 1;
    return null;
  }

  return config;
}
