import fs from "node:fs";
import path from "node:path";

export function resolveLocalFunctionsPath(cwd: string, configuredPath: string): string {
  const resolved = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(cwd, configuredPath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`Local functions path does not exist: ${resolved}`);
  }

  return resolved;
}

export function findSupabaseProjectRoot(startDir: string): string | null {
  let current = startDir;

  while (true) {
    const candidate = path.join(current, "supabase", "functions");
    if (fs.existsSync(candidate)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }

    current = parent;
  }
}
