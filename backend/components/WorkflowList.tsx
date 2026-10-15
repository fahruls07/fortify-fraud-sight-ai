"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, Gauge, Plus, Timer, Upload, Workflow } from "lucide-react";
import { validateWorkflow, type metrics } from "@/lib/workflows";
import { ago } from "@/lib/format";
import { usePager } from "./Pager";
import { SkelCards, SkelTable } from "./Skeleton";

type Row = { id: string; name: string; description?: string; status: "Draft" | "Active" | "Archived"; version: number; deployedVersion?: number; nodes: number; updatedAt: string; updatedBy: string; metrics: ReturnType<typeof metrics>; endpoint?: { slug: string; enabled: boolean; calls: number; lastCallAt?: string }; serves?: string | null; role?: string };
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);
export const STATUS_CLS = { Active: "LOW", Draft: "MEDIUM", Archived: "" } as const;

export default function WorkflowList({ canManage, canDeploy }: { canManage: boolean; canDeploy: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null), [status, setStatus] = useState(""), [q, setQ] = useState(""), [err, setErr] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const load = () => fetch("/api/workflows").then((r) => r.json()).then(setRows);
  useEffect(() => { load(); }, []);
  async function toggle(r: Row) { const res = await fetch(`/api/workflows/${r.id}/${r.endpoint!.enabled ? "endpoint-off" : "endpoint-on"}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); if (res.ok) load(); }
  const needle = q.trim().toLowerCase();
  const shown = (rows ?? []).filter((r) => (!status || r.status === status) && (!needle || `${r.id} ${r.name} ${r.description ?? ""}`.toLowerCase().includes(needle)));
  const pager = usePager(shown);
  const active = (rows ?? []).filter((r) => r.status === "Active"), runs = active.reduce((n, r) => n + r.metrics.runs24h, 0);
  const avg = active.filter((r) => r.metrics.avgMs !== null), err24 = active.reduce((n, r) => n + (r.metrics.errorRate ?? 0) * r.metrics.runs, 0), total = active.reduce((n, r) => n + r.metrics.runs, 0);

  async function importJson(f: File) {
    if (file.current) file.current.value = "";
    let raw: unknown; try { raw = JSON.parse(await f.text()); } catch { return setErr(`${f.name} is not valid JSON.`); }
    const v = validateWorkflow(raw);
    if ("error" in v) return setErr(`Import failed: ${v.error}`);
    const r = await fetch("/api/workflows", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v.workflow) }), j = await r.json();
    if (!r.ok) return setErr(j.error);
    router.push(`/workflows/${j.id}`);
  }

  return (
    <>
      <div className="hdr">
        {<div><h1 style={{ margin: 0 }}>Workflows</h1><span className="mute">Visual fraud response workflows. Deployed versions run in shadow mode on every new transfer: actions are recorded, never enforced.</span></div>}
        {canManage && <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
          <button className="ico-btn" onClick={() => file.current?.click()}><Upload size={15} /> Import JSON</button>
          <Link className="btn ico-btn" href="/workflows/new"><Plus size={15} /> New workflow</Link>
        </span>}
      </div>
      {err && <p className="auth-err" role="alert">{err}</p>}

      {(!rows ? <SkelCards n={4} /> : (
        <div className="kpis">
          <div className="card kpi"><span className="ico"><Workflow size={18} /></span><span className="mute">Active workflows</span><b>{active.length}</b><span className="mute">of {rows.length} total</span></div>
          <div className="card kpi"><span className="ico bt"><Activity size={18} /></span><span className="mute">Runs, last 24 h</span><b>{runs}</b><span className="mute">{(runs / 24).toFixed(1)} per hour</span></div>
          <div className="card kpi"><span className="ico teal"><Timer size={18} /></span><span className="mute">Avg execution time</span><b>{avg.length ? `${(avg.reduce((n, r) => n + r.metrics.avgMs!, 0) / avg.length).toFixed(2)} ms` : "—"}</b><span className="mute">Across active workflows</span></div>
          <div className="card kpi"><span className="ico"><Gauge size={18} /></span><span className="mute">Error rate</span><b>{total ? pct(err24 / total) : "—"}</b><span className="mute">{total} runs recorded</span></div>
        </div>
      ))}

      <div className="filters">
        <input value={q} onChange={(e) => { setQ(e.target.value); pager.reset(); }} placeholder="Search name or description…" style={{ minWidth: 260 }} aria-label="Search workflows" />
        <select value={status} onChange={(e) => { setStatus(e.target.value); pager.reset(); }} aria-label="Status filter"><option value="">All statuses</option><option>Active</option><option>Draft</option><option>Archived</option></select>
      </div>
      {!rows ? <SkelTable cols={6} /> : (
        <div className="card tablewrap">
          <table>
            <thead><tr><th>Name</th><th>Status</th><th>Version</th><th>Last run</th><th>Success rate</th><th>Runs (24 h)</th><th>API endpoint</th><th>Updated</th><th /></tr></thead>
            <tbody>
              {pager.shown.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => router.push(`/workflows/${r.id}`)}>
                  <td><b>{r.name}</b>{r.role && <span className="chip LOW" style={{ marginLeft: 6 }} title="Default workflow bound to its built-in route">Default</span>}<div className="mute">{r.id} · {r.nodes} nodes{r.description && ` · ${r.description.slice(0, 60)}${r.description.length > 60 ? "…" : ""}`}</div></td>
                  <td><span className={`chip ${STATUS_CLS[r.status]}`}>{r.status}</span></td>
                  <td>v{r.version}{r.deployedVersion && <div className="mute">deployed v{r.deployedVersion}{r.deployedVersion !== r.version && " · changes not deployed"}</div>}</td>
                  <td>{r.metrics.lastRun ? ago(r.metrics.lastRun) : <span className="mute">Never</span>}</td>
                  <td>{r.metrics.successRate === null ? <span className="mute">—</span> : <span className={r.metrics.successRate < 0.95 ? "HIGH" : "LOW"}><b>{pct(r.metrics.successRate)}</b></span>}</td>
                  <td>{r.metrics.runs24h}</td>
                  <td onClick={(e) => e.stopPropagation()}>{r.role ? <div style={{ display: "grid", gap: 4 }}><code title="Fixed default route">{({ transaction_created: "/api/transactions/score", login_attempt: "/api/events/login", account_update: "/api/events/account-update" } as Record<string, string>)[r.role]}</code><span className="mute">default route · fixed</span></div> : r.endpoint ? <div style={{ display: "grid", gap: 4 }}>
                    <code title="POST endpoint for the banking app">/api/flows/{r.endpoint.slug}</code>
                    <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      {canDeploy ? <button className={`switch${r.endpoint.enabled ? " on" : ""}`} role="switch" aria-checked={r.endpoint.enabled} onClick={() => toggle(r)}><i />{r.endpoint.enabled ? "Active" : "Inactive"}</button>
                        : <span className={`chip ${r.endpoint.enabled ? "LOW" : ""}`}>{r.endpoint.enabled ? "Active" : "Inactive"}</span>}
                      <span className="mute">{r.endpoint.calls} calls</span></span></div> : <span className="mute">Not published</span>}</td>
                  <td className="mute">{ago(r.updatedAt)}<div>{r.updatedBy}</div></td>
                  <td onClick={(e) => e.stopPropagation()}><Link className="btn" href={`/workflows/${r.id}`}>Open</Link></td>
                </tr>
              ))}
              {!shown.length && <tr><td colSpan={9} className="mute empty">No workflows found.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {pager.bar}
    </>
  );
}
