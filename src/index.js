const config = {
  "max-vms": "10",
  "start_url": "https://jrdn-vm-engine.pages.dev",
  "timeout": {
    "main": 10000,
    "afk": 120,
    "offline": 5,
    "warning": 60
  },
  "dark": true,
  "tagbase": "zena-vm",
  "mobile": true,
  "search_engine": "duckduckgo",
  "quality": "smooth",
};

const HYPERBEAM_API_BASE = "https://engine.hyperbeam.com/v0";
const MAX_ACTIVE_VMS = parseInt(config['max-vms'] || "10", 10);

const log = {
  info: console.log,
  warn: console.warn,
  error: console.error,
  success: console.log
};

function requireApiKey(env) {
  if (!env.HB_API_KEY || env.HB_API_KEY === "NULL-KEY") {
    return new Response(JSON.stringify({
      error: "ConfigurationError",
      message: "Hyperbeam API key is not configured on the server.",
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
  return null;
}

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const apiKeyErrorResponse = requireApiKey(env);
    if (apiKeyErrorResponse) {
      return new Response(apiKeyErrorResponse.body, {
        status: apiKeyErrorResponse.status,
        headers: { ...corsHeaders, ...apiKeyErrorResponse.headers }
      });
    }

    const HB_API_KEY = env.HB_API_KEY;
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/start-vm") {
      try {
        const listResponse = await fetch(`${HYPERBEAM_API_BASE}/vm`, {
          headers: { Authorization: `Bearer ${HB_API_KEY}` },
        });
        if (!listResponse.ok) {
          const errorData = await listResponse.json().catch(() => ({}));
          return new Response(JSON.stringify({
            error: "HyperbeamAPIError",
            message: "Failed to list VMs",
            details: errorData
          }), { status: listResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        const activeVMs = await listResponse.json();
        if (activeVMs.length >= MAX_ACTIVE_VMS) {
          return new Response(JSON.stringify({
            error: "TooManyVMs",
            message: "Too many VMs active."
          }), { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const tag = url.searchParams.get("tag") || `${config.tagbase}-${Date.now()}`;
        const vmConfig = {
          start_url: config.start_url,
          timeout: {
            absolute: config.timeout?.main || 10000,
            inactive: config.timeout?.afk || 120,
            offline: config.timeout?.offline || 5,
            warning: config.timeout?.warning || 60
          },
          webgl: true,
          dark: config.dark,
          tag,
          touch_gestures: { swipe: config.mobile, pinch: config.mobile },
          search_engine: config.search_engine,
          quality: { mode: config.quality }
        };

        const createResponse = await fetch(`${HYPERBEAM_API_BASE}/vm`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${HB_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(vmConfig)
        });

        if (!createResponse.ok) {
          const errorData = await createResponse.json().catch(() => ({}));
          return new Response(JSON.stringify({
            error: "HyperbeamAPIError",
            message: "Failed to create VM",
            details: errorData
          }), { status: createResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const newInstance = await createResponse.json();
        return new Response(JSON.stringify({
  url: newInstance.embed_url
}), {
  headers: { ...corsHeaders, "Content-Type": "application/json" }
});


      } catch (e) {
        return new Response(JSON.stringify({
          error: "InternalServerError",
          message: e.message
        }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    if (request.method === "GET" && url.pathname.startsWith("/session/")) {
      const sessionId = url.pathname.split("/").pop();
      if (!sessionId) {
        return new Response("Bad Request", { status: 400, headers: corsHeaders });
      }
      const resp = await fetch(`${HYPERBEAM_API_BASE}/vm/${sessionId}`, {
        headers: { Authorization: `Bearer ${HB_API_KEY}` }
      });
      if (!resp.ok) {
        return new Response("Not Found", { status: resp.status, headers: corsHeaders });
      }
      const data = await resp.json();
      return new Response(`
        <html><head><style>html,body,iframe{margin:0;padding:0;height:100%;width:100%;border:0}</style></head>
        <body><iframe src="${data.embed_url}" allow="clipboard-read; clipboard-write; fullscreen *; microphone; camera; autoplay; display-capture"></iframe></body>
        </html>
      `, { status: 200, headers: { 'Content-Type': 'text/html', ...corsHeaders } });
    }

    if (request.method === "DELETE" && url.pathname.startsWith("/kill-vm/")) {
      const sessionId = url.pathname.split("/").pop();
      if (!sessionId) {
        return new Response(JSON.stringify({ error: "BadRequest" }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const deleteUrl = `${HYPERBEAM_API_BASE}/vm/${sessionId}`;
      const deleteResponse = await fetch(deleteUrl, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${HB_API_KEY}` },
      });
      if (deleteResponse.status === 204 || deleteResponse.status === 200) {
        return new Response(JSON.stringify({ message: `VM ${sessionId} exited.` }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      return new Response("Error", { status: deleteResponse.status, headers: corsHeaders });
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  }
};
