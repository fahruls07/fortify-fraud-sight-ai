"use client";
import { useEffect, useState } from "react";
import type { AuditEvent } from "@/lib/types";
import { usePager } from "../Pager";
import { SkelTable } from "../Skeleton";

const dt = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Jakarta" }) + " WIB";
const day = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }); // YYYY-MM-DD in WIB, matches <input type=date>

export default function AuditTab() {
  const [audit, setAudit] = useState<AuditEvent[] | null>(null);
  const [from, setFrom] = useState(""), [to, setTo] = useState(""), [q, setQ] = useState("");
  useEffect(() => { fetch("/api/audit").then((r) => r.json()).then(setAudit); }, []);
  const needle = q.trim().toLowerCase();
  const shown = (audit ?? []).filter((e) => (!from || day(e.at) >= from) && (!to || day(e.at) <= to) &&
    (!needle || [e.id, e.actor, e.entityType, e.entityId, e.action, e.reason ?? "", JSON.stringify(e.before), JSON.stringify(e.after)].some((v) => v.toLowerCase().includes(needle))));
  const pager = usePager(shown);
  if (!audit) return <SkelTable cols={6} />;
  return (
    <>
      <div className="card filterbar">
        <label className="field"><span>From</span><input type="date" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); pager.reset(); }} /></label>
        <label className="field"><span>To</span><input type="date" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); pager.reset(); }} /></label>
        <label className="field" style={{ flex: 1, minWidth: 220 }}><span>Search</span><input style={{ width: "100%" }} value={q} onChange={(e) => { setQ(e.target.value); pager.reset(); }} placeholder="Actor, action, entity, ID, reason…" /></label>
        {(from || to || q) && <button onClick={() => { setFrom(""); setTo(""); setQ(""); }}>Clear filters</button>}
        <span className="mute">{shown.length} of {audit.length} events</span>
      </div>
      <div className="card tablewrap">
        <table>
          <thead><tr><th>ID</th><th>Time</th><th>Actor</th><th>Entity</th><th>Action</th><th>Reason</th></tr></thead>
          <tbody>
            {pager.shown.map((e) => <tr key={e.id}><td><b>{e.id}</b></td><td className="mute">{dt(e.at)}</td><td>{e.actor}</td><td>{e.entityType} <span className="mute">{e.entityId}</span></td><td><code>{e.action}</code></td><td className="mute">{e.reason ?? "—"}</td></tr>)}
            {!shown.length && <tr><td colSpan={6} className="mute empty">No audit events for these filters.</td></tr>}
          </tbody>
        </table>
      </div>
      {pager.bar}
    </>
  );
}
