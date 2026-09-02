import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { CONFIG_DIR, listEnvironments, listRegisteredProjects } from "./config.js";

function readPackageVersion(): string {
  try {
    const candidates = [
      join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"),
      join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json"),
    ];
    for (const pkgPath of candidates) {
      if (existsSync(pkgPath)) {
        return JSON.parse(readFileSync(pkgPath, "utf8")).version;
      }
    }
  } catch {
    // fall through
  }
  return "0.0.0";
}

export const VERSION = readPackageVersion();
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
  purpleBold: `${ESC}[1;35m`,
  red: `${ESC}[0;31m`,
  gray: `${ESC}[0;38;5;244m`,
  bold: `${ESC}[1m`,
  dim: `${ESC}[2m`,
  nc: `${ESC}[0m`,
} as const;

const VELOCILABS_PURPLE_RGB = "219;156;253";

export const icons = {
  success: "✓",
  error: "☻",
  warning: "◎",
  arrow: "➤",
  list: "•",
  sublist: "↳",
  dryRun: "→",
  review: "⊙",
  info: "ℹ",
  empty: "○",
  solid: "●",
  navUp: "↑",
  navDown: "↓",
} as const;

export function isColorEnabled(): boolean {
  if (process.env.NO_COLOR) {
    return false;
  }

  return Boolean(process.stdout.isTTY);
}

/** Remove ANSI escape sequences so we can measure true display width. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

export function visibleLength(text: string): number {
  return stripAnsi(text).length;
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

// ─────────────────────────────────────────────────────────────────────────────
// Banner / branding
// ─────────────────────────────────────────────────────────────────────────────

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

/**
 * Compact single-line brand header for the interactive menu.
 */
