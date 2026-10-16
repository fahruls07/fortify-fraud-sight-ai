
import { runDeployed, servingWorkflow } from "@/lib/flows";
import { errorResponse, submitEvent } from "@/lib/transfers";

export const dynamic = "force-dynamic";

const allowedOrigins = [
  "http://localhost:5173",
  "https://fortify-japac.cloud.run/"
];

function corsHeaders(req: Request): Headers {
  const headers = new Headers();
  const origin = req.headers.get("origin") ?? "";

  if (allowedOrigins.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }

  headers.set(
    "Access-Control-Allow-Methods",
    "POST, OPTIONS"
  );
  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  return headers;
}

function jsonResponse(
  req: Request,
  data: unknown,
  status = 200
): Response {
  const headers = corsHeaders(req);
  headers.set("Content-Type", "application/json");

  return new Response(JSON.stringify(data), {
    status,
    headers,
  });
}

// Browser calls this before the actual POST request.
export async function OPTIONS(req: Request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(req),
  });
}

// Banking app: score a login attempt (ALLOW / CHALLENGE / DENY).
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const w = servingWorkflow("login_attempt");

    if (w) {
      const r = (await runDeployed(
        w,
        body,
        false,
        false
      )) as {
        eventId?: string;
        decision: string;
        score?: number;
        reasons?: string[];
        message?: string;
      };

      return jsonResponse(req, {
        eventId: r.eventId,
        decision: r.decision,
        score: r.score,
        reasons: r.reasons,
        message: r.message,
        decidedBy: `workflow ${w.id} v${w.deployedVersion}`,
      });
    }

    return jsonResponse(req, {
      ...submitEvent("login_attempt", body),
      decidedBy: "built-in",
    });
  } catch (e) {
    const result = errorResponse(e);
    const headers = new Headers(result.headers);
    const cors = corsHeaders(req);

    cors.forEach((value, key) => headers.set(key, value));

    return new Response(result.body, {
      status: result.status,
      statusText: result.statusText,
      headers,
    });
  }
}
