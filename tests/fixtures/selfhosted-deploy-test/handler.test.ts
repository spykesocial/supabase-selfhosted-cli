import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleSelfhostedDeployTest } from "./handler.ts";

Deno.test("handleSelfhostedDeployTest returns ok payload on GET", async () => {
  const response = await handleSelfhostedDeployTest(
    new Request("https://example.com/functions/v1/selfhosted-deploy-test", {
      method: "GET",
    }),
  );

  const body = await response.json();
  assertEquals(body, {
    ok: true,
    function: "selfhosted-deploy-test",
    deployedAt: "2026-06-18",
  });
});
