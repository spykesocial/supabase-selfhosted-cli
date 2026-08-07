import { input, select } from "@inquirer/prompts";
import { findProfileProjects, loadConfig } from "./config.js";

function validateProfileName(value: string): true | string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "Profile name is required";
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(trimmed)) {
    return "Use letters, numbers, hyphens, or underscores";
  }
  return true;
}

function labelForEnv(name: "development" | "production"): string {
  const existing = loadConfig(name);
  if (!existing) {
    return name;
  }
  const projects = findProfileProjects(name);
  if (projects.length > 0) {
    return `${name} (used by ${projects.length} project(s))`;
  }
  return `${name} (already configured)`;
}

export type EnvironmentProfilePick =
  | { kind: "profile"; name: string }
  | { kind: "existing" }
  | { kind: "cancel" };

/**
 * Ask which environment profile to use.
 *
 * When `suggestedCustomName` is not a generic env name (development/production),
 * it is offered as the first (default) choice labeled with "recommended for this project".
 */
export async function promptEnvironmentProfileName(options?: {
  message?: string;
  defaultName?: string;
  allowCancel?: boolean;
  /** Show a choice that returns kind: "existing". */
  offerExisting?: boolean;
  /** Prefer this when the user picks Custom name… */
  suggestedCustomName?: string;
}): Promise<EnvironmentProfilePick> {
  const suggested = options?.suggestedCustomName?.trim();
  const isSuggestedSpecific = suggested && suggested !== "development" && suggested !== "production";

  if (isSuggestedSpecific) {
    const existingSuggested = loadConfig(suggested);
    const suggestedLabel = existingSuggested
      ? `${suggested} (recommended for this project — already configured)`
      : `${suggested} (recommended for this project)`;

    const choices = [
      { name: suggestedLabel, value: suggested },
      { name: labelForEnv("development"), value: "development" as const },
      { name: labelForEnv("production"), value: "production" as const },
      { name: "Custom name…", value: "__custom__" as const },
      ...(options?.offerExisting
        ? [{ name: "Use another existing profile…", value: "__existing__" as const }]
        : []),
      ...(options?.allowCancel
        ? [{ name: "Cancel", value: "__cancel__" as const }]
        : []),
    ];

    const picked = await select({
      message: options?.message ?? "Which environment profile?",
      choices,
      default: suggested,
    });

    return handlePick(picked, options);
  }

  const envChoices = [
    { name: labelForEnv("development"), value: "development" as const },
    { name: labelForEnv("production"), value: "production" as const },
    { name: "Custom name…", value: "__custom__" as const },
  ];

  const choices = [
    ...envChoices,
    ...(options?.offerExisting
      ? [{ name: "Use another existing profile…", value: "__existing__" as const }]
      : []),
    ...(options?.allowCancel
      ? [{ name: "Cancel", value: "__cancel__" as const }]
      : []),
  ];

  const defaultChoice =
    options?.defaultName === "production" ? "production" : "development";

  const picked = await select({
    message: options?.message ?? "Which environment profile?",
    choices,
    default: defaultChoice,
  });

  return handlePick(picked, options);
}

async function handlePick(
  picked: string,
  options?: { suggestedCustomName?: string },
): Promise<EnvironmentProfilePick> {
  if (picked === "__cancel__") {
    return { kind: "cancel" };
  }

  if (picked === "__existing__") {
    return { kind: "existing" };
  }

  if (picked !== "__custom__") {
    return { kind: "profile", name: picked };
  }

  const suggested = options?.suggestedCustomName?.trim();
  const customDefault =
    suggested && suggested !== "development" && suggested !== "production"
      ? suggested
      : "staging";

  const custom = await input({
    message: "Profile name",
    default: customDefault,
    validate: validateProfileName,
  });

  return { kind: "profile", name: custom.trim() };
}
