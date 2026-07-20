import os from "node:os";
import process from "node:process";
import { CONFIG_DIR, listProfiles, listRegisteredProjects } from "./config.js";

export const VERSION = "0.2.6";
export const BRAND_NAME = "Velocilabs";
export const BRAND_URL = "https://velocilabs.com";
export const SPYKE_URL = "https://spyke.social";
export const TAGLINE = "Deploy, migrate, and sync self-hosted Supabase.";
export const REPO_URL = "https://github.com/spykesocial/supabase-selfhosted-cli";

const ESC = "\u001b";

export const colors = {
  green: `${ESC}[0;32m`,
  blue: `${ESC}[1;34m`,
  cyan: `${ESC}[0;36m`,
  yellow: `${ESC}[0;33m`,
  purple: `${ESC}[0;35m`,
  red: `${ESC}[0;31m`,
  gray: `${ESC}[0;90m`,
  nc: `${ESC}[0m`,
} as const;

const VELOCILABS_PURPLE_RGB = "219;156;253";

export const icons = {
  success: "✓",
  error: "☻",
  warning: "◎",
  arrow: "➤",
  list: "•",
  dryRun: "→",
  review: "☞",
  info: "ℹ",
} as const;

export function isColorEnabled(): boolean {
  if (process.env.NO_COLOR) {
    return false;
  }

  return Boolean(process.stdout.isTTY);
}

export function hideCursor(): void {
  if (process.stderr.isTTY) {
    process.stderr.write("\u001b[?25l");
  }
}

export function showCursor(): void {
  if (process.stderr.isTTY) {
    process.stderr.write("\u001b[?25h");
  }
}

export function paint(text: string, color: keyof typeof colors): string {
  if (!isColorEnabled()) {
    return text;
  }

  return `${colors[color]}${text}${colors.nc}`;
}

export function paintBrand(text: string): string {
  if (!isColorEnabled()) {
    return text;
  }

  const depth = process.stdout.getColorDepth?.() ?? 4;
  if (depth >= 8) {
    return `${ESC}[38;2;${VELOCILABS_PURPLE_RGB}m${text}${colors.nc}`;
  }

  return paint(text, "purple");
}

// Half-block raster of veloci-logo.svg (purple fill path).
const LIGHTNING_MARK = [
  "  ██████▀",
  "  █████",
  " ████▀",
  "▄███████▀",
  "▀▀▀███▀",
  "  ▄██▀",
  "  █▀",
  " ▀",
];

const WORDMARK = [
  "__     __   _            _ _       _         ",
  "\\ \\   / /__| | ___   ___(_) | __ _| |__  ___ ",
  " \\ \\ / / _ \\ |/ _ \\ / __| | |/ _` | '_ \\/ __|",
  "  \\ V /  __/ | (_) | (__| | | (_| | |_) \\__ \\",
  "   \\_/ \\___|_|\\___/ \\___|_|_|\\__,_|_.__/|___/",
];

function combineLockupLines(
  markLines: string[],
  textLines: string[],
  gap = 2,
  textOffset = 0,
): string[] {
  const markWidth = Math.max(...markLines.map((line) => line.length));
  const rows = Math.max(markLines.length, textLines.length + textOffset);
  const combined: string[] = [];

  for (let index = 0; index < rows; index += 1) {
    const mark = markLines[index] ?? "";
    const textIndex = index - textOffset;
    const text =
      textIndex >= 0 && textIndex < textLines.length
        ? textLines[textIndex]
        : "";
    combined.push(`${mark.padEnd(markWidth + gap)}${text}`.trimEnd());
  }

  return combined;
}

export function showBrandBanner(): string {
  const useColor = isColorEnabled();
  const brand = (text: string) => (useColor ? paintBrand(text) : text);
  const link = (text: string) => (useColor ? paint(text, "blue") : text);
  const meta = (text: string) => (useColor ? paint(text, "gray") : text);

  const textOffset = Math.floor((LIGHTNING_MARK.length - WORDMARK.length) / 2);
  const lockup = combineLockupLines(LIGHTNING_MARK, WORDMARK, 2, textOffset);

  return [
    ...lockup.map((line) => brand(line)),
    link(REPO_URL),
    `${link(BRAND_URL)}  ${meta("·")}  ${link(SPYKE_URL)}  ${meta(`·  ${TAGLINE}`)}`,
    "",
  ].join("\n");
}

export function showMenuOption(
  number: number,
  label: string,
  description: string,
  selected: boolean,
): string {
  const text = `${label.padEnd(12)} ${description}`;
  if (selected) {
    return `${paintBrand(`${icons.arrow} ${number}. ${text}`)}`;
  }

  return `  ${number}. ${text}`;
}

export function logInfo(message: string): void {
  console.log(paint(message, "blue"));
}

export function logSuccess(message: string): void {
  console.log(`  ${paintBrand(icons.success)} ${message}`);
}

export function logWarning(message: string): void {
  console.log(paint(message, "yellow"));
}

export function logError(message: string): void {
  console.error(`${paint(icons.error, "yellow")} ${message}`);
}

