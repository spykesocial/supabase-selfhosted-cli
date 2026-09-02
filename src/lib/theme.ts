import type { Theme } from "@inquirer/core";
import { colors, isColorEnabled } from "./ui.js";

function wrap(code: string, text: string): string {
  if (!isColorEnabled()) {
    return text;
  }
  return `${code}${text}${colors.nc}`;
}

const bold = (text: string) => wrap(colors.bold, text);
const cyan = (text: string) => wrap(colors.cyan, text);
const gray = (text: string) => wrap(colors.gray, text);
const red = (text: string) => wrap(colors.red, text);
const purple = (text: string) => wrap(colors.purpleBold, text);

/**
 * Inquirer theme tuned to the Velocilabs / Mole aesthetic:
 * purple question markers, cyan highlights, dim defaults and help text.
 */
export const promptTheme: Partial<Theme> = {
  prefix: {
    idle: purple("?"),
    done: wrap(colors.green, "✓"),
  },
  spinner: {
    interval: 80,
    frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  },
  style: {
    answer: cyan,
    message: bold,
    error: (text) => red(`> ${text}`),
    defaultAnswer: (text) => gray(`(${text})`),
    help: gray,
    highlight: cyan,
    key: (text) => cyan(`<${text}>`),
  },
};
