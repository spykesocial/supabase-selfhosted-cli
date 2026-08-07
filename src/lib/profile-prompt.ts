import { input, select } from "@inquirer/prompts";
import { loadConfig } from "./config.js";

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
  return loadConfig(name) ? `${name} (already configured)` : name;
}

export type EnvironmentProfilePick =
  | { kind: "profile"; name: string }
  | { kind: "existing" }
  | { kind: "cancel" };

/**
 * Ask which environment profile to use: development, production, or a custom name.
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

  if (picked === "__cancel__") {
    return { kind: "cancel" };
  }

  if (picked === "__existing__") {
    return { kind: "existing" };
  }

  if (picked !== "__custom__") {
    return { kind: "profile", name: picked };
  }

  const customDefault =
    options?.suggestedCustomName?.trim() ||
    (options?.defaultName &&
    options.defaultName !== "development" &&
    options.defaultName !== "production"
      ? options.defaultName.trim()
      : "staging");

  const custom = await input({
    message: "Profile name",
    default: customDefault,
    validate: validateProfileName,
  });

  return { kind: "profile", name: custom.trim() };
}
