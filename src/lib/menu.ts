import readline from "node:readline";
import process from "node:process";
import { runDbPush } from "../commands/db-push.js";
import { runFunctionsDeploy } from "../commands/functions-deploy.js";
import { runGenTypes } from "../commands/gen-types.js";
import { runSettings } from "../commands/settings.js";
import { runSetup } from "../commands/setup.js";
import {
  colors,
  formatHelp,
  formatVersion,
  hideCursor,
  showBrandBanner,
  showCursor,
  showHelp,
  showMenuOption,
} from "./ui.js";

type MenuItem = {
  label: string;
  description: string;
  run: () => Promise<void>;
};

const MENU_ITEMS: MenuItem[] = [
  {
    label: "Setup",
    description: "Configure SSH/local credentials",
    run: async () => {
      await runSetup({ profile: "default", linkProject: true });
    },
  },
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
    label: "Settings",
    description: "View or update stored profile",
    run: async () => {
      await runSettings();
    },
  },
];

function clearScreen(): void {
  process.stdout.write("\u001b[2J\u001b[H");
}

function clearLine(): string {
  return "\r\u001b[2K";
}

function renderMenu(selected: number): void {
  clearScreen();

  for (const line of showBrandBanner().split("\n")) {
    process.stdout.write(`${clearLine()}${line}\n`);
  }

  process.stdout.write(`${clearLine()}\n`);

  MENU_ITEMS.forEach((item, index) => {
    const line = showMenuOption(
      index + 1,
      item.label,
      item.description,
      selected === index + 1,
    );
    process.stdout.write(`${clearLine()}${line}\n`);
  });

  if (process.stdin.isTTY) {
    process.stdout.write(`${clearLine()}\n`);
    const controls = `${colors.gray}↑↓  |  Enter  |  M More  |  V Version  |  Q Quit${colors.nc}`;
    process.stdout.write(`${clearLine()}${controls}\n`);
    process.stdout.write(`${clearLine()}\n`);
  }

  process.stdout.write("\u001b[J");
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
