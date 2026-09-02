import { input, password } from "@inquirer/prompts";
import {
  clearEngineSession,
  loadEngineSession,
  saveEngineSession,
  type EngineLoginResponse,
  type EngineMeResponse,
} from "../lib/engine.js";
import { logError, logInfo, logSuccess, showBrandBanner } from "../lib/ui.js";

const DEFAULT_ENGINE_URL = process.env.ENGINE_URL ?? "http://localhost:3000";

export async function runLogin(options: {
  baseUrl?: string;
  token?: string;
}): Promise<void> {
  console.log(showBrandBanner());

  const baseUrl = (options.baseUrl ?? DEFAULT_ENGINE_URL).trim().replace(/\/+$/, "");

  if (options.token) {
    saveEngineSession({
      baseUrl,
      token: options.token.trim(),
      savedAt: new Date().toISOString(),
    });
    logSuccess(`Saved API token for ${baseUrl}.`);
    return;
  }

  const email = (
    await input({
      message: "Engine email",
      validate: (value) => (value.trim() ? true : "Email is required"),
    })
  ).trim();

  const pass = await password({
    message: "Engine password",
    mask: "*",
    validate: (value) => (value ? true : "Password is required"),
  });

  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: pass }),
  });

  const data = (await response.json()) as Partial<EngineLoginResponse> & { error?: string };
  if (!response.ok || !data.accessToken) {
    throw new Error(data.error ?? "Login failed.");
  }

  saveEngineSession({
    baseUrl,
    token: data.accessToken,
    email: data.member?.email,
    savedAt: new Date().toISOString(),
  });

  logSuccess(
    `Signed in as ${data.member?.email} (${data.member?.roleCode ?? "member"}).`,
  );
  logInfo(
    `Access is limited to the scopes granted to your account${
      data.member?.isSuperAdmin ? " (full access)" : ""
    }.`,
  );
}

export async function runLogout(): Promise<void> {
  if (!loadEngineSession()) {
    logInfo("Not logged in.");
    return;
  }
  clearEngineSession();
  logSuccess("Signed out of the engine.");
}

export async function runWhoami(): Promise<void> {
  const session = loadEngineSession();
  if (!session) {
    logInfo("Not logged in. Run `supabase-selfhosted-cli login`.");
    return;
  }

  let me: EngineMeResponse;
  try {
    me = await fetchMe();
  } catch (error) {
    logError(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  logInfo(`Engine: ${session.baseUrl}`);
  logInfo(`Email: ${me.member?.email ?? "—"}`);
  logInfo(`Role: ${me.member?.roleCode ?? "—"}`);
  if (me.hasFullAccess) {
    logInfo("Scopes: (full access)");
  } else {
    logInfo(`Scopes: ${(me.scopes ?? []).join(", ") || "(none)"}`);
  }
}

async function fetchMe(): Promise<EngineMeResponse> {
  const session = loadEngineSession();
  if (!session) {
    throw new Error("Not logged in.");
  }
  const response = await fetch(`${session.baseUrl}/api/v1/me`, {
    headers: { authorization: `Bearer ${session.token}` },
  });
  const data = (await response.json()) as EngineMeResponse & { error?: string };
  if (!response.ok) {
    throw new Error(data.error ?? "Failed to fetch identity.");
  }
  return data;
}
