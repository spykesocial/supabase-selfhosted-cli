import path from "node:path";
import { confirm, select } from "@inquirer/prompts";
import {
  deleteConfig,
  formatConfigSummary,
  formatProfileTargetSummary,
  formatProjectContextSummary,
  listProfiles,
  listRegisteredProjects,
  loadConfig,
  removeProjectLink,
  resolveProjectContext,
  saveProjectLink,
  type ProjectEntry,
} from "../lib/config.js";
import {
  logError,
  logReview,
  logSuccess,
  logWarning,
  printSummaryBlock,
} from "../lib/ui.js";
import { runSetup } from "./setup.js";

function formatProjectRow(entry: ProjectEntry): string {
  const config = loadConfig(entry.profile);
  const target = config ? formatProfileTargetSummary(config) : "(profile missing)";
  return `${entry.name} → ${entry.profile} (${target})`;
}

function printProjectsList(): void {
  const registered = listRegisteredProjects();
  const profiles = listProfiles();
  const cwd = process.cwd();
  const context = resolveProjectContext(cwd);

  printSummaryBlock("Current directory", ...formatProjectContextSummary(context).split("\n"));

  if (registered.length === 0) {
    logReview("No linked projects yet. Link this directory from the menu below.");
    console.log("");
  } else {
    console.log("Linked projects:");
    for (const entry of registered) {
      const marker = entry.path === context.projectRoot ? " (here)" : "";
      console.log(`  • ${formatProjectRow(entry)}${marker}`);
      console.log(`    ${entry.path}`);
    }
    console.log("");
  }

  const orphanProfiles = profiles.filter(
    (profile) => !registered.some((entry) => entry.profile === profile),
  );

  if (orphanProfiles.length > 0) {
    console.log("Profiles without a linked project directory:");
    for (const profile of orphanProfiles) {
      const config = loadConfig(profile);
      const target = config ? formatProfileTargetSummary(config) : "(missing config)";
      console.log(`  • ${profile} (${target})`);
    }
    console.log("");
  }
}

async function linkCurrentDirectory(): Promise<void> {
  const cwd = process.cwd();
  const context = resolveProjectContext(cwd);
  const profiles = listProfiles();

  const mode = await select({
    message: `Link ${path.basename(context.projectRoot)} to a profile`,
    choices: [
      {
        name: `Create new profile "${context.suggestedProfileName}"`,
        value: "create",
      },
      ...(profiles.length > 0
        ? [{ name: "Use an existing profile", value: "existing" as const }]
        : []),
      { name: "Cancel", value: "cancel" },
    ],
  });

  if (mode === "cancel") {
    return;
  }

  if (mode === "create") {
    await runSetup({
      profile: context.suggestedProfileName,
      linkProject: true,
    });
    return;
  }

  const profile = await select({
    message: "Choose a profile for this project",
    choices: profiles.map((name) => {
      const config = loadConfig(name);
      const target = config ? formatProfileTargetSummary(config) : "unknown target";
      return {
        name: `${name} (${target})`,
        value: name,
      };
    }),
  });

  saveProjectLink(cwd, profile);
  logSuccess(`Linked ${context.projectRoot} to profile "${profile}".`);
}

async function switchCurrentProfile(): Promise<void> {
  const cwd = process.cwd();
  const context = resolveProjectContext(cwd);
  const profiles = listProfiles();

  if (profiles.length === 0) {
    logError("No profiles found. Run `supabase-selfhosted-cli setup` first.");
    process.exitCode = 1;
    return;
  }

  const profile = await select({
    message: `Switch ${path.basename(context.projectRoot)} to profile`,
    choices: profiles.map((name) => {
      const config = loadConfig(name);
      const target = config ? formatProfileTargetSummary(config) : "unknown target";
      const current = name === context.profile && context.isLinked ? " (current)" : "";
      return {
        name: `${name} (${target})${current}`,
        value: name,
      };
    }),
  });

  saveProjectLink(cwd, profile);
  logSuccess(`Switched ${context.projectRoot} to profile "${profile}".`);
}

