import fs from "node:fs";
import path from "node:path";

export type LocalEntry = {
  name: string;
  isDirectory: boolean;
};

export function listLocalEntries(localDir: string): LocalEntry[] {
  return fs.readdirSync(localDir, { withFileTypes: true }).map((entry) => ({
    name: entry.name,
    isDirectory: entry.isDirectory(),
  }));
}

export function findPrunableRemoteEntries(
  localEntries: LocalEntry[],
  remoteNames: string[],
): string[] {
  const localNames = new Set(localEntries.map((entry) => entry.name));
  return remoteNames.filter((name) => !localNames.has(name)).sort();
}

export function joinRemotePath(remoteDir: string, name: string): string {
  return `${remoteDir}/${name}`.replace(/\\/g, "/");
}

export function countLocalFiles(localDir: string): number {
  let count = 0;

  for (const entry of fs.readdirSync(localDir, { withFileTypes: true })) {
    const fullPath = path.join(localDir, entry.name);
    if (entry.isDirectory()) {
      count += countLocalFiles(fullPath);
      continue;
    }
    if (entry.isFile()) {
      count += 1;
    }
  }

  return count;
}
