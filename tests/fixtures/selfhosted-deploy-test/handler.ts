const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function optionsResponse() {
  return new Response("ok", { headers: corsHeaders });
}

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
