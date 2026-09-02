import readline from "node:readline";
import path from "node:path";
import process from "node:process";
import { runDbPush } from "../commands/db-push.js";
import { runFunctionsDeploy } from "../commands/functions-deploy.js";
import { runGenTypes } from "../commands/gen-types.js";
import { runProjects } from "../commands/projects.js";
import { runResetSetup, runSettings } from "../commands/settings.js";
import { runSetup } from "../commands/setup.js";
import { formatLinkedEnvironmentsLabel, resolveProjectContext } from "./config.js";
import {
  colors,
  formatHelp,
  formatVersion,
  hideCursor,
  icons,
  paint,
  paintBrand,
  showBrandBanner,
  showCursor,
  showHelp,
} from "./ui.js";

type MenuItem = {
  label: string;
  description: string;
  run: () => Promise<void>;
};

const MENU_ITEMS: MenuItem[] = [
  {
    label: "Deploy",
    description: "Push edge functions to your instance",
    run: async () => {
      await runFunctionsDeploy();
    },
  },
  {
    label: "DB Push",
    description: "Run supabase db push",
    run: async () => {
      await runDbPush();
    },
  },
  {
    label: "Gen Types",
    description: "Generate TypeScript types",
    run: async () => {
      await runGenTypes();
    },
  },
  {
    label: "Setup",
    description: "Configure an environment",
    run: async () => {
      await runSetup({ linkProject: true });
    },
  },
  {
    label: "Projects",
    description: "Add, switch, or manage environments",
    run: async () => {
      await runProjects();
    },
  },
  {
    label: "Settings",
    description: "View or update environment",
    run: async () => {
      await runSettings();
    },
  },
  {
    label: "Reset Setup",
    description: "Wipe all config & unlink this project",
    run: async () => {
      await runResetSetup();
    },
  },
];

const LABEL_COLUMN = 12;

function clearScreen(): void {
  process.stdout.write("\u001b[2J\u001b[H");
}

function clearLine(): string {
  return "\r\u001b[2K";
}

function renderMenuContext(): string[] {
  const context = resolveProjectContext(process.cwd());
  const projectName = path.basename(context.projectRoot);
  const envLabel = formatLinkedEnvironmentsLabel(context);

  const dim = (text: string) => paint(text, "gray");
  return [
    `${dim("Project:")}     ${paint(projectName, "cyan")}`,
    `${dim("Environment:")} ${paint(envLabel, "cyan")}`,
  ];
}

function renderMenuItem(
  number: number,
  label: string,
  description: string,
  selected: boolean,
): string {
  const padded = label.padEnd(LABEL_COLUMN);
  const desc = paint(description, "gray");

  if (selected) {
    return `  ${paint(icons.arrow, "cyan")} ${paintBrand(String(number).padStart(2))}  ${paintBrand(padded)}${desc}`;
  }

  return `    ${paint(String(number).padStart(2), "gray")}  ${paint(padded, "blue")}${desc}`;
}

function renderMenu(selected: number): void {
  clearScreen();

  const lines: string[] = [];

  lines.push(showBrandBanner());
  lines.push("");

  for (const line of renderMenuContext()) {
    lines.push(line);
  }

  let number = 0;
  lines.push("");
  for (const item of MENU_ITEMS) {
    number += 1;
    lines.push(renderMenuItem(number, item.label, item.description, selected === number));
  }

  lines.push("");

  if (process.stdin.isTTY) {
    const sep = ` ${paint("·", "gray")} `;
    const controls = [
      `${paint(`${icons.navUp}${icons.navDown}`, "gray")} navigate`,
      `${paint("↵", "gray")} select`,
      `${paint("1-9", "gray")} jump`,
      `${paint("m", "gray")} more`,
      `${paint("v", "gray")} version`,
      `${paint("q", "gray")} quit`,
    ].join(sep);
    lines.push(controls);
  }

  lines.push("");
  process.stdout.write(lines.map((line) => `${clearLine()}${line}`).join("\n"));
  process.stdout.write("\n\u001b[J");
}

type KeyAction =
  | "UP"
  | "DOWN"
  | "ENTER"
  | "QUIT"
  | "MORE"
  | "VERSION"
  | "NUMBER";