async function editProfile(): Promise<void> {
  const cwd = process.cwd();
  const context = resolveProjectContext(cwd);
  const profiles = listProfiles();

  const profile =
    profiles.length === 0
      ? context.suggestedProfileName
      : await select({
          message: "Edit which profile?",
          choices: profiles.map((name) => ({
            name,
            value: name,
          })),
          default: context.isLinked ? context.profile : context.suggestedProfileName,
        });

  await runSetup({ profile, linkProject: true, forceUpdate: true });
}

async function deleteProfile(): Promise<void> {
  const profiles = listProfiles();

  if (profiles.length === 0) {
    logError("No profiles to delete.");
    process.exitCode = 1;
    return;
  }

  const profile = await select({
    message: "Delete which profile?",
    choices: profiles.map((name) => ({ name, value: name })),
  });

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

  const remaining = listProfiles();
  if (remaining.length === 0) {
    logReview("No profiles remain. Run `supabase-selfhosted-cli setup` to configure again.");
  }
}

async function unlinkCurrentDirectory(): Promise<void> {
  const cwd = process.cwd();
  const context = resolveProjectContext(cwd);

  if (!context.isLinked) {
    logWarning("This directory is not linked to a profile.");
    return;
  }

  const confirmed = await confirm({
    message: `Unlink ${path.basename(context.projectRoot)} from profile "${context.profile}"?`,
    default: false,
  });

  if (!confirmed) {
    logWarning("Cancelled.");
    return;
  }

  removeProjectLink(cwd);
  logSuccess(`Unlinked ${context.projectRoot}. Profile "${context.profile}" was kept.`);
}

async function showProfileDetails(): Promise<void> {
  const cwd = process.cwd();
  const context = resolveProjectContext(cwd);
  const config = loadConfig(context.profile);

  if (!config) {
    logError(
      context.isLinked
        ? `Profile "${context.profile}" is linked but missing. Run setup to recreate it.`
        : `No profile linked. Run setup or link this directory to a profile.`,
    );
    process.exitCode = 1;
    return;
  }

  printSummaryBlock(
    "Profile details",
    ...formatProjectContextSummary(context).split("\n"),
    "",
    ...formatConfigSummary(config).split("\n"),
  );
}

export async function runProjects(options?: {
  list?: boolean;
  link?: boolean;
  switch?: boolean;
  edit?: boolean;
  delete?: boolean;
  unlink?: boolean;
  show?: boolean;
  profile?: string;
}): Promise<void> {
  if (options?.list) {
    printProjectsList();
    return;
  }

  if (options?.link) {
    await linkCurrentDirectory();
    return;
  }

  if (options?.switch) {
    await switchCurrentProfile();
    return;
  }

  if (options?.edit) {
    await editProfile();
    return;
  }

  if (options?.delete) {
    await deleteProfile();
    return;
  }

  if (options?.unlink) {
    await unlinkCurrentDirectory();
    return;
  }

  if (options?.show) {
    await showProfileDetails();
    return;
  }

  const action = await select({
    message: "Projects",
    choices: [
      { name: "List linked projects and profiles", value: "list" },
      { name: "Link this directory to a profile", value: "link" },
      { name: "Switch this directory to a different profile", value: "switch" },
      { name: "Show profile details for this directory", value: "show" },
      { name: "Edit profile credentials", value: "edit" },
      { name: "Unlink this directory (keep profile)", value: "unlink" },
      { name: "Delete a stored profile", value: "delete" },
      { name: "Cancel", value: "cancel" },
    ],
  });

  if (action === "cancel") {
    return;
  }

  switch (action) {
    case "list":
      await runProjects({ list: true, profile: options?.profile });
      break;
    case "link":
      await runProjects({ link: true, profile: options?.profile });
      break;
    case "switch":
      await runProjects({ switch: true, profile: options?.profile });
      break;
    case "show":
      await runProjects({ show: true, profile: options?.profile });
      break;
    case "edit":
      await runProjects({ edit: true, profile: options?.profile });
      break;
    case "unlink":
      await runProjects({ unlink: true, profile: options?.profile });
      break;
    case "delete":
      await runProjects({ delete: true, profile: options?.profile });
      break;
    default:
      break;
  }
}