export function logReview(message: string): void {
  console.log(`${icons.review} ${message}`);
}

export function printSummaryBlock(heading: string, ...details: string[]): void {
  const width = Math.min(process.stdout.columns ?? 70, 70);
  const divider = "=".repeat(width);

  console.log("");
  console.log(divider);
  console.log(paint(heading, "blue"));

  for (const detail of details) {
    if (detail) {
      console.log(formatStyledConfigSummary([detail]));
    }
  }

  console.log(divider);
  console.log("");
}

export function formatVersion(): string {
  const profiles = listProfiles();
  const projects = listRegisteredProjects();

  return [
    "",
    `${paintBrand(BRAND_NAME)} ${paint("supabase-selfhosted-cli", "gray")} ${VERSION}`,
    paint(BRAND_URL, "blue"),
    `Node: ${process.version}`,
    `Platform: ${process.platform} ${os.arch()}`,
    `Config: ${CONFIG_DIR}`,
    `Profiles: ${profiles.length > 0 ? profiles.join(", ") : "(none)"}`,
    `Linked projects: ${projects.length > 0 ? projects.map((project) => project.name).join(", ") : "(none)"}`,
    `Shell: ${process.env.SHELL ?? "unknown"}`,
    "",
  ].join("\n");
}

export function showVersion(): void {
  console.log(formatVersion());
}

type HelpEntry = {
  command: string;
  description: string;
};

const COMMAND_ENTRIES: HelpEntry[] = [
  { command: "supabase-selfhosted-cli", description: "Main menu" },
  { command: "setup", description: "Create or update an environment profile" },
  { command: "projects", description: "Add, switch, or manage project environments" },
  { command: "settings", description: "View, update, or delete stored credentials" },
  { command: "functions deploy", description: "Deploy local supabase/functions" },
  { command: "db push", description: "Push local migrations with supabase db push" },
  { command: "gen types", description: "Generate TypeScript types from remote DB" },
];

const EXAMPLE_ENTRIES: HelpEntry[] = [
  { command: "projects --list", description: "Show projects and linked environments" },
  { command: "projects --link", description: "Add development or production profile" },
  { command: "projects --switch", description: "Change the active environment" },
  { command: "setup -p production", description: "Create a production profile" },
  { command: "db push -p production", description: "Push migrations to production once" },
  { command: "functions deploy --prune", description: "Deploy and remove remote-only files" },
  { command: "functions deploy --no-restart", description: "Deploy without restarting runtime" },
  { command: "gen types -o src/types/database.ts", description: "Write types to a custom path" },
];

function formatHelpSection(title: string, entries: HelpEntry[]): string {
  const lines = [paint(title, "blue")];

  for (const entry of entries) {
    const command = entry.command.padEnd(28);
    lines.push(`  ${paintBrand(command)} ${entry.description}`);
  }

  lines.push("");
  return lines.join("\n");
}

export function formatHelp(): string {
  return [
    showBrandBanner(),
    formatHelpSection("COMMANDS", COMMAND_ENTRIES),
    formatHelpSection("EXAMPLES", EXAMPLE_ENTRIES),
    paint("OPTIONS", "blue"),
    `  ${paintBrand("-p, --profile <name>".padEnd(28))} Use a profile for this command`,
    `  ${paintBrand("-h, --help".padEnd(28))} Show this help message`,
    `  ${paintBrand("-V, --version".padEnd(28))} Show version information`,
    "",
  ].join("\n");
}

export function showHelp(): void {
  console.log(formatHelp());
}

export class InlineSpinner {
  private timer: NodeJS.Timeout | null = null;
  private frame = 0;
  private readonly frames = "|/-\\";

  constructor(private message: string) {}

  start(): void {
    if (!process.stderr.isTTY) {
      console.error(this.message);
      return;
    }

    this.stop();
    this.frame = 0;
    this.timer = setInterval(() => {
      const char = this.frames[this.frame % this.frames.length];
      this.frame += 1;
      process.stderr.write(
        `\r${paintBrand(char)} ${truncateMessage(this.message)}`,
      );
    }, 80);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (process.stderr.isTTY) {
      process.stderr.write("\r\u001b[2K");
    }
  }
}

export async function withSpinner<T>(
  message: string,
  task: () => Promise<T> | T,
): Promise<T> {
  const spinner = new InlineSpinner(message);
  spinner.start();

  try {
    return await task();
  } finally {
    spinner.stop();
  }
}

function truncateMessage(message: string, reserve = 8): string {
  const cols = process.stderr.columns ?? 80;
  const available = Math.max(cols - reserve, 20);
  const normalized = message.replace(/[\r\n]+/g, " ");

  if (normalized.length <= available) {
    return normalized;
  }

  return `${normalized.slice(0, available - 3)}...`;
}

export function formatStyledConfigSummary(lines: string[]): string {
  return lines
    .map((line) => {
      const separator = line.indexOf(":");
      if (separator === -1) {
        return line;
      }

      const label = line.slice(0, separator + 1);
      const value = line.slice(separator + 1);
      return `${paint(label, "gray")}${value}`;
    })
    .join("\n");
}
