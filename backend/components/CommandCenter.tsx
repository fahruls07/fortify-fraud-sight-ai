"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Chart from "chart.js/auto";
import { useChart } from "./useChart";
import AssistantPopup from "./AssistantPopup";
import { Activity, Gauge, ShieldAlert, ThumbsDown } from "lucide-react";
import type { Overview } from "@/lib/overview";
import { ago, idr } from "@/lib/format";
import { Skel, SkelCards, SkelTable } from "./Skeleton";

// Green = safe, orange = warning, red = fraud.
const C = { safe: "#10b981", warn: "#f59e0b", fraud: "#ef4444", critical: "#991b1b", grid: "rgba(127,127,127,.15)", text: "#8a8f9c" };
const SEV_COLOR = { LOW: C.safe, MEDIUM: C.warn, HIGH: C.fraud, CRITICAL: C.critical };
type Level = "ok" | "warn" | "down";
const WORST: Level[] = ["down", "warn", "ok"];
const cap = (s: string) => s[0] + s.slice(1).toLowerCase();
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);

export default function CommandCenter() {
  const [range, setRange] = useState("24h"), [severity, setSeverity] = useState(""), [status, setStatus] = useState("");
  const [o, setO] = useState<Overview | null>(null);
  const [api, setApi] = useState<{ level: Level; ms: number }>({ level: "ok", ms: 0 });
  const [stream, setStream] = useState<Level>("warn");
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [updated, setUpdated] = useState("");
  const qs = new URLSearchParams({ range, ...(severity && { severity }), ...(status && { status }) }).toString();

  const load = useRef(() => {});
  load.current = () => {
    const t0 = performance.now();
    fetch(`/api/dashboard/overview?${qs}`).then((r) => { if (!r.ok) throw new Error(); return r.json(); }).then((d: Overview) => {
      const ms = Math.round(performance.now() - t0);
      setO(d); setApi({ level: ms > 1500 ? "warn" : "ok", ms }); setUpdated(new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Jakarta" }) + " WIB");
    }).catch(() => setApi({ level: "down", ms: 0 }));
  };
  useEffect(() => { setO(null); load.current(); const t = setInterval(() => load.current(), 60000); return () => clearInterval(t); }, [qs]);

  // Live: every new or updated alert refreshes the numbers (debounced) and flashes the new row.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const es = new EventSource("/api/alerts/stream");
    const refresh = () => { clearTimeout(t); t = setTimeout(() => load.current(), 400); };
    es.onopen = () => setStream("ok");
    es.onerror = () => setStream(es.readyState === EventSource.CLOSED ? "down" : "warn");
    es.addEventListener("alert.created", (e) => {
      const id = JSON.parse((e as MessageEvent).data).id;
      setFresh((p) => new Set(p).add(id)); setTimeout(() => setFresh((p) => { const n = new Set(p); n.delete(id); return n; }), 3000);
      refresh();
    });
    es.addEventListener("alert.updated", refresh);
    return () => { es.close(); clearTimeout(t); };
  }, []);

  const fmtBucket = (iso: string) => new Date(iso).toLocaleString("en-GB", range === "24h" ? { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" } : { timeZone: "Asia/Jakarta", day: "2-digit", month: "short" });
  const lineRef = useChart((el) => new Chart(el, {
    type: "line",
    data: {
      labels: o?.trend.map((b) => fmtBucket(b.start)) ?? [],
      datasets: [
        { label: "Flagged alerts", data: o?.trend.map((b) => b.alerts) ?? [], borderColor: C.warn, backgroundColor: "rgba(245,158,11,.12)", fill: true, tension: .35, pointRadius: 2 },
        { label: "Confirmed fraud", data: o?.trend.map((b) => b.fraud) ?? [], borderColor: C.fraud, backgroundColor: C.fraud, tension: .35, pointRadius: 3 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      plugins: { legend: { labels: { color: C.text, usePointStyle: true } } },
      scales: { x: { grid: { display: false }, ticks: { color: C.text, maxTicksLimit: 12 } }, y: { beginAtZero: true, grid: { color: C.grid }, ticks: { color: C.text, precision: 0 } } },
    },
  }), [o, range]);
  const sevKeys = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
  const pieRef = useChart((el) => new Chart(el, {
    type: "doughnut",
    data: { labels: sevKeys.map(cap), datasets: [{ data: sevKeys.map((k) => o?.severity[k] ?? 0), backgroundColor: sevKeys.map((k) => SEV_COLOR[k]), borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: "62%", plugins: { legend: { position: "bottom", labels: { color: C.text, usePointStyle: true } } } },
  }), [o]);

  const checks: { name: string; level: Level; detail: string }[] = [
    { name: "Scoring API", level: api.level, detail: api.level === "down" ? "Not responding" : `${api.ms} ms` },
    { name: "Live alert stream", level: stream, detail: stream === "ok" ? "Connected" : stream === "warn" ? "Reconnecting…" : "Disconnected" },
    { name: "AI Assistant", level: o?.aiMode === "live" ? "ok" : "warn", detail: o?.aiMode === "live" ? "Gemini live" : "Template fallback" },
    { name: "High-risk backlog", level: !o ? "ok" : o.openHigh > 15 ? "down" : o.openHigh > 5 ? "warn" : "ok", detail: `${o?.openHigh ?? "—"} open` },
  ];
  const overall = WORST.find((l) => checks.some((c) => c.level === l))!;
  const OVERALL = { ok: "All systems operational", warn: "Degraded: needs attention", down: "Critical: action required" };
  const sevTotal = o ? sevKeys.reduce((n, k) => n + o.severity[k], 0) : 0;

  return (
    <>
      <div className="hdr">
        <div><h1 style={{ margin: 0 }}>Command Center</h1><span className="mute">Real-time fraud monitoring. Numbers update live as alerts arrive{updated && ` · last update ${updated}`}.</span></div>
        <span className={`sys-pill ${overall}`} style={{ marginLeft: "auto" }}><i />{OVERALL[overall]}</span>
      </div>

      <div className="card filterbar">
        <label className="field"><span>Time range</span>
          <select value={range} onChange={(e) => setRange(e.target.value)}><option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></select></label>
        <label className="field"><span>Severity</span>
          <select value={severity} onChange={(e) => setSeverity(e.target.value)}><option value="">All severities</option>{sevKeys.map((k) => <option key={k} value={k}>{cap(k)}</option>)}</select></label>
        <label className="field"><span>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option><option>New</option><option>Investigating</option><option>Decided</option></select></label>
        {(range !== "24h" || severity || status) && <button onClick={() => { setRange("24h"); setSeverity(""); setStatus(""); }}>Reset</button>}
      </div>

      {!o ? <SkelCards n={4} /> : (
        <div className="kpis">
          <div className="card kpi stat"><span className="ico bt"><Activity size={18} /></span><span className="mute">Total transactions</span><b>{o.totalTransactions.toLocaleString("en-US")}</b><span className="mute">{o.flaggedAlerts} flagged for review</span></div>
          <div className="card kpi stat fraud"><span className="ico"><ShieldAlert size={18} /></span><span className="mute">Fraud detected</span><b>{o.fraudDetected}</b><span className="mute">{idr(o.fraudAmount)} confirmed by analysts</span></div>
          <div className={`card kpi stat ${o.falsePositiveRate === null ? "" : o.falsePositiveRate > .5 ? "warn" : "safe"}`}><span className="ico"><ThumbsDown size={18} /></span><span className="mute">False positive rate</span><b>{pct(o.falsePositiveRate)}</b><span className="mute">Not fraud, of {o.decided} decided</span></div>
          <div className={`card kpi stat ${o.averageScore === null ? "" : o.averageScore >= 70 ? "fraud" : o.averageScore >= 40 ? "warn" : "safe"}`}><span className="ico"><Gauge size={18} /></span><span className="mute">Average risk score</span><b>{o.averageScore ?? "—"}<small className="mute"> / 100</small></b><span className="mute">Across flagged alerts</span></div>
        </div>
      )}

      <div className="cc-grid">
        <div className="card"><div className="hdr" style={{ margin: "0 0 8px" }}><b>Fraud trend</b><span className="mute" style={{ marginLeft: "auto" }}>per {range === "24h" ? "hour" : "day"}</span></div>
          <div className="chart-box">{o ? <canvas ref={lineRef} aria-label="Fraud trend line chart" role="img" /> : <Skel h={260} />}</div></div>
        <div className="card"><div className="hdr" style={{ margin: "0 0 8px" }}><b>Severity distribution</b><span className="mute" style={{ marginLeft: "auto" }}>{sevTotal} alerts</span></div>
          <div className="chart-box">{o ? (sevTotal ? <canvas ref={pieRef} aria-label="Severity distribution pie chart" role="img" /> : <p className="mute empty">No alerts in this range.</p>) : <Skel h={260} />}</div></div>
        <div className="card"><b>System status</b>
          <ul className="sys-list">
            {checks.map((c) => <li key={c.name}><span className={`sys-dot ${c.level}`} /><span>{c.name}</span><span className="mute" style={{ marginLeft: "auto" }}>{c.detail}</span></li>)}
          </ul>
          <p className="mute" style={{ margin: 0 }}>Green = healthy · Orange = degraded · Red = down</p>
        </div>
      </div>

      <div className="hdr" style={{ margin: "24px 0 12px" }}>
        <h2 style={{ margin: 0 }}>Latest suspicious transactions</h2><span className="live"><i /> Live</span>
        <Link href="/alerts" style={{ marginLeft: "auto", fontWeight: 500 }}>View all alerts →</Link>
      </div>
      {!o ? <SkelTable rows={10} cols={8} /> : (
        <div className="card tablewrap">
          <table>
            <thead><tr><th>Alert ID</th><th>Time</th><th>Customer</th><th className="num">Amount</th><th>Beneficiary</th><th>Score</th><th>Severity</th><th>Status</th><th /></tr></thead>
            <tbody>
              {o.latest.map((r) => (
                <tr key={r.id} className={fresh.has(r.id) ? "fresh" : ""}>
                  <td><b>{r.id}</b></td><td className="mute">{ago(r.createdAt)}</td><td>{r.customerName} <span className="mute">{r.maskedAccount}</span></td>
                  <td className="num">{idr(r.amount)}</td><td>{r.beneficiary.masked}{r.beneficiary.isNew && <span className="chip NEW">NEW</span>}</td>
                  <td><span className="score"><i style={{ width: `${r.baselineScore}%`, background: r.baselineScore >= 70 ? C.fraud : r.baselineScore >= 40 ? C.warn : C.safe }} /></span> {r.baselineScore}</td>
                  <td><span className={`chip ${r.severity}`}>{cap(r.severity)}</span></td>
                  <td><span className={`status ${r.status}`}>{r.status}</span></td>
                  <td><Link className="btn" href={`/alerts/${r.id}`}>Investigate</Link></td>
                </tr>
              ))}
              {!o.latest.length && <tr><td colSpan={9} className="mute empty">No suspicious transactions for these filters.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <AssistantPopup />
    </>
  );
}
