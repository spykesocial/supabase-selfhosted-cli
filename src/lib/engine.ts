import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DIR = path.join(os.homedir(), ".supabase-selfhosted-cli");
const TOKEN_FILE = path.join(DIR, "engine.json");

export type EngineSession = {
  baseUrl: string;
  token: string;
  email?: string;
  savedAt: string;
};

export function loadEngineSession(): EngineSession | null {
  try {
    if (!fs.existsSync(TOKEN_FILE)) {
      return null;
    }
    const raw = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8")) as Partial<EngineSession>;
    if (!raw.baseUrl || !raw.token) {
      return null;
    }
    return {
      baseUrl: raw.baseUrl.replace(/\/+$/, ""),
      token: raw.token,
      email: raw.email,
      savedAt: raw.savedAt ?? "",
    };
  } catch {
    return null;
  }
}

export function saveEngineSession(session: EngineSession): void {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(TOKEN_FILE, `${JSON.stringify(session, null, 2)}\n`, {
    mode: 0o600,
  });
}

export function clearEngineSession(): void {
  if (fs.existsSync(TOKEN_FILE)) {
    fs.unlinkSync(TOKEN_FILE);
  }
}

export function hasEngineSession(): boolean {
  return loadEngineSession() !== null;
}

export class EngineApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "EngineApiError";
  }
}

export async function engineRequest<T>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const session = loadEngineSession();
  if (!session) {
    throw new EngineApiError(
      "Not logged in to the engine. Run `supabase-selfhosted-cli login`.",
      401,
    );
  }

  const response = await fetch(`${session.baseUrl}${path}`, {
    method,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${session.token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: string }).error)
        : `${method} ${path} failed (${response.status})`;
    throw new EngineApiError(message, response.status);
  }

  return data as T;
}

export type EngineLoginResponse = {
  accessToken: string;
  member: {
    id: string;
    email: string;
    fullName: string;
    roleCode: string;
    permissionCodes: string[];
    isSuperAdmin: boolean;
  };
};

export type EngineMeResponse = {
  kind: string;
  member: {
    id: string;
    email: string;
    fullName: string;
    roleCode: string;
    isSuperAdmin: boolean;
  } | null;
  scopes: string[] | null;
  hasFullAccess: boolean;
};
