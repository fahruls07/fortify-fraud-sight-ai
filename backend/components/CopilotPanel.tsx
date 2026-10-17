"use client";
import { useEffect, useRef, useState } from "react";
import { BookOpen, Brain, CheckCircle2, ChevronDown, Circle, ClipboardCopy, Cpu, Download, FileSearch, Gauge, ListChecks, Loader2, RefreshCw, ScanSearch, ShieldAlert, Sparkles, Wrench, X, Zap } from "lucide-react";
import type { Investigation, InvestigationReport, TraceEvent } from "@/lib/types";
import { toast } from "./Toaster";

type Doc = { docId: string; title: string; body: string };
type Level = InvestigationReport["riskLevel"];
const cap = (s: string) => s[0] + s.slice(1).toLowerCase();
const RANK: Record<Level, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
const TYPOLOGY: Record<string, { label: string; hint: string }> = {
  SOCIAL_ENGINEERING_SCREEN_SHARING: { label: "Social engineering · screen sharing", hint: "A third party is remotely controlling or coaching the customer's session." },
  MULE_ACCOUNT: { label: "Mule account", hint: "The beneficiary is used to receive and move stolen funds." },
  ACCOUNT_TAKEOVER: { label: "Account takeover", hint: "Someone other than the customer is using the account." },
  PHISHING_CREDENTIAL_THEFT: { label: "Phishing / credential theft", hint: "Credentials were stolen and used from a new device or location." },
  AUTHORISED_PUSH_PAYMENT: { label: "Authorised push payment scam", hint: "The customer sends the money themselves after being deceived." },
  NONE: { label: "No fraud pattern", hint: "Signals are consistent with the customer's normal behaviour." },
};
const ACTION: Record<string, { label: string; cls: string }> = {
  ALLOW: { label: "Allow", cls: "LOW" }, CHALLENGE: { label: "Challenge customer", cls: "MEDIUM" }, HOLD: { label: "Hold for review", cls: "MEDIUM" },
  DECLINE: { label: "Decline", cls: "HIGH" }, DECLINE_AND_FREEZE: { label: "Decline & freeze account", cls: "CRITICAL" },
};
// Expected agent plan, used to show progress while the live trace streams in.
const PLAN = [
  { key: "plan", label: "Plan investigation", icon: Brain },
  { key: "get_transaction", label: "Transaction details", icon: FileSearch },
  { key: "get_customer_profile", label: "Customer 360 profile & baseline", icon: FileSearch },
  { key: "get_session_signals", label: "Device & behaviour signals", icon: ScanSearch },
  { key: "get_network_links", label: "Beneficiary network", icon: Zap },
  { key: "search_typology_playbooks", label: "Fraud typology playbooks", icon: BookOpen },
  { key: "synthesize", label: "Write the assessment", icon: Sparkles },
];
const stepKey = (e: TraceEvent) => (e.step === "tool" ? e.tool ?? "tool" : e.step);

