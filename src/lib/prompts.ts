import readline from "node:readline";
import {
  confirm,
  input,
  number,
  password,
  select,
} from "@inquirer/prompts";
import { promptTheme } from "./theme.js";

type ConfirmOptions = Parameters<typeof confirm>[0];
type InputOptions = Parameters<typeof input>[0];
type NumberOptions = Parameters<typeof number>[0];
type PasswordOptions = Parameters<typeof password>[0];
type SelectOptions<Value> = Parameters<typeof select<Value>>[0];

export type Cancelable<T> = Promise<T> & { cancel: () => void };

export function confirmPrompt(options: ConfirmOptions): Cancelable<boolean> {
  return confirm({ ...options, theme: promptTheme });
}

export function inputPrompt(options: InputOptions): Cancelable<string> {
  return input({ ...options, theme: promptTheme });
}

export function numberPrompt(options: NumberOptions): Cancelable<number | undefined> {
  return number({ ...options, theme: promptTheme });
}

export function passwordPrompt(options: PasswordOptions): Cancelable<string> {
  return password({ ...options, theme: promptTheme });
}

export function selectPrompt<Value>(options: SelectOptions<Value>): Cancelable<Value> {
  return select<Value>({ ...options, theme: promptTheme });
}

export type Backable<T> = { kind: "value"; value: T } | { kind: "back" };

/**
 * Run a prompt while listening for Escape on stdin. Pressing Escape cancels
 * the prompt and resolves with `{ kind: "back" }`, letting callers step
 * backwards through a multi-step flow.
 */
export async function withBack<T>(run: () => Cancelable<T>): Promise<Backable<T>> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return { kind: "value", value: await run() };
  }

  let prompt: Cancelable<T> | undefined;
  let backRequested = false;

  const onKeypress = (_str: string, key: readline.Key): void => {
    if (key.name === "escape" || key.sequence === "\u001b") {
      backRequested = true;
      prompt?.cancel();
    }
  };

  process.stdin.on("keypress", onKeypress);
  try {
    prompt = run();
    return { kind: "value", value: await prompt };
  } catch (error) {
    if (backRequested) {
      return { kind: "back" };
    }
    throw error;
  } finally {
    process.stdin.removeListener("keypress", onKeypress);
  }
}
