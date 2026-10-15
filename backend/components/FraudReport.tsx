"use client";
import { useEffect, useState } from "react";
import Chart from "chart.js/auto";
import { CalendarClock, FileDown, FileSpreadsheet, FileText, Mail, Play, RefreshCw, ShieldAlert, ShieldCheck, Trash2, Undo2, X } from "lucide-react";
import { REPORTS, type ReportSummary, type ReportType } from "@/lib/report";
import type { Schedule } from "@/lib/schedules";
import { idr } from "@/lib/format";
import { usePager } from "./Pager";
import { Skel, SkelCards, SkelTable } from "./Skeleton";
import { useChart } from "./useChart";

type Row = Record<string, string | number>;
type Tally = { label: string; flagged: number; fraud: number };
type Charts = { byRule: Tally[]; daily: { day: string; flagged: number; fraud: number }[]; byCategory: Tally[]; rules: string[] };
type Data = { rows: Row[]; summary: ReportSummary; charts: Charts };
type Filter = { preset: string; from: string; to: string; rule: string; severity: string; alertId: string };

// Chart accents: blue = flagged / neutral, red = fraud.
const BLUE = "#3b82f6", RED = "#ef4444", PIE = ["#3b82f6", "#ef4444", "#60a5fa", "#f87171", "#1d4ed8", "#b91c1c", "#93c5fd"];
const TXT = "#94a3b8", GRID = "rgba(148,163,184,.12)";
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);
const NUM = /IDR|Amount/;
const jkt = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
const PRESETS: Record<string, string> = { today: "Today", "7d": "Last 7 days", "30d": "Last 30 days", custom: "Custom range" };
function range(f: Filter) {
  if (f.preset === "custom") return { from: f.from, to: f.to };
  const days = f.preset === "today" ? 0 : f.preset === "7d" ? 6 : 29;
  return { from: jkt(new Date(Date.now() - days * 864e5)), to: jkt(new Date()) };
}
const query = (type: ReportType, f: Filter) => {
  const r = range(f);
  return new URLSearchParams({ type, ...(r.from && { from: r.from }), ...(r.to && { to: r.to }), ...(f.rule && { rule: f.rule }), ...(f.severity && { severity: f.severity }), ...(f.alertId.trim() && { alertId: f.alertId.trim() }) }).toString();
};
const scales = { x: { grid: { display: false }, ticks: { color: TXT } }, y: { beginAtZero: true, grid: { color: GRID }, ticks: { color: TXT, precision: 0 } } };
const legend = { labels: { color: TXT, usePointStyle: true } };

