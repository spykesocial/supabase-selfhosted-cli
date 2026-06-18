import { confirm, select } from "@inquirer/prompts";
import {
  deleteConfig,
  formatConfigSummary,
  listProfiles,
  loadConfig,
  resolveProfile,
} from "../lib/config.js";
import { logError, logReview, logSuccess, logWarning, printSummaryBlock } from "../lib/ui.js";
import { runSetup } from "./setup.js";

export async function runSettings(options?: { profile?: string }): Promise<void> {
  const cwd = process.cwd();
  const profile = resolveProfile(cwd, options?.profile);
  const config = loadConfig(profile);

  if (!config) {
    logError(
      `No profile "${profile}" found. Run \`supabase-selfhosted-cli setup\` first.`,
    );
    process.exitCode = 1;
    return;
  }

  const action = await select({
    message: "Settings",
    choices: [
      { name: "Show current configuration", value: "show" },
      { name: "Re-run setup wizard (update credentials)", value: "setup" },
      { name: "Delete stored credentials for this profile", value: "delete" },
      { name: "Cancel", value: "cancel" },
    ],
  });

  if (action === "cancel") {
    return;
  }

  if (action === "show") {
    printSummaryBlock("Current configuration", ...formatConfigSummary(config).split("\n"));
    return;
  }

  if (action === "setup") {
    await runSetup({ profile, linkProject: true, forceUpdate: true });
    return;
  }

  if (action === "delete") {
    const profiles = listProfiles();
    const confirmed = await confirm({
      message: `Delete profile "${profile}" and remove stored passwords?`,
      default: false,
    });

    if (!confirmed) {
      logWarning("Cancelled.");
      return;
    }

    deleteConfig(profile);
    logSuccess(`Deleted profile "${profile}".`);

    if (profiles.length === 1) {
      logReview("No profiles remain. Run `supabase-selfhosted-cli setup` to configure again.");
    }
  }
}
