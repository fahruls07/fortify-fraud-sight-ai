import { readFileSync } from "node:fs";
import { join } from "node:path";
import { consoleSpec } from "@/lib/apicatalog";
import { COOKIE, verifySession } from "@/lib/auth";

export const dynamic = "force-dynamic";

const SWAGGER = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14";
const ib = () => readFileSync(join(/*turbopackIgnore: true*/ process.cwd(), "openapi", "fortify-fraud-ib.yaml"), "utf8");
const page = (signedIn: boolean) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>FraudSight AI API reference</title><link rel="stylesheet" href="${SWAGGER}/swagger-ui.css">
<style>body{margin:0;background:#fafafa;font-family:Inter,system-ui,sans-serif} .top{display:flex;gap:16px;align-items:center;padding:12px 20px;background:#1a1a2e;color:#fff} .top a{color:#c4b5fd} .note{padding:10px 20px;background:#fff7ed;color:#9a3412;font-size:14px;border-bottom:1px solid #fed7aa}</style></head>
<body><div class="top"><b>FraudSight AI API reference</b><span style="opacity:.7">Internet banking + console</span><span style="margin-left:auto"><a href="/api/openapi?format=yaml">Banking spec (YAML)</a>${signedIn ? ` · <a href="/api/openapi?spec=console">Console spec (JSON)</a>` : ""} · <a href="/">Back to console</a></span></div>
${signedIn ? "" : `<div class="note">Showing the internet-banking API only. <a href="/login?next=/api/openapi">Sign in</a> to see every console API.</div>`}
<div id="ui"></div><script src="${SWAGGER}/swagger-ui-bundle.js"></script><script src="${SWAGGER}/swagger-ui-standalone-preset.js"></script>
<script>SwaggerUIBundle({ dom_id: "#ui", urls: [{ url: "/api/openapi?format=yaml", name: "Internet banking fraud API" }${signedIn ? `, { url: "/api/openapi?spec=console", name: "Console API (all endpoints)" }` : ""}],
  presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset], layout: "StandaloneLayout", deepLinking: true, docExpansion: "list", filter: true, tryItOutEnabled: false });</script></body></html>`;

// Public. Browsers get the interactive reference; tools get YAML (?format=yaml, or any non-HTML Accept). The console spec needs a session.
export function GET(req: Request) {
  const q = new URL(req.url).searchParams, signedIn = !!verifySession(req.headers.get("cookie")?.match(new RegExp(`(?:^|; )${COOKIE}=([^;]+)`))?.[1]);
  if (q.get("spec") === "console") return signedIn ? Response.json(consoleSpec()) : Response.json({ error: "Sign in to view the console API." }, { status: 401 });
  if (q.get("format") === "yaml" || !(req.headers.get("accept") ?? "").includes("text/html"))
    return new Response(ib(), { headers: { "Content-Type": "application/yaml; charset=utf-8", "Content-Disposition": 'inline; filename="fortify-fraud-ib.yaml"' } });
  return new Response(page(signedIn), { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