// Half-circle risk gauge (0..3 = LOW..CRITICAL), with confidence underneath.
function RiskGauge({ level, confidence }: { level: Level; confidence: number }) {
  const v = (RANK[level] + 0.5) / 4, a = Math.PI * (1 - v), r = 52, cx = 64, cy = 62;
  const arc = (from: number, to: number) => { const p = (t: number) => [cx + r * Math.cos(Math.PI * (1 - t)), cy - r * Math.sin(Math.PI * (1 - t))]; const [x1, y1] = p(from), [x2, y2] = p(to); return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`; };
  return (
    <div className="cp-gauge" role="img" aria-label={`Risk ${level}, confidence ${Math.round(confidence * 100)}%`}>
      <svg viewBox="0 0 128 72" width="150">
        {(["LOW", "MEDIUM", "HIGH", "CRITICAL"] as Level[]).map((l, i) => <path key={l} d={arc(i / 4 + 0.01, (i + 1) / 4 - 0.01)} className={`seg ${l}${RANK[l] <= RANK[level] ? " on" : ""}`} />)}
        <line x1={cx} y1={cy} x2={cx + (r - 14) * Math.cos(a)} y2={cy - (r - 14) * Math.sin(a)} className="needle" /><circle cx={cx} cy={cy} r="5" className="hub" />
      </svg>
      <b className={level}>{cap(level)}</b>
      <span className="mute">AI risk level</span>
      <div className="cp-conf"><i style={{ width: `${Math.round(confidence * 100)}%` }} /></div>
      <span className="mute">{Math.round(confidence * 100)}% confidence</span>
    </div>
  );
}

function Progress({ events, running }: { events: TraceEvent[]; running: boolean }) {
  const seen = new Map(events.map((e) => [stepKey(e), e]));
  const extra = events.filter((e) => !PLAN.some((p) => p.key === stepKey(e)));
  const doneCount = PLAN.filter((p) => seen.has(p.key)).length;
  const current = running ? PLAN.find((p) => !seen.has(p.key))?.key : null;
  return (
    <div className="cp-steps">
      <div className="cp-bar"><i style={{ width: `${running ? Math.max(8, (doneCount / PLAN.length) * 100) : 100}%` }} /></div>
      <ol>
        {PLAN.map(({ key, label, icon: Icon }) => {
          const e = seen.get(key), st = e ? "done" : key === current ? "now" : "todo";
          return (
            <li key={key} className={st}>
              <span className="cp-step-ico">{st === "done" ? <CheckCircle2 size={16} /> : st === "now" ? <Loader2 size={16} className="spin" /> : <Circle size={16} />}</span>
              <span className="cp-step-txt"><b><Icon size={13} /> {label}</b>{e && <small className="mute">{e.detail}</small>}</span>
              {e && <span className="mute cp-ms">{e.ms} ms</span>}
            </li>
          );
        })}
        {extra.map((e, i) => <li key={`x${i}`} className="done"><span className="cp-step-ico"><Wrench size={15} /></span><span className="cp-step-txt"><b>{e.tool ?? e.step}</b><small className="mute">{e.detail}</small></span><span className="mute cp-ms">{e.ms} ms</span></li>)}
      </ol>
    </div>
  );
}

// Very small markdown renderer for playbooks: headings, bold, bullet lists, paragraphs. Text only (no HTML injection).
function Md({ text }: { text: string }) {
  const bold = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : p));
  return <div className="cp-md">{text.split(/\n{2,}/).map((blk, i) => {
    if (/^#{1,3} /.test(blk)) return <h4 key={i}>{blk.replace(/^#+ /, "")}</h4>;
    if (/^\s*[-*] /m.test(blk)) return <ul key={i}>{blk.split("\n").filter((l) => l.trim()).map((l, j) => <li key={j}>{bold(l.replace(/^\s*[-*] /, ""))}</li>)}</ul>;
    return <p key={i}>{bold(blk)}</p>;
  })}</div>;
}

export default function CopilotPanel({ alertId, investigationId, onReport, baseline }: { alertId: string; investigationId: string | null; onReport: (r: InvestigationReport | null) => void; baseline?: { score: number; level: string } }) {
  const [state, setState] = useState<"idle" | "running" | "done" | "failed">("idle");
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [report, setReport] = useState<InvestigationReport | null>(null);
  const [cached, setCached] = useState(false);
  const [error, setError] = useState("");
  const [doc, setDoc] = useState<Doc | null>(null);
  const [done, setDone] = useState<Set<number>>(new Set());
  const [trace, setTrace] = useState(false);
  const es = useRef<EventSource | null>(null);

  function follow(id: string) {
    es.current?.close();
    setState("running"); setEvents([]); setReport(null); setError(""); setDone(new Set());
    const s = (es.current = new EventSource(`/api/investigations/${id}/stream`));
    s.addEventListener("step", (e) => setEvents((p) => [...p, JSON.parse((e as MessageEvent).data)]));
    s.addEventListener("result", (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      setReport(d.report); setCached(d.fallback); setState("done"); onReport(d.report); s.close();
    });
    s.addEventListener("failed", (e) => { setError(JSON.parse((e as MessageEvent).data).error); setState("failed"); s.close(); });
  }
  useEffect(() => {
    if (investigationId) fetch(`/api/investigations/${investigationId}`).then((r) => r.json()).then((i: Investigation) => {
      if (i.status === "done") { setReport(i.report!); setCached(i.fallback); setEvents(i.events); setState("done"); onReport(i.report!); }
      else follow(i.id);
    });
    return () => es.current?.close();
  }, [investigationId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function start() {
    setState("running"); setEvents([]); setReport(null);
    const r = await fetch(`/api/alerts/${alertId}/investigate`, { method: "POST" });
    const j = await r.json();
    if (!r.ok) { setError(j.error); return setState("failed"); }
    follow(j.investigationId);
  }
  const open = (docId: string) => fetch(`/api/kb/${docId}`).then((r) => r.json()).then(setDoc);
  const total = events.reduce((n, e) => n + e.ms, 0), maxMs = Math.max(1, ...events.map((e) => e.ms));
  const asText = (r: InvestigationReport) => [`FraudSight Copilot assessment for ${alertId}`, `Risk: ${r.riskLevel} (${Math.round(r.confidence * 100)}% confidence) · ${TYPOLOGY[r.typology]?.label ?? r.typology}`, `Recommended: ${ACTION[r.recommendedAction]?.label ?? r.recommendedAction}`, "", r.headline, r.summary, "", "Reasons:", ...r.reasonCodes.map((c) => `- [${c.severity}] ${c.code}: ${c.evidence}. ${c.explanation}`), "", `Baseline vs AI: ${r.baselineComparison}`, "", "Next steps:", ...r.nextSteps.map((n) => `- ${n}`), "", `Sources: ${r.citations.map((c) => c.docId).join(", ")}`].join("\n");
  const copy = () => report && navigator.clipboard?.writeText(asText(report)).then(() => toast("Assessment copied", "info"));
  const exportJson = () => { if (!report) return; const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify({ alertId, report, trace: events }, null, 2)], { type: "application/json" })); a.download = `copilot-${alertId}.json`; a.click(); URL.revokeObjectURL(a.href); };
  const sorted = report ? [...report.reasonCodes].sort((a, b) => RANK[b.severity] - RANK[a.severity]) : [];
  const counts = (["CRITICAL", "HIGH", "MEDIUM", "LOW"] as Level[]).map((l) => [l, sorted.filter((c) => c.severity === l).length] as const).filter(([, n]) => n);
  const ty = report ? TYPOLOGY[report.typology] ?? { label: report.typology, hint: "" } : null, act = report ? ACTION[report.recommendedAction] ?? { label: report.recommendedAction, cls: "" } : null;

  return (
    <div className="cp">
      <div className="cp-hero">
        <span className="cp-logo"><Sparkles size={20} /></span>
        <div><b>FraudSight Copilot</b><div className="cp-sub">{state === "running" ? "Investigating: pulling profile, session, network and playbooks…" : state === "done" ? `Assessment ready${total ? ` · ${(total / 1000).toFixed(1)} s` : ""}` : state === "failed" ? "Investigation failed" : "AI investigator: explains the risk, cites playbooks and recommends an action. The decision stays with you."}</div></div>
        <span className="cp-hero-tools">
          {state === "done" && <span className={`chip ${cached ? "MEDIUM" : "LOW"}`} title={cached ? "Gemini unavailable: prepared fallback assessment" : "Generated by Gemini"}><Cpu size={12} /> {cached ? "Fallback" : "Gemini"}</span>}
          <button className="btn ico-btn" onClick={start} disabled={state === "running"}>{state === "running" ? <><Loader2 size={15} className="spin" /> Analyzing…</> : report ? <><RefreshCw size={15} /> Re-run</> : <><Sparkles size={15} /> Investigate with AI</>}</button>
        </span>
      </div>

      {state === "failed" && <p className="auth-err" role="alert">{error}</p>}
      {state === "idle" && !report && (
        <div className="card cp-empty">
          <ShieldAlert size={28} className="wf-ai-ico" />
          <b>No AI assessment yet</b>
          <span className="mute">The Assistant reads the customer&apos;s baseline, session signals, beneficiary network and the bank&apos;s fraud playbooks, then writes an evidence-based assessment in about 5 seconds.</span>
          <button className="btn ico-btn" onClick={start}><Sparkles size={15} /> Investigate with AI</button>
        </div>
      )}
      {state === "running" && <div className="card"><Progress events={events} running /></div>}

      {report && state !== "running" && <>
        <div className="card cp-verdict">
          <RiskGauge level={report.riskLevel} confidence={report.confidence} />
          <div className="cp-verdict-main">
            <div className="filters" style={{ margin: 0 }}>
              <span className="chip cp-ty" title={ty!.hint}>{ty!.label}</span>
              {counts.map(([l, n]) => <span key={l} className={`chip ${l}`}>{n} {l.toLowerCase()}</span>)}
            </div>
            <h3 className="cp-headline">{report.headline}</h3>
            <p className="cp-summary">{report.summary}</p>
            <div className={`cp-rec ${act!.cls}`}><Gauge size={16} /><span>Assistant recommends <b>{act!.label}</b></span><span className="mute">— highlighted in the Decision panel</span></div>
          </div>
        </div>

        <div className="cp-section-h"><ShieldAlert size={15} /><b>Why: evidence</b><span className="mute">{sorted.length} reason codes, strongest first</span></div>
        <div className="cp-reasons">
          {sorted.map((rc) => (
            <div key={rc.code} className={`cp-reason ${rc.severity}`}>
              <div className="hdr" style={{ margin: 0 }}><span className={`chip ${rc.severity}`}>{rc.severity}</span><b>{rc.code.replace(/^RC_/, "").replaceAll("_", " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())}</b><code className="mute" style={{ marginLeft: "auto" }}>{rc.code}</code></div>
              <code className="cp-evidence">{rc.evidence}</code>
              <span className="cp-expl">{rc.explanation}</span>
            </div>
          ))}
        </div>

        <div className="cp-cols">
          <div className="card cp-compare">
            <div className="cp-section-h" style={{ margin: 0 }}><Gauge size={15} /><b>Baseline engine vs AI</b></div>
            <div className="cp-vs">
              <div><span className="mute">Baseline rules</span>{baseline ? <><b className={baseline.level}>{cap(baseline.level)}</b><small className="mute">score {baseline.score}</small></> : <b>—</b>}</div>
              <span className="cp-arrow">→</span>
              <div><span className="mute">Assistant</span><b className={report.riskLevel}>{cap(report.riskLevel)}</b><small className="mute">{Math.round(report.confidence * 100)}% confidence</small></div>
            </div>
            {baseline && RANK[report.riskLevel] !== RANK[baseline.level as Level] && <span className={`chip ${RANK[report.riskLevel] > RANK[baseline.level as Level] ? "HIGH" : "LOW"}`}>{RANK[report.riskLevel] > RANK[baseline.level as Level] ? "AI escalated the risk" : "AI lowered the risk"}</span>}
            <p className="cp-summary" style={{ margin: 0 }}>{report.baselineComparison}</p>
          </div>
          <div className="card cp-next">
            <div className="cp-section-h" style={{ margin: 0 }}><ListChecks size={15} /><b>Next steps</b><span className="mute">{done.size}/{report.nextSteps.length} done</span></div>
            <div className="cp-bar"><i style={{ width: `${(done.size / Math.max(1, report.nextSteps.length)) * 100}%` }} /></div>
            <ul>{report.nextSteps.map((n, i) => (
              <li key={i}><label className={done.has(i) ? "done" : ""}><input type="checkbox" checked={done.has(i)} onChange={(e) => setDone((p) => { const x = new Set(p); if (e.target.checked) x.add(i); else x.delete(i); return x; })} /> {n}</label></li>
            ))}</ul>
          </div>
        </div>

        {report.citations.length > 0 && <>
          <div className="cp-section-h"><BookOpen size={15} /><b>Sources</b><span className="mute">bank playbooks the assessment relies on</span></div>
          <div className="cp-sources">{report.citations.map((c) => <button key={c.docId} className="cp-source" onClick={() => open(c.docId)}><BookOpen size={14} /><span><b>{c.docId}</b><small className="mute">{c.title}</small></span></button>)}</div>
        </>}

        <div className="card cp-trace">
          <button className="cp-trace-h" onClick={() => setTrace(!trace)} aria-expanded={trace}><Brain size={15} /><b>Agent reasoning trace</b><span className="mute">{events.length} steps · {(total / 1000).toFixed(2)} s</span><ChevronDown size={16} style={{ marginLeft: "auto", rotate: trace ? "180deg" : "0deg", transition: "rotate .15s" }} /></button>
          {trace && <ol className="cp-trace-list">{events.map((e, i) => (
            <li key={i}><code>{e.tool ?? e.step}</code><span className="cp-trace-detail">{e.detail}</span><span className="cp-trace-bar"><i style={{ width: `${(e.ms / maxMs) * 100}%` }} /></span><span className="mute">{e.ms} ms</span></li>
          ))}</ol>}
        </div>
        <div className="filters" style={{ justifyContent: "flex-end", margin: 0 }}>
          <button className="ico-btn" onClick={copy}><ClipboardCopy size={14} /> Copy assessment</button>
          <button className="ico-btn" onClick={exportJson}><Download size={14} /> Export JSON</button>
        </div>
        <p className="mute" style={{ fontSize: 12, margin: 0 }}>AI-generated from the console&apos;s data. It recommends; the analyst decides.</p>
      </>}

      {doc && (
        <aside className="drawer wide" role="dialog" aria-label={doc.title}>
          <div className="hdr"><BookOpen size={18} /><div><b>{doc.docId}</b><div className="mute">{doc.title}</div></div><button className="icon" style={{ marginLeft: "auto" }} onClick={() => setDoc(null)} aria-label="Close"><X size={18} /></button></div>
          <Md text={doc.body} />
        </aside>
      )}
    </div>
  );
}
