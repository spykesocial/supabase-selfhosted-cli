# Supabase Selfhosted CLI

CLI for **self-hosted Supabase** — on a VPS, in Docker on a remote server, or running locally on your machine. Wraps the repetitive work you do by hand: deploy edge functions, restart the runtime, push migrations, and regenerate TypeScript types.

Inspired by the official Supabase CLI, but built for self-hosted layouts on your own VPS (Docker, Docker Compose, or bare metal) instead of Supabase Cloud.

## Install

```bash
npm install -g supabase-selfhosted-cli
```

Or run from source:

```bash
git clone https://github.com/spykesocial/supabase-selfhosted-cli.git
cd supabase-selfhosted-cli
npm install
npm link
```

You still need the [Supabase CLI](https://supabase.com/docs/guides/cli) installed for `db push` and `gen types` (this package shells out to it). Supabase CLI also uses docker to create its own copy of the remote instance so you'll need docker installed when generating types.

## Quick start

From your project root (where `supabase/migrations` lives):

```bash
supabase-selfhosted-cli setup
```

The wizard asks where your instance runs:

- **Local machine** — Docker / Docker Compose on this computer (copies files directly to your volume mount, runs restart locally)
- **Remote server** — VPS or cloud VM over SSH (SFTP upload + remote restart)

### Remote server (VPS) example

| Setting | Example |
| --- | --- |
| SSH user | `root` |
| Server IP | `203.0.113.10` |
| Functions destination | `/etc/supabase/volumes/functions` |
| SSH password | stored once in `~/.supabase-selfhosted-cli/` |
| Postgres tenant id | `your-tenant-id` (from `postgres.your-tenant-id`) |
| DB password | your pooler password |
| Migration port | `5453` |
| Types port | `6438` |
| Restart command | e.g. `docker restart <edge-container>` |

### Local Docker example

| Setting | Example |
| --- | --- |
| Functions destination | `/path/to/supabase/docker/volumes/functions` (absolute path to your edge-runtime volume mount) |
| Database host | `127.0.0.1` |
| Migration port | `5432` (or your exposed Postgres port) |
| Types port | `5432` |
| Restart command | `docker compose restart edge-runtime` or auto-detect edge container |

Setup creates `.supabase-selfhosted-cli.json` in your project so commands know which profile to use.

## Commands

### Deploy edge functions

**Remote (SSH)** — replaces:

```bash
scp -r supabase/functions/. root@203.0.113.10:/etc/supabase/volumes/functions
ssh root@203.0.113.10 'docker restart ...'
```

**Local (Docker)** — replaces manually copying into your Docker volume and restarting containers.

```bash
supabase-selfhosted-cli functions deploy
```

Flags:

- `--restart` — always restart after deploy
- `--no-restart` — never restart
- `--prune` — remove destination files/folders not present locally (use after deleting a function)
- default — prompts based on your setup preference

End-to-end verification against a configured project:

```bash
npm run build
./scripts/e2e-deploy-test.sh /path/to/your-project
```

### Push migrations

Replaces:

```bash
npx supabase db push --db-url postgresql://postgres.your-tenant-id:...@host:5453/postgres --yes
```

```bash
supabase-selfhosted-cli db push
supabase-selfhosted-cli db push --debug
```

### Generate TypeScript types

Replaces:

```bash
npx supabase gen types typescript --db-url postgresql://...@host:6438/postgres --schema public > database.types.ts
```

```bash
supabase-selfhosted-cli gen types
supabase-selfhosted-cli gen types -o database.types.ts
```

### Manage credentials

```bash
supabase-selfhosted-cli settings
```

- Show masked configuration
- Re-run setup wizard
- Delete stored credentials

## Configuration storage

- Profiles: `~/.supabase-selfhosted-cli/profiles/<name>.json` (mode `600`)
- Project link: `.supabase-selfhosted-cli.json` in your repo

Passwords are stored locally on your machine. Delete them anytime via `supabase-selfhosted-cli settings`.

## Multiple projects / instances

Use named profiles:

```bash
supabase-selfhosted-cli setup --profile production
supabase-selfhosted-cli setup --profile local-docker
supabase-selfhosted-cli functions deploy --profile production
```

## Restart command tips

Self-hosted setups differ. During setup, provide any shell command that works for your target:

```bash
# Docker (auto-detect edge container name)
docker ps --format '{{.Names}}' | grep -i edge | head -n 1 | xargs -I{} docker restart {}

# Docker Compose (local or remote)
docker compose restart edge-runtime

# Docker Compose from stack directory on the server
cd /etc/supabase/compose && docker compose restart edge-runtime

# systemd
systemctl restart supabase-edge-runtime
```

## Roadmap

- OS keychain integration for secrets
- Remote profile sync for teams
- Migration status, function diff, and health checks

## License

MIT
