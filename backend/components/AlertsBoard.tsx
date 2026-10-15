"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BellRing, Check, CheckCheck, ExternalLink, X } from "lucide-react";
import type { AlertView, ViewStatus } from "@/lib/alertview";
import type { Alert, Transaction } from "@/lib/types";
import { ago, idr } from "@/lib/format";
import ActionBar from "./ActionBar";
import Sla from "./Sla";
import { usePager } from "./Pager";
import { Skel, SkelTable } from "./Skeleton";

const FIELDS = "id ruleName severity timestamp status score amount customerName maskedAccount beneficiary newBeneficiary assignedTo transactionId slaDueAt escalated caseId hitCount";
const LIST = `query GetAlerts($status: AlertStatus, $severity: Severity, $from: String, $to: String, $limit: Int) {
  alerts(status: $status, severity: $severity, from: $from, to: $to, limit: $limit) { ${FIELDS} }
}`;
const ACK = `mutation Ack($id: ID!) { acknowledgeAlert(id: $id) { ${FIELDS} } }`;
const SUB = (field: string) => `/api/graphql?query=${encodeURIComponent(`subscription { ${field} { ${FIELDS} } }`)}`;
const STATUS_LABEL: Record<ViewStatus, string> = { ACTIVE: "Active", ACKNOWLEDGED: "Acknowledged", RESOLVED: "Resolved" };
const STATUS_CLS: Record<ViewStatus, string> = { ACTIVE: "New", ACKNOWLEDGED: "Investigating", RESOLVED: "Decided" };
const cap = (s: string) => s[0] + s.slice(1).toLowerCase();
const dt = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Jakarta" });
const SEEN = "alerts-seen";

