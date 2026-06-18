#!/usr/bin/env bash
set -euo pipefail

# End-to-end deploy verification for supabase-selfhosted-cli.
# Requires: project dir with .supabase-selfhosted-cli.json, .env.local with SUPABASE URL/key, built CLI.
#
# Usage:
#   ./scripts/e2e-deploy-test.sh /path/to/your-project

PROJECT_DIR="${1:-}"
CLI="${CLI:-$(cd "$(dirname "$0")/.." && pwd)/dist/cli.js}"

if [[ -z "$PROJECT_DIR" || ! -d "$PROJECT_DIR/supabase/functions" ]]; then
  echo "Usage: $0 /path/to/project-with-supabase-functions" >&2
  exit 1
fi

if [[ ! -f "$CLI" ]]; then
  echo "CLI not built. Run: npm run build" >&2
  exit 1
fi

FIXTURE_DIR="$(cd "$(dirname "$0")/.." && pwd)/tests/fixtures/selfhosted-deploy-test"
TARGET_DIR="$PROJECT_DIR/supabase/functions/selfhosted-deploy-test"
SHARED_CORS="$PROJECT_DIR/supabase/functions/_shared/cors.ts"

if [[ ! -f "$SHARED_CORS" ]]; then
  echo "Missing $SHARED_CORS — project must have edge functions layout." >&2
  exit 1
fi

cleanup() {
  rm -rf "$TARGET_DIR"
}
trap cleanup EXIT

copy_fixture() {
  mkdir -p "$TARGET_DIR"
  cp "$FIXTURE_DIR/handler.ts" "$TARGET_DIR/"
  cat > "$TARGET_DIR/handler.ts" <<'EOF'
import { jsonResponse, optionsResponse } from "../_shared/cors.ts";

export async function handleSelfhostedDeployTest(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return optionsResponse();
  }

  if (request.method !== "GET" && request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  return jsonResponse({
    ok: true,
    function: "selfhosted-deploy-test",
    deployedAt: "2026-06-18",
  });
}
EOF
  cp "$FIXTURE_DIR/handler.test.ts" "$TARGET_DIR/"
  cat > "$TARGET_DIR/index.ts" <<'EOF'
// @ts-nocheck
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { handleSelfhostedDeployTest } from "./handler.ts";

serve((request) => handleSelfhostedDeployTest(request));
EOF
}

echo "==> Running fixture unit tests"
npx --yes deno test --allow-env --allow-net=none "$FIXTURE_DIR/handler.test.ts"

echo "==> Copying smoke function into project"
copy_fixture

echo "==> Running project handler tests"
npx --yes deno test --allow-env --allow-net=none "$TARGET_DIR/handler.test.ts"

echo "==> Deploying with restart"
(cd "$PROJECT_DIR" && node "$CLI" functions deploy --restart)

echo "==> Verifying live endpoints"
set -a
# shellcheck disable=SC1091
source "$PROJECT_DIR/.env.local"
set +a

URL="${EXPO_PUBLIC_SUPABASE_URL:?missing EXPO_PUBLIC_SUPABASE_URL}"
KEY="${EXPO_PUBLIC_SUPABASE_ANON_KEY:?missing EXPO_PUBLIC_SUPABASE_ANON_KEY}"

bootstrap_body="$(curl -fsS -X POST "$URL/functions/v1/bootstrap-status" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{}')"
echo "bootstrap-status: $bootstrap_body"

test_body="$(curl -fsS -X GET "$URL/functions/v1/selfhosted-deploy-test" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json")"
echo "selfhosted-deploy-test: $test_body"

if [[ "$test_body" != *'"ok":true'* ]]; then
  echo "Expected selfhosted-deploy-test to return ok:true" >&2
  exit 1
fi

echo "==> Removing smoke function locally"
rm -rf "$TARGET_DIR"
trap - EXIT

echo "==> Redeploying with prune + restart"
(cd "$PROJECT_DIR" && node "$CLI" functions deploy --prune --restart)

test_status="$(curl -sS -o /tmp/selfhosted-deploy-test-body.txt -w "%{http_code}" -X GET "$URL/functions/v1/selfhosted-deploy-test" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json")"
test_body_after="$(cat /tmp/selfhosted-deploy-test-body.txt)"
rm -f /tmp/selfhosted-deploy-test-body.txt
echo "selfhosted-deploy-test after prune (HTTP $test_status): $test_body_after"

if [[ "$test_status" == "200" ]]; then
  echo "Expected selfhosted-deploy-test to fail after prune deploy" >&2
  exit 1
fi

bootstrap_after="$(curl -fsS -X POST "$URL/functions/v1/bootstrap-status" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{}')"
echo "bootstrap-status after prune: $bootstrap_after"

echo "E2E deploy verification passed."
