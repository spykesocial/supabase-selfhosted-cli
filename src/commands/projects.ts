import path from "node:path";
import { confirm, select } from "@inquirer/prompts";
import {
  addProjectProfile,
  deleteConfig,
  formatConfigSummary,
  formatLinkedProfilesLabel,
  formatProfileTargetSummary,
  formatProjectContextSummary,
  listProfiles,
  listRegisteredProjects,
  loadConfig,
  removeProjectLink,
  removeProjectProfile,
  resolveProjectContext,
  setActiveProjectProfile,
  type ProjectEntry,
} from "../lib/config.js";
import { promptEnvironmentProfileName } from "../lib/profile-prompt.js";
import {
  logError,
  logInfo,
  logReview,
  logSuccess,
  logWarning,
  paint,
  printSummaryBlock,
} from "../lib/ui.js";
import { runSetup } from "./setup.js";

function formatProjectRow(entry: ProjectEntry): string {
  const profiles = entry.profiles?.length ? entry.profiles : [entry.profile];
  const active = entry.activeProfile ?? entry.profile;
  const config = loadConfig(active);
  const target = config ? formatProfileTargetSummary(config) : "(profile missing)";
  const envLabel =
    profiles.length === 1
      ? active
      : `${active} (active) · ${profiles.filter((name) => name !== active).join(", ")}`;
  return `${entry.name} → ${envLabel} · ${target}`;
}

function profileChoiceLabel(name: string, active?: string | null): string {
  const config = loadConfig(name);
  const target = config ? formatProfileTargetSummary(config) : "missing credentials";
  const marker = name === active ? " ★ active" : "";
  return `${name}${marker}  ·  ${target}`;
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
    console.log(paint("Linked projects", "blue"));
    for (const entry of registered) {
      const marker = entry.path === context.projectRoot ? " (here)" : "";
      console.log(`  • ${formatProjectRow(entry)}${marker}`);
      console.log(`    ${entry.path}`);
    }
    console.log("");
  }

  const linkedNames = new Set(
    registered.flatMap((entry) =>
      entry.profiles?.length ? entry.profiles : [entry.profile],
    ),
  );
  const orphanProfiles = profiles.filter((profile) => !linkedNames.has(profile));

  if (orphanProfiles.length > 0) {
    console.log(paint("Profiles not linked to any project", "blue"));
    for (const profile of orphanProfiles) {
      const config = loadConfig(profile);
      const target = config ? formatProfileTargetSummary(config) : "(missing config)";
      console.log(`  • ${profile} (${target})`);
    }
    console.log("");
  }
}

async function linkOrSetupProfile(
  cwd: string,
  profileName: string,
  context: ReturnType<typeof resolveProjectContext>,
): Promise<void> {
  if (context.profiles.includes(profileName)) {
    logWarning(`"${profileName}" is already linked to this project.`);
    const makeActive = await confirm({
      message: `Make "${profileName}" the active profile?`,
      default: true,
    });
    if (makeActive) {
      setActiveProjectProfile(cwd, profileName);
      logSuccess(`Active profile is now "${profileName}".`);
    }
    return;
  }

  if (loadConfig(profileName)) {
    const makeActive =
      !context.isLinked ||
      (await confirm({
        message: `Make "${profileName}" the active profile for this project?`,
        default: true,
      }));
    addProjectProfile(cwd, profileName, { makeActive });
    const next = resolveProjectContext(cwd);
    logSuccess(
      makeActive
        ? `Linked "${profileName}" and set it as active.`
        : `Linked "${profileName}". Active remains "${next.activeProfile}".`,
    );
    logReview(`Environments: ${formatLinkedProfilesLabel(next)}`);
    return;
  }

  await runSetup({
    profile: profileName,
    linkProject: true,
  });
}

async function linkCurrentDirectory(): Promise<void> {
  const cwd = process.cwd();
  const context = resolveProjectContext(cwd);
  const profiles = listProfiles();
  const linked = new Set(context.profiles);

  logInfo(
    context.isLinked
      ? `Adding another environment to ${path.basename(context.projectRoot)} (active: ${context.activeProfile}).`
      : `Link ${path.basename(context.projectRoot)} to an environment profile.`,
  );

  const availableExisting = profiles.filter(
    (name) => !linked.has(name) && name !== "development" && name !== "production",
  );

  const defaultName = !linked.has("development")
    ? "development"
    : !linked.has("production")
      ? "production"
      : "development";

  const pick = await promptEnvironmentProfileName({
    message: context.isLinked
      ? "Which environment do you want to add?"
      : "Which environment profile do you want to link?",
    defaultName,
    allowCancel: true,
    offerExisting: availableExisting.length > 0,
    suggestedCustomName: context.suggestedProfileName,
  });

  if (pick.kind === "cancel") {
    return;
  }

  if (pick.kind === "existing") {
    const profile = await select({
      message: "Choose a profile to add",
      choices: availableExisting.map((name) => ({
        name: profileChoiceLabel(name, context.activeProfile),
        value: name,
      })),
    });
    await linkOrSetupProfile(cwd, profile, context);
    return;
  }

  await linkOrSetupProfile(cwd, pick.name, context);
}