export default function FraudReport({ canExport }: { canExport: boolean }) {
  const [type, setType] = useState<ReportType>("alerts");
  const [draft, setDraft] = useState<Filter>({ preset: "30d", from: "", to: "", rule: "", severity: "", alertId: "" });
  const [applied, setApplied] = useState(draft);
  const [data, setData] = useState<Data | null>(null), [stamp, setStamp] = useState("");
  const [modal, setModal] = useState<"email" | "schedule" | null>(null);
  const qs = query(type, applied);
  const rows = data?.rows ?? [];
  const { shown, bar, reset } = usePager(rows);

  const [nonce, setNonce] = useState(0); // "Generate" re-runs even when the filters did not change
  const generate = (f = draft) => { setApplied(f); setData(null); setNonce((n) => n + 1); };
  useEffect(() => {
    fetch(`/api/reports?${qs}`).then((r) => r.json()).then((d) => { setData(d.rows ? d : null); setStamp(new Date().toLocaleString("en-GB", { timeZone: "Asia/Jakarta" }) + " WIB"); reset(); });
  }, [qs, nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(draft) !== JSON.stringify(applied);
  const m = data?.summary, c = data?.charts, cols = Object.keys(rows[0] ?? {});
  const r = range(applied);

  const barRef = useChart((el) => new Chart(el, {
    type: "bar",
    data: { labels: c?.byRule.map((x) => x.label.length > 28 ? x.label.slice(0, 27) + "…" : x.label) ?? [], datasets: [
      { label: "Flagged", data: c?.byRule.map((x) => x.flagged) ?? [], backgroundColor: BLUE, borderRadius: 4 },
      { label: "Confirmed fraud", data: c?.byRule.map((x) => x.fraud) ?? [], backgroundColor: RED, borderRadius: 4 },
    ] },
    options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins: { legend }, scales: { x: scales.y, y: { grid: { display: false }, ticks: { color: TXT } } } },
  }), [c]);
  const lineRef = useChart((el) => new Chart(el, {
    type: "line",
    data: { labels: c?.daily.map((d) => new Date(`${d.day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })) ?? [], datasets: [
      { label: "Flagged", data: c?.daily.map((d) => d.flagged) ?? [], borderColor: BLUE, backgroundColor: "rgba(59,130,246,.15)", fill: true, tension: .35, pointRadius: 2 },
      { label: "Confirmed fraud", data: c?.daily.map((d) => d.fraud) ?? [], borderColor: RED, backgroundColor: RED, tension: .35, pointRadius: 3 },
    ] },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, plugins: { legend }, scales },
  }), [c]);
  const pieRef = useChart((el) => new Chart(el, {
    type: "pie",
    data: { labels: c?.byCategory.map((x) => x.label) ?? [], datasets: [{ data: c?.byCategory.map((x) => x.flagged) ?? [], backgroundColor: PIE, borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { ...legend, position: "bottom" }, tooltip: { callbacks: { afterLabel: (i) => `${c?.byCategory[i.dataIndex].fraud ?? 0} confirmed fraud` } } } },
  }), [c]);

  return (
    <>
      <div className="hdr">
        <div><h1 style={{ margin: 0 }}>Fraud Report</h1><span className="mute">Fraud outcomes, prevention and trends for the selected period{stamp && ` · generated ${stamp}`}.</span></div>
        <span className="rep-actions">
          <button className="btn ico-btn" onClick={() => generate()}><RefreshCw size={15} /> Generate report</button>
          {canExport && <>
            <button className="ico-btn" onClick={() => setModal("schedule")}><CalendarClock size={15} /> Schedule report</button>
            <button className="ico-btn" onClick={() => setModal("email")}><Mail size={15} /> Send via email</button>
          </>}
        </span>
      </div>

      <div className="card filterbar">
        <label className="field"><span>Date range</span>
          <select value={draft.preset} onChange={(e) => setDraft({ ...draft, preset: e.target.value })}>{Object.entries(PRESETS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        {draft.preset === "custom" && <>
          <label className="field"><span>From</span><input type="date" value={draft.from} max={draft.to || undefined} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /></label>
          <label className="field"><span>To</span><input type="date" value={draft.to} min={draft.from || undefined} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></label>
        </>}
        <label className="field"><span>Rule type</span>
          <select value={draft.rule} onChange={(e) => setDraft({ ...draft, rule: e.target.value })} style={{ maxWidth: 260 }}><option value="">All rules</option>{c?.rules.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label className="field"><span>Severity</span>
          <select value={draft.severity} onChange={(e) => setDraft({ ...draft, severity: e.target.value })}><option value="">All severities</option>{["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((s) => <option key={s} value={s}>{s[0] + s.slice(1).toLowerCase()}</option>)}</select></label>
        <label className="field"><span>Alert ID</span><input value={draft.alertId} onChange={(e) => setDraft({ ...draft, alertId: e.target.value })} onKeyDown={(e) => e.key === "Enter" && generate()} placeholder="e.g. ALT-001" style={{ width: 140 }} /></label>
        <button className={dirty ? "btn" : ""} onClick={() => generate()}>{dirty ? "Apply filters" : "Up to date"}</button>
        <span className="mute">{r.from || "start"} → {r.to || "today"}</span>
      </div>

      {!m ? <SkelCards n={3} /> : <>
        <div className="kpis rep-kpis">
          <div className="card kpi rep-card red"><span className="ico"><ShieldAlert size={20} /></span><span className="mute">Total fraud</span><b>{m.fraud}</b><span className="mute">{idr(m.fraudAmount)} confirmed · fraud rate {pct(m.fraudRate)}</span></div>
          <div className="card kpi rep-card blue"><span className="ico"><Undo2 size={20} /></span><span className="mute">Recovery rate</span><b>{pct(m.recoveryRate)}</b><span className="mute">Confirmed-fraud money stopped before it left</span></div>
          <div className="card kpi rep-card blue"><span className="ico"><ShieldCheck size={20} /></span><span className="mute">Prevention amount</span><b>{idr(m.prevented)}</b><span className="mute">Declined, frozen or challenged · {idr(m.onHold)} still on hold</span></div>
        </div>
        <div className="rep-mini">
          <span><b>{m.alerts}</b> alerts flagged</span><span><b>{idr(m.amount)}</b> flagged amount</span><span><b>{m.decided}</b> decided</span>
          <span><b>{m.open}</b> open</span><span><b>{m.notFraud}</b> false positives</span><span>AI agreement <b>{pct(m.aiAgreement)}</b></span>
        </div>
      </>}

      <div className="rep-charts">
        <div className="card"><b>Fraud by rule</b> <span className="mute">top 10</span><div className="chart-box">{c ? (c.byRule.length ? <canvas ref={barRef} role="img" aria-label="Fraud by rule bar chart" /> : <p className="mute empty">No data.</p>) : <Skel h={260} />}</div></div>
        <div className="card"><b>Fraud trend</b> <span className="mute">daily</span><div className="chart-box">{c ? <canvas ref={lineRef} role="img" aria-label="Daily fraud trend line chart" /> : <Skel h={260} />}</div></div>
        <div className="card"><b>Fraud by category</b> <span className="mute">flagged alerts</span><div className="chart-box">{c ? (c.byCategory.length ? <canvas ref={pieRef} role="img" aria-label="Fraud by category pie chart" /> : <p className="mute empty">No data.</p>) : <Skel h={260} />}</div></div>
      </div>

      <div className="hdr" style={{ margin: "24px 0 8px" }}>
        <h2 style={{ margin: 0 }}>Detail</h2>
        {canExport && <span className="rep-actions">
          <a className="button ico-btn" href={`/api/reports?${qs}&format=csv`} download><FileText size={15} /> CSV</a>
          <a className="button ico-btn" href={`/api/reports?${qs}&format=xls`} download><FileSpreadsheet size={15} /> Excel</a>
          {type === "str" && <a className="button ico-btn" href={`/api/reports?${qs}&format=xml`} download title="goAML-style XML draft for PPATK"><FileText size={15} /> XML (goAML)</a>}
          <button className="ico-btn" onClick={() => window.print()} disabled={!data}><FileDown size={15} /> PDF</button>
        </span>}
      </div>
      <div className="auth-tabs" role="tablist" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        {(Object.keys(REPORTS) as ReportType[]).map((t) => <button key={t} role="tab" aria-selected={t === type} onClick={() => { setType(t); setData(null); }}>{REPORTS[t]}</button>)}
      </div>
      {(type === "str" || type === "ojk") && <p className="mute" style={{ margin: "0 0 10px" }}>{type === "str" ? "Candidates for LTKM / STR to PPATK: confirmed fraud plus any blacklist / AML hit in the period." : "Fraud cases by category for OJK reporting: attempted, prevented and actual loss."} Drafts for compliance review: check the regulator's current format before submitting.</p>}
      {!data ? <SkelTable cols={8} /> : <>
        <div className="card tablewrap screen-only"><DetailTable cols={cols} rows={shown} /></div>
        {bar}
        {/* PDF = browser print of this full table (all rows), with the summary above it. */}
        <div className="print-only">
          <h2>{REPORTS[type]} · {r.from || "start"} to {r.to || "today"}</h2>
          {m && <p>Total fraud {m.fraud} ({idr(m.fraudAmount)}) · Recovery {pct(m.recoveryRate)} · Prevented {idr(m.prevented)} · {m.alerts} alerts</p>}
          <DetailTable cols={cols} rows={rows} />
        </div>
      </>}

      {modal === "email" && <EmailModal qs={qs} title={REPORTS[type]} onClose={() => setModal(null)} />}
      {modal === "schedule" && <ScheduleModal type={type} filter={applied} onClose={() => setModal(null)} />}
    </>
  );
}

function DetailTable({ cols, rows }: { cols: string[]; rows: Row[] }) {
  return (
    <table>
      <thead><tr>{cols.map((c) => <th key={c} className={NUM.test(c) ? "num" : ""}>{c}</th>)}</tr></thead>
      <tbody>
        {rows.map((r, i) => <tr key={i}>{cols.map((c) => {
          const v = r[c];
          if (NUM.test(c)) return <td key={c} className="num">{idr(v as number)}</td>;
          if (c === "Risk" || c === "Risk Level" || c === "AI Risk") return <td key={c}>{v && <span className={`chip ${v}`}>{v}</span>}</td>;
          if (c === "Outcome") return <td key={c}>{v && <span className={`chip ${v === "FRAUD" ? "HIGH" : "LOW"}`}>{v === "FRAUD" ? "Fraud" : "Not fraud"}</span>}</td>;
          if (c === "Alert ID") return <td key={c}><b>{v}</b></td>;
          return <td key={c}>{v}</td>;
        })}</tr>)}
        {!rows.length && <tr><td className="mute empty">No data for these filters.</td></tr>}
      </tbody>
    </table>
  );
}

function useSubmit() {
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const post = async (url: string, body: unknown, ok: (j: Record<string, unknown>) => string) => {
    setBusy(true); setMsg(null);
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), j = await r.json();
    setBusy(false); setMsg(r.ok ? { ok: ok(j) } : { error: j.error }); return r.ok ? j : null;
  };
  return { busy, msg, post, setMsg };
}
const delivered = (j: Record<string, unknown>) => (j.mode === "smtp" ? "Email sent." : `SMTP is not configured, so the email was saved to ${j.id}. Set SMTP_HOST to send for real.`);

function EmailModal({ qs, title, onClose }: { qs: string; title: string; onClose: () => void }) {
  const [to, setTo] = useState(""), [format, setFormat] = useState("xls"), [message, setMessage] = useState("");
  const { busy, msg, post } = useSubmit();
  return (
    <div className="drawer" role="dialog" aria-label="Send report via email">
      <div className="hdr"><Mail size={18} /><b>Send report via email</b><button className="icon" style={{ marginLeft: "auto" }} onClick={onClose} aria-label="Close"><X size={18} /></button></div>
      <p className="mute" style={{ marginTop: 0 }}>{title} with the current filters, attached as a file.</p>
      <div className="rule-form">
        <label className="field"><span>To</span><input value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@bank.co.id, other@bank.co.id" autoComplete="email" /></label>
        <label className="field"><span>Attachment</span><select value={format} onChange={(e) => setFormat(e.target.value)}><option value="xls">Excel (.xls)</option><option value="csv">CSV</option></select></label>
        <label className="field"><span>Message <span className="mute">(optional)</span></span><textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} /></label>
        {msg?.ok && <p className="ok-msg" style={{ margin: 0 }}>{msg.ok}</p>}
        {msg?.error && <p className="auth-err" style={{ margin: 0 }}>{msg.error}</p>}
        <button className="btn ico-btn" style={{ justifyContent: "center" }} disabled={busy || !to.trim()} onClick={() => post("/api/reports/email", { to, query: qs, format, message }, delivered)}><Mail size={15} /> {busy ? "Sending…" : "Send"}</button>
      </div>
    </div>
  );
}

function ScheduleModal({ type, filter, onClose }: { type: ReportType; filter: Filter; onClose: () => void }) {
  const [list, setList] = useState<Schedule[] | null>(null);
  const [f, setF] = useState({ name: `${REPORTS[type]} report`, frequency: "weekly", recipients: "", format: "xls" });
  const { busy, msg, post, setMsg } = useSubmit();
  const load = () => fetch("/api/reports/schedules").then((r) => r.json()).then(setList);
  useEffect(() => { load(); }, []);
  const dt = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) + " WIB" : "—");
  async function del(id: string) { await fetch(`/api/reports/schedules/${id}`, { method: "DELETE" }); load(); }
  async function run(id: string) { const j = await post(`/api/reports/schedules/${id}/run`, {}, (j) => `${id}: ${j.lastResult}`); if (j) load(); }
  return (
    <div className="drawer wide" role="dialog" aria-label="Schedule report">
      <div className="hdr"><CalendarClock size={18} /><b>Schedule report</b><button className="icon" style={{ marginLeft: "auto" }} onClick={onClose} aria-label="Close"><X size={18} /></button></div>
      <p className="mute" style={{ marginTop: 0 }}>Emails <b>{REPORTS[type]}</b>{filter.severity && `, severity ${filter.severity}`}{filter.rule && `, rule "${filter.rule}"`} at 07:00 WIB. Each run covers the period since the previous run.</p>
      <div className="rule-form">
        <label className="field"><span>Name</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <div className="wf-row">
          <label className="field"><span>Frequency</span><select value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })}><option value="daily">Daily</option><option value="weekly">Weekly (Monday)</option><option value="monthly">Monthly (1st)</option></select></label>
          <label className="field"><span>Format</span><select value={f.format} onChange={(e) => setF({ ...f, format: e.target.value })}><option value="xls">Excel</option><option value="csv">CSV</option></select></label>
        </div>
        <label className="field"><span>Recipients</span><input value={f.recipients} onChange={(e) => setF({ ...f, recipients: e.target.value })} placeholder="fraud-team@bank.co.id" /></label>
        {msg?.ok && <p className="ok-msg" style={{ margin: 0 }}>{msg.ok}</p>}
        {msg?.error && <p className="auth-err" style={{ margin: 0 }}>{msg.error}</p>}
        <button className="btn" disabled={busy || !f.recipients.trim()} onClick={async () => { if (await post("/api/reports/schedules", { ...f, type, severity: filter.severity, rule: filter.rule }, (j) => `${j.id} scheduled. First run ${dt(j.nextRunAt as string)}.`)) load(); }}>Create schedule</button>
      </div>
      <h3 style={{ margin: "20px 0 8px", fontSize: 14 }}>Scheduled reports</h3>
      {!list ? <Skel h={60} /> : !list.length ? <p className="mute">No schedules yet.</p> : (
        <ul className="imp-list">
          {list.map((s) => (
            <li key={s.id}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <span style={{ display: "grid", gap: 2, flex: 1 }}>
                  <b>{s.name} <span className="chip">{s.frequency}</span></b>
                  <small className="mute">{REPORTS[s.type]} · {s.format.toUpperCase()} → {s.recipients.join(", ")}</small>
                  <small className="mute">Next {dt(s.nextRunAt)} · Last {dt(s.lastRunAt)}{s.lastResult && ` (${s.lastResult})`}</small>
                </span>
                <button className="icon" title="Run now" aria-label="Run now" disabled={busy} onClick={() => { setMsg(null); run(s.id); }}><Play size={15} /></button>
                <button className="icon" title="Delete" aria-label="Delete schedule" onClick={() => del(s.id)}><Trash2 size={15} /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
