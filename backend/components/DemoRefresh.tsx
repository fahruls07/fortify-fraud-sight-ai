"use client";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "./Toaster";

const EVT = "fortify:data-refreshed";
// Broadcast so any mounted list (Command Center, alert queue…) can refetch after the demo data moves.
export const onDataRefreshed = (fn: () => void) => {
  addEventListener(EVT, fn);
  return () => removeEventListener(EVT, fn);
};

// Admin-only demo control: re-anchors the seeded dataset into the last 24 h so the dashboard is never empty.
// Visibility is decided by the caller (Shell passes it only for admins); the API enforces it again.
export default function DemoRefresh() {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (busy || !confirm("Refresh demo data?\n\nTimestamps are moved forward so the last 24 hours are populated again. Cases, decisions, notes and audit logs are kept.")) return;
    setBusy(true);
    try {
      const r = await fetch("/api/demo/refresh", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { toast(j.error ?? `Refresh failed (HTTP ${r.status})`, "error"); return; }
      dispatchEvent(new Event(EVT));
      toast("Demo data refreshed", "success", `${j.alerts24h} alerts and ${j.transactions24h} transactions in the last 24 h`);
    } catch (e) { toast("Network error", "error", (e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <button className="icon" onClick={run} disabled={busy} aria-label="Refresh demo data" title="Refresh demo data (admin)" aria-busy={busy}>
      <RefreshCw size={18} className={busy ? "spin" : undefined} />
    </button>
  );
}