async function switchCurrentProfile(): Promise<void> {
  const cwd = process.cwd();
  const context = resolveProjectContext(cwd);

  if (!context.isLinked || context.profiles.length === 0) {
    logError("This directory has no linked profiles yet.");
    logReview("Use Projects → Add environment, or run setup first.");
    process.exitCode = 1;
    return;
  }

  if (context.profiles.length === 1) {
    logWarning(
      `Only one environment is linked ("${context.profiles[0]}"). Add another (e.g. production) before switching.`,
    );
    const addAnother = await confirm({
      message: "Add another environment now?",
      default: true,
    });
    if (addAnother) {
      await linkCurrentDirectory();
    }
    return;
  }

  const profile = await select({
    message: `Switch active environment for ${path.basename(context.projectRoot)}`,
    choices: context.profiles.map((name) => ({
      name: profileChoiceLabel(name, context.activeProfile),
      value: name,
    })),
    default: context.activeProfile ?? context.profile,
  });

  setActiveProjectProfile(cwd, profile);
  logSuccess(`Active profile is now "${profile}".`);
  logReview("Commands without -p will use this environment.");
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
            name: profileChoiceLabel(name, context.activeProfile),
            value: name,
          })),
          default: context.activeProfile ?? context.suggestedProfileName,
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
    message: "Delete which profile? (removes stored passwords)",
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

  if (!context.isLinked || context.profiles.length === 0) {
    logWarning("This directory is not linked to any profile.");
    return;
  }

  if (context.profiles.length === 1) {
    const profile = context.profiles[0];
    const confirmed = await confirm({
      message: `Unlink ${path.basename(context.projectRoot)} from "${profile}"? (credentials kept)`,
      default: false,
    });

    if (!confirmed) {
      logWarning("Cancelled.");
      return;
    }

    removeProjectLink(cwd);
    logSuccess(`Unlinked ${context.projectRoot}. Profile "${profile}" was kept.`);
    return;
  }

  const mode = await select({
    message: "Unlink",
    choices: [
      { name: "Remove one environment from this project", value: "one" },
      { name: "Unlink all environments from this project", value: "all" },
      { name: "Cancel", value: "cancel" },
    ],
  });

  if (mode === "cancel") {
    return;
  }

  if (mode === "all") {
    const confirmed = await confirm({
      message: `Unlink all environments (${context.profiles.join(", ")})? Credentials stay on disk.`,
      default: false,
    });
    if (!confirmed) {
      logWarning("Cancelled.");
      return;
    }

    removeProjectLink(cwd);
    logSuccess(`Unlinked ${context.projectRoot}. Profiles were kept.`);
    return;
  }

  const profile = await select({
    message: "Remove which environment from this project?",
    choices: context.profiles.map((name) => ({
      name: profileChoiceLabel(name, context.activeProfile),
      value: name,
    })),
  });

  const confirmed = await confirm({
    message: `Remove "${profile}" from this project? (credentials kept)`,
    default: false,
  });

  if (!confirmed) {
    logWarning("Cancelled.");
    return;
  }

  const next = removeProjectProfile(cwd, profile);
  if (!next) {
    logSuccess(`Removed "${profile}" and unlinked the project (no environments left).`);
    return;
  }

  logSuccess(`Removed "${profile}" from this project.`);
  logReview(
    `Active: ${next.activeProfile}  ·  Linked: ${next.profiles.join(", ")}`,
  );
}

async function showProfileDetails(): Promise<void> {
  const cwd = process.cwd();
  const context = resolveProjectContext(cwd);

  if (!context.isLinked && context.profiles.length === 0) {
    logError("No profile linked. Run setup or add an environment for this directory.");
    process.exitCode = 1;
    return;
  }

  let profile = context.activeProfile ?? context.profile;
  if (context.profiles.length > 1) {
    profile = await select({
      message: "Show details for which environment?",
      choices: context.profiles.map((name) => ({
        name: profileChoiceLabel(name, context.activeProfile),
        value: name,
      })),
      default: profile,
    });
  }

  const config = loadConfig(profile);
  if (!config) {
    logError(
      `Profile "${profile}" is linked but missing. Run setup to recreate it.`,
    );
    process.exitCode = 1;
    return;
  }

  printSummaryBlock(
    "Environment details",
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

  const context = resolveProjectContext(process.cwd());
  if (context.isLinked) {
    logInfo(
      `${path.basename(context.projectRoot)}  ·  ${formatLinkedProfilesLabel(context)}`,
    );
  }

  const action = await select({
    message: "Projects",
    choices: [
      { name: "List linked projects and environments", value: "list" },
      {
        name: context.isLinked
          ? "Add another environment (e.g. production)"
          : "Link this directory to a profile",
        value: "link",
      },
      { name: "Switch active environment", value: "switch" },
      { name: "Show environment details", value: "show" },
      { name: "Edit profile credentials", value: "edit" },
      {
        name: context.profiles.length > 1
          ? "Unlink an environment (or all)"
          : "Unlink this directory (keep profile)",
        value: "unlink",
      },
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
