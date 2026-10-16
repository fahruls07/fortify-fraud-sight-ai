import { userFrom } from "@/lib/auth";
import { audit } from "@/lib/auditlog";
import { getAccess } from "@/lib/acm";
import { persistNow, refresh } from "@/lib/store";

export const dynamic = "force-dynamic";

// Demo helper: rebuild the seeded timeline (30-day historic shape, 24h well populated) so every dashboard
// window looks alive. Deterministic: repeating the call yields the same result.
// Admin only — checkAuth below is a second line of defence; proxy.ts already gates the route by permission.
function forbidden(req: Request) {
  const user = userFrom(req);
  if (!user || user === "unknown") return Response.json({ error: "Unauthorized" }, { status: 401 });
  const a = getAccess(user);
  if (!a.active || !a.perms.includes("settings.config")) return Response.json({ error: "Forbidden: admin only." }, { status: 403 });
  return null;
}

export async function POST(req: Request) {
  const denied = forbidden(req);
  if (denied) return denied;
  const r = refresh();
  persistNow(); // don't wait for the 3 s snapshot: the refresh must survive an immediate restart
  audit({ actor: userFrom(req), entityType: "user", entityId: "demo.refresh", action: "REFRESH_DEMO_DATA", before: {}, after: { alerts24h: r.alerts24h, alertDays: r.alertDays, transactions24h: r.transactions24h } });
  return Response.json({ ok: true, ...r });
}