async function readKey(): Promise<{ action: KeyAction; number?: number }> {
  if (!process.stdin.isTTY) {
    return { action: "QUIT" };
  }

  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return new Promise((resolve) => {
    const cleanup = (): void => {
      process.stdin.removeListener("keypress", onKeypress);
      process.stdin.setRawMode(false);
    };

    const onKeypress = (_str: string, key: readline.Key): void => {
      cleanup();

      if (key.ctrl && key.name === "c") {
        resolve({ action: "QUIT" });
        return;
      }

      switch (key.name) {
        case "up":
        case "k":
          resolve({ action: "UP" });
          return;
        case "down":
        case "j":
          resolve({ action: "DOWN" });
          return;
        case "return":
        case "enter":
          resolve({ action: "ENTER" });
          return;
        case "q":
          resolve({ action: "QUIT" });
          return;
        case "m":
          resolve({ action: "MORE" });
          return;
        case "v":
          resolve({ action: "VERSION" });
          return;
        default:
          if (/^[1-9]$/.test(key.sequence ?? "")) {
            resolve({ action: "NUMBER", number: Number(key.sequence) });
            return;
          }
          resolve({ action: "QUIT" });
      }
    };

    process.stdin.on("keypress", onKeypress);
  });
}

function renderOverlay(content: string): void {
  clearScreen();

  for (const line of content.split("\n")) {
    process.stdout.write(`${clearLine()}${line}\n`);
  }

  process.stdout.write(`${clearLine()}\n`);
  const controls = `${colors.gray}Esc  |  B Back  |  Enter${colors.nc}`;
  process.stdout.write(`${clearLine()}${controls}\n`);
  process.stdout.write("\u001b[J");
}

async function waitForBack(): Promise<void> {
  if (!process.stdin.isTTY) {
    return;
  }

  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return new Promise((resolve) => {
    const cleanup = (): void => {
      process.stdin.removeListener("keypress", onKeypress);
      process.stdin.setRawMode(false);
    };

    const onKeypress = (_str: string, key: readline.Key): void => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        resolve();
        return;
      }

      switch (key.name) {
        case "escape":
        case "backspace":
        case "b":
        case "return":
        case "enter":
          cleanup();
          resolve();
          return;
        default:
          break;
      }
    };

    process.stdin.on("keypress", onKeypress);
  });
}

async function runMenuItem(
  index: number,
  leaveScreen: () => void,
  enterScreen: () => void,
): Promise<void> {
  showCursor();
  leaveScreen();
  clearScreen();
  await MENU_ITEMS[index].run();

  process.stdout.write("\n");
  const controls = `${colors.gray}Press Enter to return to menu${colors.nc}\n`;
  process.stdout.write(controls);
  await waitForBack();

  enterScreen();
  hideCursor();
}

export async function runInteractiveMenu(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    showHelp();
    return;
  }

  let usingAlternateScreen = false;
  const enterScreen = (): void => {
    if (!process.stdout.isTTY) {
      return;
    }

    process.stdout.write("\u001b[?1049h");
    usingAlternateScreen = true;
    clearScreen();
  };
  const leaveScreen = (): void => {
    if (!usingAlternateScreen || !process.stdout.isTTY) {
      return;
    }

    process.stdout.write("\u001b[?1049l");
    usingAlternateScreen = false;
  };

  let selected = 1;
  enterScreen();
  hideCursor();

  const cleanup = (): void => {
    showCursor();
    leaveScreen();
  };

  process.on("SIGINT", cleanup);

  try {
    while (true) {
      renderMenu(selected);
      const key = await readKey();

      switch (key.action) {
        case "UP":
          if (selected > 1) {
            selected -= 1;
          }
          break;
        case "DOWN":
          if (selected < MENU_ITEMS.length) {
            selected += 1;
          }
          break;
        case "ENTER":
          await runMenuItem(selected - 1, leaveScreen, enterScreen);
          break;
        case "NUMBER":
          if (key.number && key.number >= 1 && key.number <= MENU_ITEMS.length) {
            await runMenuItem(key.number - 1, leaveScreen, enterScreen);
          }
          break;
        case "MORE":
          renderOverlay(formatHelp());
          await waitForBack();
          break;
        case "VERSION":
          renderOverlay(formatVersion());
          await waitForBack();
          break;
        case "QUIT":
          cleanup();
          return;
      }
    }
  } finally {
    cleanup();
    process.removeListener("SIGINT", cleanup);
  }
}