async function gql<T>(query: string, variables: object = {}): Promise<T> {
  const r = await fetch("/api/graphql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }) });
  const j = await r.json();
  if (j.errors?.length) throw new Error(j.errors[0].message);
  if (!r.ok) throw new Error(j.error ?? "Request failed");
  return j.data;
}

type Detail = { alert: Alert; transaction: Transaction };

// Queues: the same alert list cut by owner, severity and SLA.
const QUEUES = [
  { key: "all", label: "All alerts", test: () => true },
  { key: "mine", label: "My queue", test: (r: AlertView, me: string) => r.assignedTo === me && r.status !== "RESOLVED" },
  { key: "unassigned", label: "Unassigned", test: (r: AlertView) => !r.assignedTo && r.status !== "RESOLVED" },
  { key: "high", label: "High & critical", test: (r: AlertView) => (r.severity === "HIGH" || r.severity === "CRITICAL") && r.status !== "RESOLVED" },
  { key: "sla", label: "SLA breached", test: (r: AlertView) => r.escalated && r.status !== "RESOLVED" },
  { key: "cases", label: "In cases", test: (r: AlertView) => !!r.caseId },
] as const;

export default function AlertsBoard({ canAck, canResolve, canCase, me }: { canAck: boolean; canResolve: boolean; canCase: boolean; me: string }) {
  const [queue, setQueue] = useState<(typeof QUEUES)[number]["key"]>("all");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [cases, setCases] = useState<{ id: string; title: string; status: string }[]>([]), [target, setTarget] = useState("");
  useEffect(() => { if (canCase) fetch("/api/cases").then((r) => r.json()).then((l) => Array.isArray(l) && setCases(l.filter((c: { status: string }) => c.status !== "CLOSED"))); }, [canCase, picked.size === 0]);
  const togglePick = (id: string, on: boolean) => setPicked((p) => { const n = new Set(p); if (on) n.add(id); else n.delete(id); return n; });
  async function toCase() {
    const ids = [...picked];
    const r = await fetch(target ? `/api/cases/${target}/alerts` : "/api/cases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ alertIds: ids }) });
    if (r.ok) { const c = await r.json(); setPicked(new Set()); setTarget(""); load.current(); location.assign(`/cases/${c.id}`); }
  }
  const [rows, setRows] = useState<AlertView[] | null>(null);
  const [status, setStatus] = useState<"" | ViewStatus>(""), [severity, setSeverity] = useState(""), [from, setFrom] = useState(""), [to, setTo] = useState("");
  const [seen, setSeen] = useState<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<AlertView | null>(null);
  const [open, setOpen] = useState<{ id: string; detail: Detail | null } | null>(null);
  const [live, setLive] = useState(false), [err, setErr] = useState(""), [busy, setBusy] = useState("");
  const vars = { ...(status && { status }), ...(severity && { severity }), ...(from && { from }), ...(to && { to }), limit: 1000 };
  const key = JSON.stringify(vars);
  const load = useRef(() => {});
  load.current = () => gql<{ alerts: AlertView[] }>(LIST, vars).then((d) => { setRows(d.alerts); setErr(""); }).catch((e) => setErr(e.message));
  const inQueue = (rows ?? []).filter((r) => QUEUES.find((q) => q.key === queue)!.test(r, me));
  const pager = usePager(inQueue);

  // Unread = Active alerts this browser has not opened. First visit marks everything current as read.
  const saveSeen = (s: Set<string>) => { setSeen(s); try { localStorage.setItem(SEEN, JSON.stringify([...s].slice(-3000))); } catch {} };
  useEffect(() => { try { const raw = localStorage.getItem(SEEN); if (raw) setSeen(new Set(JSON.parse(raw))); } catch {} }, []);
  useEffect(() => { if (rows && seen === null) saveSeen(new Set(rows.map((r) => r.id))); }, [rows, seen]);

  useEffect(() => { setRows(null); pager.reset(); load.current(); const t = setInterval(() => load.current(), 5000); return () => clearInterval(t); }, [key]); // auto-refresh every 5 s

  // GraphQL subscriptions over SSE: new alerts toast + flash; updates refresh the list.
  useEffect(() => {
    const created = new EventSource(SUB("alertCreated")), updated = new EventSource(SUB("alertUpdated"));
    created.onopen = () => setLive(true); created.onerror = () => setLive(created.readyState === EventSource.OPEN);
    created.addEventListener("next", (e) => {
      const a: AlertView = JSON.parse((e as MessageEvent).data).data.alertCreated;
      setToast(a); setTimeout(() => setToast((t) => (t?.id === a.id ? null : t)), 6000);
      setFresh((p) => new Set(p).add(a.id)); setTimeout(() => setFresh((p) => { const n = new Set(p); n.delete(a.id); return n; }), 3000);
      load.current();
    });
    updated.addEventListener("next", () => load.current());
    return () => { created.close(); updated.close(); };
  }, []);

  const unread = (rows ?? []).filter((r) => r.status === "ACTIVE" && seen && !seen.has(r.id)).length;
  const markRead = (ids: string[]) => seen && saveSeen(new Set([...seen, ...ids]));

  async function show(id: string) {
    markRead([id]); setOpen({ id, detail: null });
    const r = await fetch(`/api/alerts/${id}`);
    if (r.ok) { const d = await r.json(); setOpen((o) => (o?.id === id ? { id, detail: { alert: d.alert, transaction: d.transaction } } : o)); }
  }
  async function ack(id: string) {
    setBusy(id); setErr("");
    try { await gql(ACK, { id }); markRead([id]); load.current(); if (open?.id === id) show(id); } catch (e) { setErr((e as Error).message); }
    setBusy("");
  }
  const cur = open && rows?.find((r) => r.id === open.id);
  const clear = () => { setStatus(""); setSeverity(""); setFrom(""); setTo(""); };

  return (
    <>
      <div className="hdr">
        <div>
          <h1 style={{ margin: 0, display: "flex", alignItems: "center", gap: 10 }}>Alert Queues {unread > 0 && <span className="badge big-badge" title="Unread active alerts">{unread} unread</span>}</h1>
          <span className="mute">Fraud alerts raised by rules, watchlists and the scoring engine, organised in work queues. Acknowledge to take an alert; resolve it with a decision. Auto-refreshes every 5 seconds.</span>
        </div>
        <span style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
          <span className={`live${live ? "" : " off"}`}><i /> {live ? "Live" : "Connecting…"}</span>
          {unread > 0 && <button className="ico-btn" onClick={() => markRead((rows ?? []).map((r) => r.id))}><CheckCheck size={16} /> Mark all read</button>}
        </span>
      </div>

      <div className="auth-tabs queue-tabs" role="tablist" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        {QUEUES.map((q) => { const n = (rows ?? []).filter((r) => q.test(r, me)).length; return <button key={q.key} role="tab" aria-selected={queue === q.key} onClick={() => { setQueue(q.key); pager.reset(); }}>{q.label} <span className={q.key === "sla" && n ? "badge" : "mute"}>{n}</span></button>; })}
      </div>
      <div className="card filterbar">
        <label className="field"><span>Status</span><select value={status} onChange={(e) => setStatus(e.target.value as ViewStatus)}><option value="">All statuses</option><option value="ACTIVE">Active</option><option value="ACKNOWLEDGED">Acknowledged</option><option value="RESOLVED">Resolved</option></select></label>
        <label className="field"><span>Severity</span><select value={severity} onChange={(e) => setSeverity(e.target.value)}><option value="">All severities</option>{["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((s) => <option key={s} value={s}>{cap(s)}</option>)}</select></label>
        <label className="field"><span>From</span><input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="field"><span>To</span><input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>
        {(status || severity || from || to) && <button onClick={clear}>Clear filters</button>}
      </div>
      {err && <p className="auth-err" role="alert">{err}</p>}

      {canCase && picked.size > 0 && <div className="card selbar on">
        <b>{picked.size} selected</b><button className="linkish" onClick={() => setPicked(new Set())}>Clear</button>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Case"><option value="">New case</option>{cases.map((c) => <option key={c.id} value={c.id}>Add to {c.id} · {c.title.slice(0, 40)}</option>)}</select>
          <button className="btn" onClick={toCase}>{target ? "Add to case" : "Create case"}</button>
        </span>
      </div>}
      {!rows ? <SkelTable cols={6} /> : (
        <div className="card tablewrap">
          <table>
            <thead><tr>{canCase && <th style={{ width: 36 }} />}<th>ID</th><th>Rule name</th><th>Severity</th><th>Timestamp</th><th>Status</th><th style={{ textAlign: "right" }}>Action</th></tr></thead>
            <tbody>
              {pager.shown.map((r) => {
                const isUnread = r.status === "ACTIVE" && seen && !seen.has(r.id);
                return (
                  <tr key={r.id} className={`clickable${fresh.has(r.id) ? " fresh" : ""}${open?.id === r.id ? " wf-on" : ""}${isUnread ? " unread-row" : ""}`} onClick={() => show(r.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && show(r.id)}>
                    {canCase && <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={picked.has(r.id)} onChange={(e) => togglePick(r.id, e.target.checked)} aria-label={`Select ${r.id}`} /></td>}
                    <td>{isUnread && <span className="unread-dot" aria-label="Unread" />}<b>{r.id}</b>{r.hitCount > 0 && <div><span className="chip HIGH" title="Watchlist / AML hit">⚑ {r.hitCount} hit</span></div>}</td>
                    <td>{r.ruleName}<div className="mute">{r.customerName} · {idr(r.amount)}</div></td>
                    <td><span className={`chip ${r.severity}`}>{cap(r.severity)}</span></td>
                    <td>{dt(r.timestamp)}<div className="mute">{ago(r.timestamp)}</div></td>
                    <td><span className={`status ${STATUS_CLS[r.status]}`}>{STATUS_LABEL[r.status]}</span>{r.assignedTo && <div className="mute">{r.assignedTo}</div>}
                      <div><Sla due={r.slaDueAt ?? undefined} start={r.timestamp} done={r.status === "RESOLVED"} /></div>{r.caseId && <div className="mute">{r.caseId}</div>}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <span style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                        {canAck && r.status === "ACTIVE" && <button className="ico-btn" disabled={busy === r.id} onClick={() => ack(r.id)}><Check size={15} /> Acknowledge</button>}
                        {canResolve && r.status !== "RESOLVED" && <button className="btn ico-btn" onClick={() => show(r.id)}><CheckCheck size={15} /> Resolve</button>}
                        {r.status === "RESOLVED" && <button onClick={() => show(r.id)}>View</button>}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {!inQueue.length && <tr><td colSpan={7} className="mute empty">No alerts in this queue.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {pager.bar}

      {open && (
        <div className="drawer wide" role="dialog" aria-label={`Alert ${open.id}`}>
          <div className="hdr"><b style={{ fontSize: 18 }}>{open.id}</b>{cur && <span className={`chip ${cur.severity}`}>{cap(cur.severity)}</span>}{cur && <span className={`status ${STATUS_CLS[cur.status]}`}>{STATUS_LABEL[cur.status]}</span>}
            <button className="icon" style={{ marginLeft: "auto" }} onClick={() => setOpen(null)} aria-label="Close"><X size={18} /></button></div>
          {!cur || !open.detail ? <div style={{ display: "grid", gap: 10 }}><Skel h={18} /><Skel /><Skel w="70%" /><Skel h={120} /></div> : <>
            <dl className="kv">
              <dt>Rule</dt><dd>{cur.ruleName}</dd>
              <dt>Raised</dt><dd>{dt(cur.timestamp)} WIB</dd>
              <dt>Customer</dt><dd>{cur.customerName} <span className="mute">{cur.maskedAccount}</span></dd>
              <dt>Amount</dt><dd>{idr(cur.amount)}</dd>
              <dt>Beneficiary</dt><dd>{open.detail.transaction.beneficiary.name} · {open.detail.transaction.beneficiary.bankName} {cur.newBeneficiary && <span className="chip NEW">NEW</span>}</dd>
              <dt>Risk score</dt><dd>{cur.score} / 100</dd>
              <dt>Transaction</dt><dd>{cur.transactionId} · {open.detail.transaction.status}</dd>
              <dt>Assigned to</dt><dd>{cur.assignedTo ?? "Unassigned"}</dd>
            </dl>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
              {canAck && cur.status === "ACTIVE" && <button className="ico-btn" disabled={busy === cur.id} onClick={() => ack(cur.id)}><Check size={15} /> Acknowledge</button>}
              <Link className="button ico-btn" href={`/alerts/${cur.id}`}><ExternalLink size={15} /> Open full investigation</Link>
            </div>
            {canResolve
              ? <ActionBar alert={open.detail.alert} tx={open.detail.transaction} onDone={(r) => { setOpen({ id: cur.id, detail: { alert: r.alert, transaction: r.transaction } }); load.current(); }} />
              : <p className="mute">You do not have permission to resolve alerts.</p>}
          </>}
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          <BellRing size={18} />
          <span><b>New {toast.severity.toLowerCase()} alert {toast.id}</b><small>{toast.ruleName} · {toast.customerName} · {idr(toast.amount)}</small></span>
          <button className="linkish" onClick={() => { show(toast.id); setToast(null); }}>View</button>
          <button className="icon" onClick={() => setToast(null)} aria-label="Dismiss"><X size={16} /></button>
        </div>
      )}
    </>
  );
}
