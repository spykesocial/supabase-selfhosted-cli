#!/usr/bin/env node

import { Command } from "commander";
import { runDbPush } from "./commands/db-push.js";
import { runFunctionsDeploy } from "./commands/functions-deploy.js";
import { runGenTypes } from "./commands/gen-types.js";
import { runProjects } from "./commands/projects.js";
import { runSettings } from "./commands/settings.js";
import { runSetup } from "./commands/setup.js";
import { runInteractiveMenu } from "./lib/menu.js";
import { logError, showHelp, showVersion, VERSION } from "./lib/ui.js";

const program = new Command();

program
  .name("supabase-selfhosted-cli")
  .description(
    "CLI for self-hosted Supabase — deploy functions, push migrations, sync types (VPS, Docker, local)",
  )
  .version(VERSION, "-V, --version", "Show version information")
  .helpOption(false)
  .option("-h, --help", "Show help");

program
  .command("setup")
  .description("Interactive setup — store SSH/local, database, and deploy settings")
  .option("-p, --profile <name>", "Profile name (defaults to this project's folder name)")
  .action(async (options: { profile?: string }) => {
    await runSetup({ profile: options.profile, linkProject: true });
  });

program
  .command("projects")
  .description("List, link, switch, edit, or delete project profiles")
  .option("-p, --profile <name>", "Profile name")
  .option("--list", "List linked projects and profiles")
  .option("--link", "Link this directory to a profile")
  .option("--switch", "Switch this directory to a different profile")
  .option("--show", "Show profile details for this directory")
  .option("--edit", "Edit profile credentials")
  .option("--unlink", "Unlink this directory (keep profile)")
  .option("--delete", "Delete a stored profile")
  .action(
    async (options: {
      profile?: string;
      list?: boolean;
      link?: boolean;
      switch?: boolean;
      show?: boolean;
      edit?: boolean;
      unlink?: boolean;
      delete?: boolean;
    }) => {
      await runProjects(options);
    },
  );

program
  .command("settings")
  .description("View, update, or delete stored credentials")
  .option("-p, --profile <name>", "Profile name")
  .action(async (options: { profile?: string }) => {
    await runSettings(options);
  });

const functionsCommand = program
  .command("functions")
  .description("Edge function operations");

functionsCommand
  .command("deploy")
  .description("Deploy local supabase/functions to your self-hosted instance")
  .option("-p, --profile <name>", "Profile name")
  .option("--restart", "Restart Supabase after deploy")
  .option("--no-restart", "Skip restart after deploy")
  .option("--prune", "Remove destination files and folders not present locally")
  .action(async (options: { profile?: string; restart?: boolean; prune?: boolean }) => {
    await runFunctionsDeploy(options);
  });

const dbCommand = program.command("db").description("Database operations");

dbCommand
  .command("push")
  .description("Push local migrations using supabase db push")
  .option("-p, --profile <name>", "Profile name")
  .option("--debug", "Pass --debug to supabase CLI")
  .action(async (options: { profile?: string; debug?: boolean }) => {
    await runDbPush(options);
  });

const genCommand = program.command("gen").description("Code generation");

genCommand
  .command("types")
  .description("Generate TypeScript types from the remote database")
  .option("-p, --profile <name>", "Profile name")
  .option("-o, --output <file>", "Output file", "database.types.ts")
  .option("--schema <name>", "Postgres schema", "public")
  .option("--debug", "Pass --debug to supabase CLI")
  .action(
    async (options: {
      profile?: string;
      output?: string;
      schema?: string;
      debug?: boolean;
    }) => {
      await runGenTypes(options);
    },
  );

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    await runInteractiveMenu();
    return;
  }

  if (args.includes("--help") || args.includes("-h")) {
    showHelp();
    return;
  }

  if (args.includes("--version") || args.includes("-V")) {
    showVersion();
    return;
  }

  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  logError(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