export function showCompactBrandHeader(): string {
  const useColor = isColorEnabled();
  const brand = (text: string) => (useColor ? paintBrand(text) : text);
  const meta = (text: string) => (useColor ? paint(text, "gray") : text);

  return `${brand("⚡ Velocilabs")}  ${meta("·")}  ${meta(`supabase-selfhosted-cli ${VERSION}`)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sections & panels
// ─────────────────────────────────────────────────────────────────────────────

/** Mole-style section header: `➤ Title` in bold purple. */
export function sectionTitle(title: string): string {
  return paint(`${icons.arrow} ${title}`, "purpleBold");
}

export function printSection(title: string): void {
  console.log("");
  console.log(sectionTitle(title));
}

/** Align `key: value` lines so values line up; keys are dimmed. */
export function formatDetailLines(lines: string[]): string[] {
  let maxKey = 0;
  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator !== -1) {
      maxKey = Math.max(maxKey, separator + 1);
    }
  }

  return lines.map((line) => {
    const separator = line.indexOf(":");
    if (separator === -1) {
      return line;
    }

    const key = line.slice(0, separator + 1);
    const value = line.slice(separator + 1);
    const pad = Math.max(maxKey - separator - 1, 1);
    return `${paint(key, "gray")}${" ".repeat(pad)}${value}`;
  });
}

function truncateVisible(text: string, width: number): string {
  if (visibleLength(text) <= width) {
    return text;
  }
  const slice = stripAnsi(text).slice(0, width - 3);
  return `${slice}...`;
}

function padVisible(text: string, width: number): string {
  const len = visibleLength(text);
  if (len >= width) {
    return text;
  }
  return `${text}${" ".repeat(width - len)}`;
}

/** Draw a rounded, headed panel around a set of key/value lines. */
export function renderPanel(heading: string, lines: string[]): string {
  const termCols = process.stdout.columns ?? 80;
  const cols = Math.min(Math.max(termCols - 2, 30), 88);
  const innerWidth = Math.max(cols - 4, 20);
  const formatted = formatDetailLines(lines).map((line) =>
    line === "" ? "" : truncateVisible(line, innerWidth),
  );

  const title = ` ${sectionTitle(heading)} `;
  const fill = Math.max(innerWidth - visibleLength(title) + 2, 2);

  const top = `╭${title}${"─".repeat(fill)}╮`;
  const bottom = `╰${"─".repeat(innerWidth + 2)}╯`;

  const body = formatted
    .map((line) =>
      line === "" ? "│" : `│ ${padVisible(line, innerWidth)} │`,
    )
    .join("\n");

  return [top, body, bottom].join("\n");
}

export function printPanel(heading: string, ...details: string[]): void {
  console.log("");
  console.log(renderPanel(heading, details));
  console.log("");
}

// Back-compat alias: callers previously used `printSummaryBlock`.
export function printSummaryBlock(heading: string, ...details: string[]): void {
  printPanel(heading, ...details);
}

// ─────────────────────────────────────────────────────────────────────────────
// Logging
// ─────────────────────────────────────────────────────────────────────────────

export function logInfo(message: string): void {
  console.log(`  ${paint(message, "blue")}`);
}

export function logSuccess(message: string): void {
  console.log(`  ${paint(icons.success, "green")} ${message}`);
}

export function logWarning(message: string): void {
  console.log(`  ${paint(icons.warning, "yellow")} ${message}`);
}

export function logError(message: string): void {
  console.error(`  ${paint(icons.error, "red")} ${message}`);
}

export function logReview(message: string): void {
  console.log(`  ${paint(icons.review, "gray")} ${message}`);
}

export function logDetail(message: string): void {
  console.log(`    ${paint(icons.sublist, "gray")} ${message}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Version & help
// ─────────────────────────────────────────────────────────────────────────────

export function formatVersion(): string {
  const environments = listEnvironments();
  const projects = listRegisteredProjects();

  const detail = formatDetailLines([
    `Version: ${VERSION}`,
    `Node: ${process.version}`,
    `Platform: ${process.platform} ${os.arch()}`,
    `Shell: ${process.env.SHELL ?? "unknown"}`,
    `Config: ${CONFIG_DIR}`,
    `Environments: ${environments.length > 0 ? environments.join(", ") : "(none)"}`,
    `Linked projects: ${projects.length > 0 ? projects.map((project) => project.name).join(", ") : "(none)"}`,
  ]);

  return [
    "",
    showCompactBrandHeader(),
    "",
    detail.join("\n"),
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
  { command: "setup", description: "Create or update an environment" },
  { command: "projects", description: "Add or manage project environments" },
  { command: "settings", description: "View, update, or delete stored credentials" },
  { command: "functions deploy", description: "Deploy local supabase/functions" },
  { command: "db push", description: "Push local migrations with supabase db push" },
  { command: "gen types", description: "Generate TypeScript types from remote DB" },
];

const EXAMPLE_ENTRIES: HelpEntry[] = [
  { command: "projects --list", description: "Show projects and linked environments" },
  { command: "projects --link", description: "Add development or production environment" },
  { command: "setup -e production", description: "Create a production environment" },
  { command: "db push -e production", description: "Push migrations to production once" },
  { command: "functions deploy --prune", description: "Deploy and remove remote-only files" },
  { command: "functions deploy --no-restart", description: "Deploy without restarting runtime" },
  { command: "gen types -o src/types/database.ts", description: "Write types to a custom path" },
];

function formatHelpSection(title: string, entries: HelpEntry[]): string {
  const lines = [sectionTitle(title)];

  for (const entry of entries) {
    const command = entry.command.padEnd(28);
    lines.push(`  ${paintBrand(command)} ${paint(entry.description, "gray")}`);
  }

  lines.push("");
  return lines.join("\n");
}

export function formatHelp(): string {
  return [
    showBrandBanner(),
    formatHelpSection("COMMANDS", COMMAND_ENTRIES),
    formatHelpSection("EXAMPLES", EXAMPLE_ENTRIES),
    sectionTitle("OPTIONS"),
    `  ${paintBrand("-e, --environment <name>".padEnd(28))} ${paint("Use an environment for this command", "gray")}`,
    `  ${paintBrand("-h, --help".padEnd(28))} ${paint("Show this help message", "gray")}`,
    `  ${paintBrand("-V, --version".padEnd(28))} ${paint("Show version information", "gray")}`,
    "",
  ].join("\n");
}

export function showHelp(): void {
  console.log(formatHelp());
}

// ─────────────────────────────────────────────────────────────────────────────
// Spinner
// ─────────────────────────────────────────────────────────────────────────────

export class InlineSpinner {
  private timer: NodeJS.Timeout | null = null;
  private frame = 0;
  private readonly frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

  constructor(private message: string) {}

  start(): void {
    if (!process.stderr.isTTY) {
      process.stderr.write(`  ${paint(this.message, "blue")}\n`);
      return;
    }

    this.stop();
    this.frame = 0;
    this.timer = setInterval(() => {
      const char = this.frames[this.frame % this.frames.length];
      this.frame += 1;
      process.stderr.write(
        `\r  ${paint(char, "blue")} ${truncateMessage(this.message)}`,
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
  return formatDetailLines(lines).join("\n");
}
