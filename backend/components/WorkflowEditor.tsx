"use client";
import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  addEdge, Background, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState, useReactFlow,
  type Connection, type Edge, type Node, type NodeProps,
} from "@xyflow/react";
import { ArrowLeft, Bell, Copy, Bot, Bug, Calculator, ChevronLeft, ChevronRight, Clock, Database, Download, GitFork, Sparkles, ShieldCheck, Globe, History, Gauge, Layers, ListChecks, Play, Plus, Rocket, Save, ScrollText, SkipForward, SlidersHorizontal, Tags, Target, Trash2, Upload, Archive, ArchiveRestore, X, Zap, RotateCcw, Filter } from "lucide-react";
import {
  ACTIONS, BASELINE_DEFAULT, BASELINE_LABEL, DEFAULT_ROUTE, EVENT_DEFAULT, EVENT_LABEL, CONDITIONS, CRITERIA_OPS, DB_QUERIES, FIELDS, GATEWAYS, KINDS, labelOf, SAMPLE_FIELDS, SOURCES, TARGETS, TRIGGERS, validateWorkflow,
  type Check, type CondField, type Crit, type Kind, type metrics, type Run, type ScoreItem, type Step, type TestEvent, type Version, type WfNode, type Workflow, type WorkflowBody,
} from "@/lib/workflows";
import type { Rule } from "@/lib/rules/dsl";
import { ago } from "@/lib/format";
import { STATUS_CLS } from "./WorkflowList";
import CopilotChat from "./CopilotChat";
import { Skel } from "./Skeleton";

type Detail = Omit<Workflow, "runs"> & { runs: Run[]; metrics: ReturnType<typeof metrics>; serves?: string | null };
type Debug = { steps: Step[]; fired: { id: string; action: string; target: string }[]; liveEdges: string[]; ms: number; cursor: number; errors: string[]; variables: Record<string, unknown> };
const MIME = "application/x-fortify-wfe";
const EDGE = { type: "smoothstep", markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 } } as const;
const ICON: Record<Kind, React.ReactNode> = {
  trigger: <Zap size={14} />, gateway: <GitFork size={14} />, timer: <Clock size={14} />, condition: <Filter size={14} />, criteria: <ListChecks size={14} />, rule: <ScrollText size={14} />,
  scoring: <Target size={14} />, aml_check: <ShieldCheck size={14} />, baseline_score: <Gauge size={14} />, rule_engine: <ListChecks size={14} />, event_score: <ShieldCheck size={14} />, calculation: <Calculator size={14} />, calc_field: <Tags size={14} />, db_query: <Database size={14} />, api_call: <Globe size={14} />, ai: <Bot size={14} />,
  action: <Bell size={14} />, parallel_action: <Layers size={14} />,
};
const TITLE = Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, v.title])) as Record<Kind, string>;
const DEFAULT: { [K in Kind]: Extract<WfNode, { type: K }>["data"] } = {
  trigger: { event: "transaction_created", source: "any" },
  condition: { mode: "AND", conditions: [{ field: "amount", operator: ">", value: 10000000 }] },
  criteria: { mode: "AND", criteria: [{ field: "score", operator: ">=", value: 60 }] },
  rule: { ruleId: "", output: "rule_hit" },
  gateway: { kind: "exclusive" },
  timer: { minutes: 15 },
  calculation: { expression: "amount / max(avg_daily_spend, 1)", output: "spend_ratio" },
  calc_field: { input: "score", output: "risk_band", buckets: [{ max: 29, label: "low" }, { max: 59, label: "medium" }], otherwise: "high" },
  scoring: { output: "score", base: 0, items: [{ field: "new_device", operator: "==", value: true, points: 20 }] },
  db_query: { query: "customer_tx_count_24h", output: "tx_24h" },
  api_call: { method: "GET", url: "https://", body: "", path: "", output: "api_result" },
  ai: { prompt: "How risky is this transfer of {{amount}} IDR?", output: "ai_risk" },
  aml_check: { output: "aml", failOnHit: false },
  baseline_score: structuredClone(BASELINE_DEFAULT),
  rule_engine: { output: "rules" },
  event_score: structuredClone(EVENT_DEFAULT),
  action: { action: "flag_for_review", target: "fraud_team", params: {} },
  parallel_action: { actions: [{ action: "flag_for_review", target: "fraud_team" }, { action: "notify_user", target: "customer" }] },
};
const GROUPS = ["Flow", "Logic", "Data", "Actions"] as const;
// Variables a node writes (offered as suggestions in Criteria / Scoring / Calculation).
const outputsOf = (n: { type?: string; data: unknown }): string[] => { const d = n.data as { output?: string }; return d.output ? (n.type === "ai" ? [d.output, `${d.output}_label`] : n.type === "aml_check" ? [`${d.output}_hit`, `${d.output}_score`, `${d.output}_reasons`] : n.type === "baseline_score" ? [`${d.output}_score`, `${d.output}_level`] : n.type === "rule_engine" ? [`${d.output}_action`, `${d.output}_hit`, `${d.output}_names`] : n.type === "event_score" ? [`${d.output}_score`, `${d.output}_decision`, `${d.output}_reasons`] : [d.output]) : []; };
const dt = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);

type D = Record<string, unknown> & { _dbg?: "current" | "passed" | "failed" };
function NodeCard({ id, type, data, selected }: NodeProps<Node<D>>) {
  const k = type as Kind, { _dbg, ...d } = data;
  return (
    <div className={`wfe-node ${k}${selected ? " sel" : ""}${_dbg ? ` dbg-${_dbg}` : ""}`}>
      {k !== "trigger" && <Handle type="target" position={Position.Top} />}
      <header><span className="wf-ico">{ICON[k]}</span><b>{TITLE[k]}</b><span className="mute">#{id}</span></header>
      <div className="wfe-label">{labelOf({ id, type: k, data: d } as WfNode)}</div>
      {k !== "action" && k !== "parallel_action" && <Handle type="source" position={Position.Bottom} />}
    </div>
  );
}
const NODE_TYPES = Object.fromEntries(Object.keys(KINDS).map((k) => [k, NodeCard]));
const strip = (d: D) => { const { _dbg, ...rest } = d; void _dbg; return rest; };
const toFlow = (w: { nodes: WfNode[]; edges: { source: string; target: string }[] }) => ({
  nodes: w.nodes.map((n, i): Node => ({ id: n.id, type: n.type, position: n.position ?? { x: (i % 3) * 260, y: Math.floor(i / 3) * 150 }, data: structuredClone(n.data) as D })),
  edges: w.edges.map((e): Edge => ({ id: `${e.source}>${e.target}`, source: e.source, target: e.target, ...EDGE })),
});

function Editor({ id, canManage, canDeploy }: { id: string | null; canManage: boolean; canDeploy: boolean }) {
  const router = useRouter();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [wf, setWf] = useState<Detail | null>(null), [meta, setMeta] = useState({ name: "New workflow", description: "" });
  const [savedKey, setSavedKey] = useState(""), [note, setNote] = useState("");
  const [sel, setSel] = useState<string | null>(null), [panel, setPanel] = useState<"copilot" | "properties" | "debug" | "api" | "versions" | "metrics">("properties");
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null), [busy, setBusy] = useState(false), [loading, setLoading] = useState(!!id);
  const [ev, setEv] = useState<TestEvent>({ event: "transaction_created", source: "mobile_app", fields: { ...SAMPLE_FIELDS } });
  const [rules, setRules] = useState<Rule[]>([]);
  useEffect(() => { fetch("/api/rules").then((r) => r.json()).then((l) => Array.isArray(l) && setRules(l)); }, []);
  const [dbg, setDbg] = useState<Debug | null>(null);
  const canvas = useRef<HTMLDivElement>(null), file = useRef<HTMLInputElement>(null);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const ro = !canManage || wf?.status === "Archived";

  const body = () => ({
    name: meta.name, ...(meta.description.trim() && { description: meta.description }),
    nodes: nodes.map((n) => ({ id: n.id, type: n.type, data: strip(n.data as D), position: { x: Math.round(n.position.x), y: Math.round(n.position.y) } })),
    edges: edges.map((e) => ({ source: e.source, target: e.target })),
  });
  const keyOf = (b: ReturnType<typeof body>) => JSON.stringify({ ...b, nodes: b.nodes.map(({ position, ...n }) => { void position; return n; }) }); // moving nodes is not a change worth a version
  const dirty = !!savedKey && keyOf(body()) !== savedKey;

  const show = (w: { name: string; description?: string; nodes: WfNode[]; edges: { source: string; target: string }[] }, saved: boolean) => {
    const f = toFlow(w); setNodes(f.nodes); setEdges(f.edges); setMeta({ name: w.name, description: w.description ?? "" }); setSel(null); setDbg(null);
    if (saved) setSavedKey(keyOf({ name: w.name, ...(w.description && { description: w.description }), nodes: w.nodes.map((n) => ({ id: n.id, type: n.type, data: n.data as D, position: { x: 0, y: 0 } })), edges: w.edges }));
    requestAnimationFrame(() => fitView({ padding: 0.2, duration: 300 }));
  };
  const load = () => fetch(`/api/workflows/${id}`).then(async (r) => { if (!r.ok) { setMsg({ error: "Workflow not found." }); setLoading(false); return; } const d: Detail = await r.json(); setWf(d); show(d, true); setLoading(false); });
  useEffect(() => {
    if (id) load();
    else { const b = { name: "New workflow", nodes: [{ id: "1", type: "trigger" as const, data: DEFAULT.trigger, position: { x: 0, y: 0 } }], edges: [] }; show(b, true); }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Any structural edit clears debug highlights so they never show stale results.
  useEffect(() => { if (dbg) clearDebug(); }, [nodes.length, edges.length]); // eslint-disable-line react-hooks/exhaustive-deps
  function clearDebug() { setDbg(null); setNodes((ns) => ns.map((n) => ({ ...n, data: strip(n.data as D) }))); setEdges((es) => es.map((e) => ({ ...e, animated: false, className: "" }))); }

  function add(k: Kind, at?: { x: number; y: number }) {
    if (ro) return;
    if (!at) { const b = canvas.current!.getBoundingClientRect(); at = screenToFlowPosition({ x: b.left + b.width / 2 - 110, y: b.top + b.height / 2 - 40 }); }
    const nid = String(Math.max(0, ...nodes.map((n) => Number(n.id) || 0)) + 1);
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { id: nid, type: k, position: at!, data: structuredClone(DEFAULT[k]) as D, selected: true }]);
    setSel(nid); setPanel("properties");
  }
  const patch = (nid: string, d: object) => setNodes((ns) => ns.map((n) => (n.id === nid ? { ...n, data: { ...strip(n.data as D), ...d } } : n)));
  const removeNode = (nid: string) => {
    if (wf?.role && nodes.find((n) => n.id === nid)?.type === "trigger") return; // a default workflow keeps its trigger
    setNodes((ns) => ns.filter((n) => n.id !== nid)); setEdges((es) => es.filter((e) => e.source !== nid && e.target !== nid)); setSel(null); };

  async function call(url: string, method: string, payload?: unknown) {
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: payload === undefined ? undefined : JSON.stringify(payload) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error); return j;
  }
  const run = async (fn: () => Promise<void>) => { setBusy(true); setMsg(null); try { await fn(); } catch (e) { setMsg({ error: (e as Error).message }); } setBusy(false); };
  const after = (d: Detail, ok: string) => { setWf(d); show(d, true); setMsg({ ok }); };
  const save = () => run(async () => {
    const v = validateWorkflow(body()); if ("error" in v) throw new Error(v.error);
    if (!id) { const w = await call("/api/workflows", "POST", body()); router.replace(`/workflows/${w.id}`); return; }
    after(await call(`/api/workflows/${id}`, "PUT", { ...body(), note }), `Saved as version ${(wf?.version ?? 0) + 1}.`); setNote("");
  });
  const op = (o: string, ok: string, payload: object = {}) => run(async () => after(await call(`/api/workflows/${id}/${o}`, "POST", payload), ok));
  const del = () => confirm(`Delete workflow "${meta.name}"? This cannot be undone.`) && run(async () => { await call(`/api/workflows/${id}`, "DELETE"); router.push("/workflows"); });

  async function startDebug(all = false) {
    clearDebug(); setPanel("debug");
    await run(async () => {
      const r = await call(`/api/workflows/${id ?? "draft"}/test`, "POST", { workflow: body(), event: ev });
      const d: Debug = { ...r, cursor: all ? r.steps.length - 1 : 0 }; setDbg(d); paint(d);
    });
  }
  function paint(d: Debug) {
    const upto = new Map(d.steps.slice(0, d.cursor + 1).map((s, i) => [s.id, i === d.cursor ? "current" : s.reached ? "passed" : "failed"]));
    setNodes((ns) => ns.map((n) => ({ ...n, data: { ...strip(n.data as D), _dbg: upto.get(n.id) as D["_dbg"] } })));
    const live = new Set(d.liveEdges), done = new Set(d.steps.slice(0, d.cursor + 1).map((s) => s.id));
    setEdges((es) => es.map((e) => ({ ...e, animated: live.has(`${e.source}>${e.target}`) && done.has(e.target), className: live.has(`${e.source}>${e.target}`) && done.has(e.target) ? "live" : "" })));
    setSel(d.steps[d.cursor]?.id ?? null);
  }
  const step = (delta: number) => { if (!dbg) return; const d = { ...dbg, cursor: Math.max(0, Math.min(dbg.steps.length - 1, dbg.cursor + delta)) }; setDbg(d); paint(d); };

  function exportJson() {
    const blob = new Blob([JSON.stringify({ id: id ?? "wf_draft", version: wf?.version, ...body() }, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${id ?? "workflow"}-v${wf?.version ?? 0}.json`; a.click(); URL.revokeObjectURL(a.href);
  }
  async function importJson(f: File) {
    if (file.current) file.current.value = "";
    let raw: unknown; try { raw = JSON.parse(await f.text()); } catch { return setMsg({ error: `${f.name} is not valid JSON.` }); }
    const v = validateWorkflow(raw);
    if ("error" in v) return setMsg({ error: `Import failed: ${v.error}` });
    show(v.workflow, false); setMsg({ ok: `Loaded "${v.workflow.name}" from ${f.name}. Review it, then Save to create a new version.` });
  }

  const cur = nodes.find((n) => n.id === sel);
  if (loading) return <div className="wfe"><Skel h={48} /><div style={{ height: 12 }} /><Skel h={600} /></div>;
  if (id && !wf) return <div className="card empty-state"><b>{msg?.error ?? "Workflow not found."}</b><Link className="btn" href="/workflows">Back to workflows</Link></div>;

  return (
    <div className="wfe">
      <div className="card wfe-bar">
        <Link className="icon" href="/workflows" aria-label="Back to workflows" title="Back to workflows"><ArrowLeft size={18} /></Link>
        <input className="wfe-name" value={meta.name} disabled={ro} onChange={(e) => setMeta({ ...meta, name: e.target.value })} aria-label="Workflow name" />
        {wf && <span className={`chip ${STATUS_CLS[wf.status]}`}>{wf.status}</span>}
        <span className="mute">{wf ? <>v{wf.version}{wf.deployedVersion ? ` · live v${wf.deployedVersion}` : " · never deployed"}{wf.deployedVersion && wf.deployedVersion !== wf.version && <b className="MEDIUM"> · not deployed</b>}</> : "unsaved"}{dirty && <b className="MEDIUM"> · unsaved changes</b>}</span>
        <span className="wfe-tools">
          {canManage && !ro && <><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Version note (optional)" style={{ width: 180 }} aria-label="Version note" />
            <button className="btn ico-btn" onClick={save} disabled={busy || (!!id && !dirty)} title={id && !dirty ? "No changes to save" : ""}><Save size={15} /> Save</button></>}
          <button className="ico-btn" onClick={() => startDebug(true)} disabled={busy}><Play size={15} /> Test</button>
          {canDeploy && id && wf?.status !== "Archived" && <button className="ico-btn deploy" onClick={() => confirm(`Deploy version ${wf!.version}? It will run (shadow mode) on every new transfer.`) && op("deploy", `Version ${wf!.version} deployed.`)} disabled={busy || dirty || wf?.deployedVersion === wf?.version && wf?.status === "Active"} title={dirty ? "Save first" : ""}><Rocket size={15} /> Deploy</button>}
          <button className="ico-btn" onClick={exportJson}><Download size={15} /> Export</button>
          {canManage && !ro && <><input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
            <button className="ico-btn" onClick={() => file.current?.click()}><Upload size={15} /> Import</button></>}
          {canManage && wf && !wf.role && (wf.status === "Archived"
            ? <button className="ico-btn" onClick={() => op("restore", "Restored as Draft.")} disabled={busy}><ArchiveRestore size={15} /> Restore</button>
            : <button className="icon" title="Archive (stops running)" aria-label="Archive" onClick={() => confirm("Archive this workflow? It stops running.") && op("archive", "Archived. It no longer runs.")} disabled={busy}><Archive size={16} /></button>)}
          {canManage && wf && !wf.role && wf.status !== "Active" && <button className="icon danger" title="Delete" aria-label="Delete workflow" onClick={del} disabled={busy}><Trash2 size={16} /></button>}
        </span>
      </div>
      {msg?.ok && <p className="ok-msg" role="status">{msg.ok}</p>}
      {msg?.error && <p className="auth-err" role="alert">{msg.error}</p>}
      {ro && wf?.status === "Archived" && <p className="mute">Archived workflows are read-only. Restore it to edit or deploy.</p>}

      <div className="wfe-body">
        <aside className="card wfe-palette">
          {GROUPS.map((g) => <div key={g} className="wfe-group"><div className="mute">{g}</div>
            {(Object.keys(KINDS) as Kind[]).filter((k) => KINDS[k].group === g).map((k) => (
              <div key={k} className={`wfe-item ${k}`} draggable={!ro} role="button" tabIndex={0} aria-disabled={ro}
                onDragStart={(e) => { e.dataTransfer.setData(MIME, k); e.dataTransfer.effectAllowed = "move"; }}
                onClick={() => add(k)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), add(k))}>
                <span className="wf-ico">{ICON[k]}</span><span><b>{KINDS[k].title}</b><small className="mute">{KINDS[k].hint}</small></span>{!ro && <Plus size={14} className="mute" />}
              </div>
            ))}</div>)}
          <p className="mute" style={{ fontSize: 12, marginTop: 8 }}>Drag onto the canvas or click to add. Connect a node&apos;s bottom dot to another&apos;s top dot. Select and press Delete to remove.</p>
        </aside>

        <div className="card wfe-canvas" ref={canvas} onDrop={(e) => { e.preventDefault(); const k = e.dataTransfer.getData(MIME) as Kind; if (k) add(k, screenToFlowPosition({ x: e.clientX - 110, y: e.clientY - 20 })); }}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}>
          <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={(c: Connection) => setEdges((es) => addEdge({ ...c, ...EDGE }, es))} nodeTypes={NODE_TYPES}
            onNodeClick={(_, n) => { setSel(n.id); if (panel !== "debug") setPanel("properties"); }} onPaneClick={() => setSel(null)}
            isValidConnection={(c) => c.source !== c.target} fitView minZoom={0.2} maxZoom={2} deleteKeyCode={ro ? null : ["Backspace", "Delete"]}
            nodesDraggable={!ro} nodesConnectable={!ro} defaultEdgeOptions={EDGE}>
            <Background gap={20} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable className="wfe-mini" />
          </ReactFlow>
        </div>

        <aside className="card wfe-side">
          <div className="seg wfe-tabs">
            <button aria-pressed={panel === "copilot"} onClick={() => setPanel("copilot")} title="AI Assistant"><Sparkles size={14} /> AI</button>
            <button aria-pressed={panel === "properties"} onClick={() => setPanel("properties")} title="Properties"><SlidersHorizontal size={14} /> Properties</button>
            <button aria-pressed={panel === "debug"} onClick={() => setPanel("debug")} title="Debug"><Bug size={14} /> Debug</button>
            <button aria-pressed={panel === "versions"} onClick={() => setPanel("versions")} disabled={!wf} title="Versions"><History size={14} /></button>
            <button aria-pressed={panel === "api"} onClick={() => setPanel("api")} disabled={!wf} title="Publish as API endpoint"><Globe size={14} /> API</button>
            <button aria-pressed={panel === "metrics"} onClick={() => setPanel("metrics")} disabled={!wf} title="Metrics"><Gauge size={14} /></button>
          </div>
          {panel === "copilot" && <CopilotChat kind="workflow" disabled={ro} getCurrent={body}
            onApply={(p) => { if (p) show(p as WorkflowBody, false); }}
            summary={(p) => { const w = p as unknown as WorkflowBody; return `${w.name} · ${w.nodes.length} nodes: ${w.nodes.map((n) => TITLE[n.type]).join(" → ").slice(0, 120)}`; }} />}
          {panel === "properties" && (cur ? <Props lockTrigger={wf?.role ? DEFAULT_ROUTE[wf.role] : undefined} node={cur} ro={ro} patch={(d) => patch(cur.id, d)} remove={() => removeNode(cur.id)} rules={rules} vars={[...Object.keys(FIELDS), ...nodes.filter((n) => n.id !== cur.id).flatMap((n) => outputsOf({ type: n.type, data: strip(n.data as D) }))]} />
            : <div className="rule-form">
                <b>Workflow</b>
                <label className="field"><span>Name</span><input value={meta.name} disabled={ro} onChange={(e) => setMeta({ ...meta, name: e.target.value })} /></label>
                <label className="field"><span>Description</span><textarea rows={3} value={meta.description} disabled={ro} onChange={(e) => setMeta({ ...meta, description: e.target.value })} /></label>
                <p className="mute" style={{ margin: 0 }}>Click a node to edit its properties.</p>
                <p className="mute" style={{ margin: 0 }}>{nodes.length} nodes · {edges.length} connections</p>
              </div>)}
          {panel === "debug" && <DebugPanel ev={ev} setEv={setEv} key="dbg" dbg={dbg} busy={busy} start={startDebug} step={step} reset={clearDebug} select={(nid) => setSel(nid)} />}
          {panel === "versions" && wf && <Versions wf={wf} canManage={canManage && !ro} dirty={dirty} rollback={(v) => confirm(`Restore version ${v.version} as a new version? The deployed version is unchanged until you deploy.`) && op("rollback", `Restored v${v.version} as v${wf.version + 1}.`, { version: v.version })} />}
          {panel === "metrics" && wf && <Metrics wf={wf} />}
          {panel === "api" && wf && <ApiPanel wf={wf} canDeploy={canDeploy} dirty={dirty} reload={load} />}
        </aside>
      </div>
    </div>
  );
}

const ACT_OPTS = Object.entries(ACTIONS).map(([v, l]) => <option key={v} value={v}>{l}</option>);
const TGT_OPTS = Object.entries(TARGETS).map(([v, l]) => <option key={v} value={v}>{l}</option>);

// One "variable operator value" row; value type follows what the user types (number / true|false / text).
function CritRow({ c, vars, ro, set, del, join }: { c: Crit; vars: string[]; ro: boolean; set: (c: Partial<Crit>) => void; del?: () => void; join?: string }) {
  const parse = (t: string): Crit["value"] => (t === "true" ? true : t === "false" ? false : t.trim() !== "" && !Number.isNaN(Number(t)) ? Number(t) : t);
  return (
    <div className="cond-row">
      {join && <span className="cond-join">{join}</span>}
      <input list="wf-vars" value={c.field} disabled={ro} onChange={(e) => set({ field: e.target.value.trim() })} placeholder="variable" aria-label="Variable" />
      <select value={c.operator} disabled={ro} onChange={(e) => set({ operator: e.target.value as Crit["operator"] })} style={{ flex: "0 0 84px" }}>{CRITERIA_OPS.map((o) => <option key={o}>{o}</option>)}</select>
      <input value={String(c.value)} disabled={ro} onChange={(e) => set({ value: parse(e.target.value) })} placeholder={c.operator === "in" ? "a, b, c" : "value"} aria-label="Value" />
      {del && !ro && <button className="icon" onClick={del} aria-label="Remove"><X size={14} /></button>}
    </div>
  );
}
const OutVar = ({ v, ro, set, hint }: { v: string; ro: boolean; set: (v: string) => void; hint?: string }) => (
  <label className="field"><span>Output variable</span><input value={v} disabled={ro} onChange={(e) => set(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} /><small className="mute">{hint ?? "Later nodes can use it in Criteria, Scoring, Calculation and {{templates}}."}</small></label>
);

function Props({ node, ro, patch, remove, rules, vars, lockTrigger }: { node: Node; ro: boolean; patch: (d: object) => void; remove: () => void; rules: Rule[]; vars: string[]; lockTrigger?: string }) {
  const k = node.type as Kind, d = strip(node.data as D) as Record<string, unknown>;
  const list = <T,>(key: string) => d[key] as T[];
  const setAt = <T,>(key: string, i: number, x: Partial<T>) => patch({ [key]: list<T>(key).map((y, j) => (j === i ? { ...y, ...x } : y)) });
  const drop = (key: string, i: number) => patch({ [key]: list(key).filter((_, j) => j !== i) });
  return (
    <div className="rule-form">
      <datalist id="wf-vars">{[...new Set(vars)].map((v) => <option key={v} value={v} />)}</datalist>
      <div className="hdr" style={{ margin: 0 }}><span className="wf-ico">{ICON[k]}</span><b>{TITLE[k]} #{node.id}</b>{!ro && <button className="icon danger" style={{ marginLeft: "auto" }} onClick={remove} aria-label="Delete node" title="Delete node"><Trash2 size={15} /></button>}</div>
      <small className="mute">{KINDS[k].hint}</small>

      {k === "trigger" && <>
        {lockTrigger && <small className="mute">Default workflow: the event type is fixed because it serves <code>POST {lockTrigger}</code>.</small>}
        <label className="field"><span>Event type</span><select value={d.event as string} disabled={ro || !!lockTrigger} onChange={(e) => patch({ event: e.target.value })}>{Object.entries(TRIGGERS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label className="field"><span>Data source</span><select value={d.source as string} disabled={ro} onChange={(e) => patch({ source: e.target.value })}>{Object.entries(SOURCES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <small className="mute">Live runs currently come from Transaction Created (mobile app / internet banking).</small>
      </>}

      {(k === "condition" || k === "criteria") && <>
        <div className="field"><span>Match</span><div className="seg">{(["AND", "OR"] as const).map((m) => <button key={m} aria-pressed={d.mode === m} disabled={ro} onClick={() => patch({ mode: m })}>{m === "AND" ? "All (AND)" : "Any (OR)"}</button>)}</div></div>
        {k === "condition" ? list<Check>("conditions").map((c, i) => {
          const def = CONDITIONS[c.field];
          return (
            <div key={i} className="cond-row">
              {i > 0 && <span className="cond-join">{d.mode as string}</span>}
              <select value={c.field} disabled={ro} onChange={(e) => { const f = e.target.value as CondField; setAt<Check>("conditions", i, { field: f, operator: CONDITIONS[f].ops[0], value: CONDITIONS[f].type === "number" ? 0 : true }); }}>{Object.entries(CONDITIONS).map(([v, x]) => <option key={v} value={v}>{x.label}</option>)}</select>
              <select value={c.operator} disabled={ro} onChange={(e) => setAt<Check>("conditions", i, { operator: e.target.value })} style={{ flex: "0 0 64px" }}>{def.ops.map((o) => <option key={o}>{o}</option>)}</select>
              {def.type === "number" ? <input type="number" value={c.value as number} disabled={ro} onChange={(e) => setAt<Check>("conditions", i, { value: Number(e.target.value) })} aria-label="Value" />
                : <select value={String(c.value)} disabled={ro} onChange={(e) => setAt<Check>("conditions", i, { value: e.target.value === "true" })}><option value="true">true</option><option value="false">false</option></select>}
              {!ro && list("conditions").length > 1 && <button className="icon" onClick={() => drop("conditions", i)} aria-label="Remove condition"><X size={14} /></button>}
            </div>
          );
        }) : list<Crit>("criteria").map((c, i) => <CritRow key={i} c={c} vars={vars} ro={ro} join={i ? (d.mode as string) : undefined} set={(x) => setAt<Crit>("criteria", i, x)} del={list("criteria").length > 1 ? () => drop("criteria", i) : undefined} />)}
        {!ro && list(k === "condition" ? "conditions" : "criteria").length < 10 && <button className="ico-btn" style={{ justifySelf: "start" }} onClick={() => patch(k === "condition" ? { conditions: [...list("conditions"), { field: "velocity", operator: ">", value: 5 }] } : { criteria: [...list("criteria"), { field: "", operator: "==", value: "" }] })}><Plus size={14} /> Add check</button>}
        {k === "criteria" && <small className="mute">Any variable: event fields or outputs of earlier nodes (score, risk_band, ai_risk…). Operators include contains and in (comma list).</small>}
      </>}

      {k === "rule" && <>
        <label className="field"><span>Rule</span><select value={d.ruleId as string} disabled={ro} onChange={(e) => patch({ ruleId: e.target.value })}>
          <option value="">Choose a rule…</option>{rules.map((r) => <option key={r.id} value={r.id}>{r.id} · {r.name}{r.status === "Active" ? "" : " (inactive)"}</option>)}</select></label>
        {(() => { const r = rules.find((x) => x.id === d.ruleId); return r && <code className="wf-expr">{r.expression}</code>; })()}
        <OutVar v={d.output as string} ro={ro} set={(v) => patch({ output: v })} hint="Set to true/false. The path continues only when the rule matches." />
      </>}

      {k === "gateway" && <div className="field"><span>Gateway type</span>
        {(Object.keys(GATEWAYS) as (keyof typeof GATEWAYS)[]).map((g) => (
          <label key={g} className={`radio-card${d.kind === g ? " on" : ""}`}><input type="radio" name={`gw-${node.id}`} checked={d.kind === g} disabled={ro} onChange={() => patch({ kind: g })} /><span><b>{g[0].toUpperCase() + g.slice(1)}</b><small className="mute">{GATEWAYS[g].split(": ")[1]}</small></span></label>
        ))}</div>}

      {k === "timer" && <label className="field"><span>Wait (minutes)</span><input type="number" min={1} max={10080} value={d.minutes as number} disabled={ro} onChange={(e) => patch({ minutes: Math.round(Number(e.target.value)) })} /><small className="mute">Shadow runs and tests skip the wait and log it.</small></label>}

      {k === "calculation" && <>
        <label className="field"><span>Formula</span><input className="json-editor" value={d.expression as string} disabled={ro} onChange={(e) => patch({ expression: e.target.value })} list="wf-vars" />
          <small className="mute">+ − × ÷ % ( ), min max abs round floor ceil sqrt log10. Booleans count as 1/0. e.g. <code>round(amount / max(avg_daily_spend, 1))</code></small></label>
        <OutVar v={d.output as string} ro={ro} set={(v) => patch({ output: v })} />
      </>}

      {k === "calc_field" && <>
        <label className="field"><span>Input variable (number)</span><input list="wf-vars" value={d.input as string} disabled={ro} onChange={(e) => patch({ input: e.target.value.trim() })} /></label>
        <div className="field"><span>Bands (first match wins)</span>
          {list<{ max: number; label: string }>("buckets").map((b, i) => (
            <div key={i} className="cond-row"><span className="mute" style={{ flex: "0 0 auto" }}>≤</span>
              <input type="number" value={b.max} disabled={ro} onChange={(e) => setAt("buckets", i, { max: Number(e.target.value) })} aria-label="Upper limit" />
              <span className="mute" style={{ flex: "0 0 auto" }}>→</span>
              <input value={b.label} disabled={ro} onChange={(e) => setAt("buckets", i, { label: e.target.value })} aria-label="Label" />
              {!ro && list("buckets").length > 1 && <button className="icon" onClick={() => drop("buckets", i)} aria-label="Remove band"><X size={14} /></button>}
            </div>
          ))}
          <div className="cond-row"><span className="mute" style={{ flex: "0 0 auto" }}>otherwise →</span><input value={d.otherwise as string} disabled={ro} onChange={(e) => patch({ otherwise: e.target.value })} /></div>
          {!ro && list("buckets").length < 10 && <button className="ico-btn" style={{ justifySelf: "start" }} onClick={() => patch({ buckets: [...list<{ max: number }>("buckets"), { max: (list<{ max: number }>("buckets").at(-1)?.max ?? 0) + 10, label: "" }] })}><Plus size={14} /> Add band</button>}
        </div>
        <OutVar v={d.output as string} ro={ro} set={(v) => patch({ output: v })} />
      </>}

      {k === "scoring" && <>
        <label className="field"><span>Base score</span><input type="number" value={d.base as number} disabled={ro} onChange={(e) => patch({ base: Number(e.target.value) })} /></label>
        <div className="field"><span>Factors (points added when the check matches)</span>
          {list<ScoreItem>("items").map((it, i) => (
            <div key={i} className="score-row">
              <CritRow c={it} vars={vars} ro={ro} set={(x) => setAt<ScoreItem>("items", i, x)} del={list("items").length > 1 ? () => drop("items", i) : undefined} />
              <label className="pts">points <input type="number" value={it.points} disabled={ro} onChange={(e) => setAt<ScoreItem>("items", i, { points: Number(e.target.value) })} /></label>
            </div>
          ))}
          {!ro && list("items").length < 20 && <button className="ico-btn" style={{ justifySelf: "start" }} onClick={() => patch({ items: [...list("items"), { field: "", operator: "==", value: true, points: 10 }] })}><Plus size={14} /> Add factor</button>}
        </div>
        <OutVar v={d.output as string} ro={ro} set={(v) => patch({ output: v })} />
      </>}

      {k === "db_query" && <>
        <label className="field"><span>Query</span><select value={d.query as string} disabled={ro} onChange={(e) => patch({ query: e.target.value })}>{Object.entries(DB_QUERIES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <small className="mute">Read-only named queries on the transaction database, keyed by customer_id / beneficiary_account. No free-form SQL.</small></label>
        <OutVar v={d.output as string} ro={ro} set={(v) => patch({ output: v })} />
      </>}

      {k === "api_call" && <>
        <div className="wf-row">
          <label className="field" style={{ flex: "0 0 90px" }}><span>Method</span><select value={d.method as string} disabled={ro} onChange={(e) => patch({ method: e.target.value })}><option>GET</option><option>POST</option></select></label>
          <label className="field"><span>URL</span><input value={d.url as string} disabled={ro} onChange={(e) => patch({ url: e.target.value })} placeholder="https://api.example/score?acc={{beneficiary_account}}" /></label>
        </div>
        {d.method === "POST" && <label className="field"><span>JSON body</span><textarea className="json-editor" rows={4} value={d.body as string} disabled={ro} onChange={(e) => patch({ body: e.target.value })} placeholder='{ "amount": {{amount}} }' /></label>}
        <label className="field"><span>Result path <span className="mute">(optional)</span></span><input value={d.path as string} disabled={ro} onChange={(e) => patch({ path: e.target.value })} placeholder="data.risk" /></label>
        <small className="mute">Only URLs under an endpoint listed in Settings → Integration are allowed. 4 s timeout. Use {"{{variable}}"} in URL and body.</small>
        <OutVar v={d.output as string} ro={ro} set={(v) => patch({ output: v })} />
      </>}

      {k === "baseline_score" && (() => {
        const w = d.weights as Record<string, number>, num = (key: string, v: number) => patch({ [key]: v }), wt = (key: string, v: number) => patch({ weights: { ...w, [key]: v } });
        return <>
          <p className="mute" style={{ margin: 0 }}>The bank&apos;s baseline risk score with every weight editable. Writes <code>{String(d.output)}_score</code> and <code>{String(d.output)}_level</code> (LOW / MEDIUM / HIGH) for later Criteria or gateways.</p>
          <div className="field"><span>Points per signal</span>
            {(Object.keys(BASELINE_LABEL) as (keyof typeof BASELINE_LABEL)[]).map((key) => (
              <label key={key} className="cond-row"><span style={{ flex: 2, fontSize: 12 }}>{BASELINE_LABEL[key].replace("N×", `${d.spikeMultiple}×`).replace("N days", `${d.youngDays} days`)}</span>
                <input type="number" value={w[key]} disabled={ro} onChange={(e) => wt(key, Number(e.target.value))} style={{ flex: "0 0 80px" }} aria-label={BASELINE_LABEL[key]} /></label>
            ))}</div>
          <div className="wf-row">
            <label className="field"><span>Spike multiple (N×)</span><input type="number" min={1} value={d.spikeMultiple as number} disabled={ro} onChange={(e) => num("spikeMultiple", Number(e.target.value))} /></label>
            <label className="field"><span>Young account (days)</span><input type="number" min={0} value={d.youngDays as number} disabled={ro} onChange={(e) => num("youngDays", Number(e.target.value))} /></label>
          </div>
          <div className="wf-row">
            <label className="field"><span>Medium from score</span><input type="number" min={0} value={d.mediumAt as number} disabled={ro} onChange={(e) => num("mediumAt", Number(e.target.value))} /></label>
            <label className="field"><span>High from score</span><input type="number" min={1} value={d.highAt as number} disabled={ro} onChange={(e) => num("highAt", Number(e.target.value))} /></label>
          </div>
          <label className="field"><span>High-value amount (IDR, at least Medium; 0 = off)</span><input type="number" min={0} value={d.highValue as number} disabled={ro} onChange={(e) => num("highValue", Number(e.target.value))} /></label>
          {!ro && <button className="linkish" style={{ justifySelf: "start" }} onClick={() => patch(structuredClone({ ...BASELINE_DEFAULT, output: d.output }))}>Reset to the built-in defaults</button>}
          <OutVar v={d.output as string} ro={ro} set={(v) => patch({ output: v })} hint={`Writes ${d.output}_score and ${d.output}_level.`} />
        </>;
      })()}

      {k === "event_score" && (() => {
        const w = d.weights as Record<string, number>, wt = (key: string, v: number) => patch({ weights: { ...w, [key]: v } });
        return <>
          <p className="mute" style={{ margin: 0 }}>Risk of a login or account change, with every weight editable. Writes <code>{String(d.output)}_score</code>, <code>{String(d.output)}_decision</code> (ALLOW / CHALLENGE / DENY) and <code>{String(d.output)}_reasons</code>. Failed-attempt points apply to logins, change points to account updates.</p>
          <div className="field"><span>Points per signal</span>
            {(Object.keys(EVENT_LABEL) as (keyof typeof EVENT_LABEL)[]).map((key) => (
              <label key={key} className="cond-row"><span style={{ flex: 2, fontSize: 12 }}>{EVENT_LABEL[key]}</span><input type="number" value={w[key]} disabled={ro} onChange={(e) => wt(key, Number(e.target.value))} style={{ flex: "0 0 80px" }} aria-label={EVENT_LABEL[key]} /></label>
            ))}</div>
          <label className="field"><span>Sensitive account changes (comma separated)</span><input value={d.sensitive as string} disabled={ro} onChange={(e) => patch({ sensitive: e.target.value })} /></label>
          <div className="wf-row">
            <label className="field"><span>Challenge from score</span><input type="number" min={0} value={d.challengeAt as number} disabled={ro} onChange={(e) => patch({ challengeAt: Number(e.target.value) })} /></label>
            <label className="field"><span>Deny from score</span><input type="number" min={1} value={d.denyAt as number} disabled={ro} onChange={(e) => patch({ denyAt: Number(e.target.value) })} /></label>
          </div>
          {!ro && <button className="linkish" style={{ justifySelf: "start" }} onClick={() => patch(structuredClone({ ...EVENT_DEFAULT, output: d.output }))}>Reset to the built-in defaults</button>}
          <OutVar v={d.output as string} ro={ro} set={(v) => patch({ output: v })} hint={`Writes ${d.output}_score, ${d.output}_decision and ${d.output}_reasons.`} />
        </>;
      })()}

      {k === "rule_engine" && <>
        <p className="mute" style={{ margin: 0 }}>Runs every <b>Active</b> rule from the Rule Builder on this event. Writes <code>{String(d.output)}_action</code> (strictest: DECLINE &gt; CHALLENGE &gt; HOLD &gt; ALLOW, or NONE), <code>{String(d.output)}_hit</code> and <code>{String(d.output)}_names</code>. Switching a rule on or off in the Rule Builder changes this node immediately.</p>
        <div className="field"><span>Active rules now ({rules.filter((r) => r.status === "Active").length})</span>
          <ul className="inv-list">{rules.filter((r) => r.status === "Active").map((r) => <li key={r.id}><span><b>{r.name}</b><small className="mute"><code>{r.expression}</code></small></span><span className={`chip ${r.severity}`}>{r.action}</span></li>)}</ul></div>
        <OutVar v={d.output as string} ro={ro} set={(v) => patch({ output: v })} hint={`Writes ${d.output}_action, ${d.output}_hit and ${d.output}_names.`} />
      </>}

      {k === "aml_check" && <>
        <p className="mute" style={{ margin: 0 }}>Screens customer_name and beneficiary_name against the AML lists (sanctions, PEP, internal) in Risk Intelligence, and checks behaviour: high-risk country and structuring (3+ transfers just under Rp 100 juta in 24 h).</p>
        <label className="toggle"><input type="checkbox" checked={!!d.failOnHit} disabled={ro} onChange={(e) => patch({ failOnHit: e.target.checked })} /> Continue only when there is an AML hit</label>
        <OutVar v={d.output as string} ro={ro} set={(v) => patch({ output: v })} hint={`Writes ${d.output}_hit (true/false), ${d.output}_score (0–100) and ${d.output}_reasons.`} />
      </>}

      {k === "ai" && <>
        <label className="field"><span>Question for the AI</span><textarea rows={4} value={d.prompt as string} disabled={ro} onChange={(e) => patch({ prompt: e.target.value })} /><small className="mute">Gemini receives this plus all variables, and returns a risk score 0–100. Use {"{{variable}}"} to quote values. Without Gemini a built-in heuristic answers.</small></label>
        <OutVar v={d.output as string} ro={ro} set={(v) => patch({ output: v })} hint={`Writes ${d.output} (0–100) and ${d.output}_label (LOW…CRITICAL).`} />
      </>}

      {k === "action" && (() => {
        const params = Object.entries(d.params as Record<string, string>);
        const setParams = (p: [string, string][]) => patch({ params: Object.fromEntries(p) });
        return <>
          <label className="field"><span>Type</span><select value={d.action as string} disabled={ro} onChange={(e) => patch({ action: e.target.value })}>{ACT_OPTS}</select></label>
          <label className="field"><span>Target</span><select value={d.target as string} disabled={ro} onChange={(e) => patch({ target: e.target.value })}>{TGT_OPTS}</select></label>
          <div className="field"><span>Parameters</span>
            {params.map(([pk, pv], i) => (
              <div key={i} className="cond-row">
                <input value={pk} disabled={ro} placeholder="name" onChange={(e) => setParams(params.map((x, j) => (j === i ? [e.target.value, x[1]] : x)))} aria-label="Parameter name" />
                <input value={pv} disabled={ro} placeholder="value" style={{ flex: 2 }} onChange={(e) => setParams(params.map((x, j) => (j === i ? [x[0], e.target.value] : x)))} aria-label="Parameter value" />
                {!ro && <button className="icon" onClick={() => setParams(params.filter((_, j) => j !== i))} aria-label="Remove parameter"><X size={14} /></button>}
              </div>
            ))}
            {!ro && params.length < 10 && <button className="ico-btn" style={{ justifySelf: "start" }} onClick={() => setParams([...params, [`param${params.length + 1}`, ""]])}><Plus size={14} /> Add parameter</button>}
            <small className="mute">e.g. priority = high, message = Score {"{{score}}"}</small>
          </div>
        </>;
      })()}

      {k === "parallel_action" && <div className="field"><span>Actions (all run at once)</span>
        {list<{ action: string; target: string }>("actions").map((a, i) => (
          <div key={i} className="cond-row">
            <select value={a.action} disabled={ro} onChange={(e) => setAt("actions", i, { action: e.target.value })}>{ACT_OPTS}</select>
            <select value={a.target} disabled={ro} onChange={(e) => setAt("actions", i, { target: e.target.value })}>{TGT_OPTS}</select>
            {!ro && list("actions").length > 2 && <button className="icon" onClick={() => drop("actions", i)} aria-label="Remove action"><X size={14} /></button>}
          </div>
        ))}
        {!ro && list("actions").length < 10 && <button className="ico-btn" style={{ justifySelf: "start" }} onClick={() => patch({ actions: [...list("actions"), { action: "send_alert", target: "soc" }] })}><Plus size={14} /> Add action</button>}
      </div>}
    </div>
  );
}

function DebugPanel({ ev, setEv, dbg, busy, start, step, reset, select }: { ev: TestEvent; setEv: (e: TestEvent) => void; dbg: Debug | null; busy: boolean; start: (all?: boolean) => void; step: (d: number) => void; reset: () => void; select: (id: string) => void }) {
  const cur = dbg?.steps[dbg.cursor];
  const f = ev.fields, setF = (k: string, v: unknown) => setEv({ ...ev, fields: { ...f, [k]: v } });
  return (
    <div className="rule-form">
      <b>Debug with a sample event</b>
      <div className="wf-row">
        <label className="field"><span>Event</span><select value={ev.event} onChange={(e) => setEv({ ...ev, event: e.target.value as TestEvent["event"] })}>{Object.entries(TRIGGERS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="field"><span>Source</span><select value={ev.source} onChange={(e) => setEv({ ...ev, source: e.target.value as TestEvent["source"] })}>{Object.entries(SOURCES).filter(([k]) => k !== "any").map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      </div>
      <details><summary className="mute">Event fields ({Object.keys(FIELDS).length})</summary>
        <div className="dbg-fields">
          {(Object.entries(FIELDS) as [keyof typeof FIELDS, { label: string; type: string }][]).map(([k, def]) => def.type === "boolean"
            ? <label key={k} className="toggle"><input type="checkbox" checked={f[k] as boolean} onChange={(e) => setF(k, e.target.checked)} /> {def.label}</label>
            : <label key={k} className="field"><span>{def.label}</span><input type={def.type === "number" ? "number" : "text"} value={f[k] as string | number} onChange={(e) => setF(k, def.type === "number" ? Number(e.target.value) : e.target.value)} /></label>)}
        </div>
      </details>
      <div className="dbg-ctl">
        <button className="btn ico-btn" onClick={() => start(false)} disabled={busy}><Bug size={14} /> Step through</button>
        <button className="ico-btn" onClick={() => start(true)} disabled={busy}><SkipForward size={14} /> Run all</button>
        {dbg && <button className="icon" onClick={reset} title="Reset" aria-label="Reset debug"><RotateCcw size={15} /></button>}
      </div>
      {dbg && <>
        <div className="dbg-nav">
          <button className="icon" onClick={() => step(-1)} disabled={dbg.cursor === 0} aria-label="Previous step"><ChevronLeft size={16} /></button>
          <b>Step {dbg.cursor + 1} / {dbg.steps.length}</b>
          <button className="icon" onClick={() => step(1)} disabled={dbg.cursor === dbg.steps.length - 1} aria-label="Next step"><ChevronRight size={16} /></button>
          <span className="mute" style={{ marginLeft: "auto" }}>{dbg.ms} ms total</span>
        </div>
        {cur && <div className={`dbg-cur ${cur.error ? "err" : cur.reached ? "ok" : "no"}`}><b>#{cur.id} {TITLE[cur.type]}</b> {cur.error ? "⚠ error" : cur.reached ? "✓ reached" : "✗ not reached"}<div className="mute">{cur.label}</div><ul>{cur.log.map((l, i) => <li key={i}>{l}</li>)}</ul>
          {cur.set && <div className="dbg-vars">{Object.entries(cur.set).map(([k, v]) => <code key={k}>{k} = {JSON.stringify(v)}</code>)}</div>}</div>}
        {dbg.cursor === dbg.steps.length - 1 && <>
          <div className={dbg.fired.length ? "auth-err" : "ok-msg"} style={{ margin: 0 }}>{dbg.fired.length ? <>Fires: <b>{dbg.fired.map((x) => `${ACTIONS[x.action as keyof typeof ACTIONS]} → ${TARGETS[x.target as keyof typeof TARGETS]}`).join(", ")}</b></> : "No action fires for this event."}</div>
          {dbg.errors.length > 0 && <div className="auth-err" style={{ margin: 0 }}>{dbg.errors.length} node error(s): {dbg.errors.join("; ")}</div>}
          {Object.keys(dbg.variables).length > 0 && <div className="dbg-vars"><b style={{ flexBasis: "100%" }}>Variables</b>{Object.entries(dbg.variables).map(([k, v]) => <code key={k}>{k} = {JSON.stringify(v)}</code>)}</div>}
        </>}
        <details open><summary className="mute">Execution log</summary>
          <ol className="dbg-log">{dbg.steps.map((s, i) => <li key={s.id} className={`${i > dbg.cursor ? "todo" : s.error ? "err" : s.reached ? "ok" : "no"}${i === dbg.cursor ? " cur" : ""}`} onClick={() => select(s.id)}>
            <span>{i > dbg.cursor ? "·" : s.error ? "⚠" : s.reached ? "✓" : "✗"} #{s.id} {TITLE[s.type]}</span><span className="mute">{s.ms} ms</span>
            {i <= dbg.cursor && <div className="mute">{s.log.join(" · ")}</div>}
          </li>)}</ol>
        </details>
      </>}
    </div>
  );
}

const SAMPLE: Record<string, object> = {
  transaction_created: { customerId: "CUST-0005", sessionId: "SES-A0001", amount: 25000000, channel: "MOBILE_APP", beneficiary: { accountId: "ACC-BEN-7781", bankName: "Bank Nusantara Digital", name: "Rizky Pratama", accountAgeDays: 9 } },
  login_attempt: { customerId: "CUST-0001", deviceId: "iPhone 15 Pro", ip: "185.220.101.44", ipCountry: "RU", success: false, failedAttempts: 2 },
  account_update: { customerId: "CUST-0001", deviceId: "iPhone 15 Pro", ipCountry: "ID", change: "phone" },
};
// Publish the deployed workflow as POST /api/flows/{slug}; switch it Active / Inactive; try it with a payload (dry run).
function ApiPanel({ wf, canDeploy, dirty, reload }: { wf: Detail; canDeploy: boolean; dirty: boolean; reload: () => void }) {
  const ep = wf.endpoint, trig = (wf.nodes.find((n) => n.type === "trigger")?.data as { event?: string })?.event ?? "transaction_created";
  const [slug, setSlug] = useState(ep?.slug ?? wf.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
  const [payload, setPayload] = useState(JSON.stringify(SAMPLE[trig] ?? SAMPLE.transaction_created, null, 2)), [res, setRes] = useState<Record<string, unknown> | null>(null), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const url = `${typeof window === "undefined" ? "" : location.origin}/api/flows/${ep?.slug ?? slug}`;
  const post = async (op: string, body: object = {}) => { setBusy(true); setErr(""); const r = await fetch(`/api/workflows/${wf.id}/${op}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json(); setBusy(false); if (!r.ok) { setErr(j.error); return null; } return j; };
  async function tryIt() { let p: unknown; try { p = JSON.parse(payload); } catch { return setErr("Payload is not valid JSON."); } setRes(null); const j = await post("try", { payload: p }); if (j) setRes(j); }
  const curl = `curl -X POST '${url}' \\\n  -H 'Content-Type: application/json' -H 'X-API-Key: <key>' \\\n  -d '${JSON.stringify(SAMPLE[trig] ?? {})}'`;
  return (
    <div className="rule-form">
      {wf.role && <div className="cp-rec LOW" style={{ display: "grid", gap: 6 }}>
        <span><b>Default workflow · served at <code>POST {DEFAULT_ROUTE[wf.role]}</code></b></span>
        <small className="mute">This route is fixed: the default workflow always decides it (save + deploy to change the logic) and cannot be published on another route, archived or deleted. If it has no deployed version the built-in pipeline answers.</small>
      </div>}
      {!wf.role && <><b>Publish as API endpoint</b>
      <small className="mute">The banking app calls this endpoint and the <b>deployed</b> version (v{wf.deployedVersion ?? "—"}) decides the outcome for real: Block → declined, Challenge → OTP sent, Flag for review → held for an analyst, no action → allowed.</small>
      {wf.status !== "Active" && <p className="auth-err" style={{ margin: 0 }}>Deploy the workflow first; only a deployed version can serve an endpoint.</p>}
      {dirty && <small className="MEDIUM">Unsaved changes are not live until you save and deploy.</small>}
      {!ep ? <>
        <label className="field"><span>Endpoint name</span><span className="copy-field"><code>/api/flows/</code><input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} style={{ border: "none", background: "none", padding: 0, flex: 1 }} aria-label="Endpoint name" /></span></label>
        {canDeploy && <button className="btn" disabled={busy || !slug} onClick={async () => { if (await post("publish", { slug })) reload(); }}>Publish endpoint</button>}
      </> : <>
        <div className="field"><span>Endpoint</span><span className="copy-field"><code>POST {url}</code><button className="icon" onClick={() => navigator.clipboard?.writeText(url)} aria-label="Copy URL"><Copy size={14} /></button></span></div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {canDeploy ? <button className={`switch${ep.enabled ? " on" : ""}`} role="switch" aria-checked={ep.enabled} disabled={busy} onClick={async () => { if (await post(ep.enabled ? "endpoint-off" : "endpoint-on")) reload(); }}><i />{ep.enabled ? "Active" : "Inactive"}</button>
            : <span className={`chip ${ep.enabled ? "LOW" : ""}`}>{ep.enabled ? "Active" : "Inactive"}</span>}
          <span className="mute">{ep.calls} live calls{ep.lastCallAt ? ` · last ${ago(ep.lastCallAt)}` : ""}</span>
          {canDeploy && <button className="linkish" style={{ marginLeft: "auto" }} disabled={busy} onClick={async () => { if (confirm("Unpublish? The banking app will get 404 from this endpoint.")) { if (await post("unpublish")) reload(); } }}>Unpublish</button>}
        </div>
        {!ep.enabled && <small className="mute">Inactive: callers get 423 FLOW_INACTIVE and should fall back to /api/transactions/score.</small>}
        <details><summary className="mute">curl example</summary><pre className="wf-expr" style={{ fontSize: 11 }}>{curl}</pre></details>
        </>}
      </>}
      {wf.status === "Active" && <>
        <label className="field"><span>Try it: payload ({TRIGGERS[trig as keyof typeof TRIGGERS] ?? trig})</span><textarea className="json-editor" rows={8} value={payload} onChange={(e) => setPayload(e.target.value)} spellCheck={false} /></label>
        <button className="ico-btn" disabled={busy} onClick={tryIt}><Play size={14} /> Try (dry run)</button>
        {res && <div className={`dbg-cur ${res.decision === "ALLOW" ? "ok" : "err"}`}>
          <b>Decision: {String(res.decision)}</b>{"transactionStatus" in res && <span className="mute"> · transfer would be {String(res.transactionStatus)}</span>}
          <div className="mute">Actions: {(res.actions as string[]).map((a) => ACTIONS[a as keyof typeof ACTIONS] ?? a).join(", ") || "none"} · {String(res.ms)} ms · nothing saved</div>
          {Object.keys(res.variables as object).length > 0 && <div className="dbg-vars">{Object.entries(res.variables as object).map(([k, v]) => <code key={k}>{k} = {JSON.stringify(v)}</code>)}</div>}
          {(res.errors as string[] | undefined)?.length ? <div className="auth-err">{(res.errors as string[]).join("; ")}</div> : null}
        </div>}
      </>}
      {err && <p className="auth-err" style={{ margin: 0 }}>{err}</p>}
      {ep && wf.runs.filter((r) => r.mode === "live").length > 0 && <><b style={{ marginTop: 6 }}>Recent live calls</b>
        <ul className="run-list">{wf.runs.filter((r) => r.mode === "live").slice(0, 10).map((r, i) => <li key={i}><span className={r.decision === "ALLOW" ? "LOW" : "HIGH"}>{r.decision}</span><span>{ago(r.at)}<div className="mute">{r.ref} · {r.ms} ms</div></span><span className="mute" style={{ marginLeft: "auto" }}>{r.fired.join(", ") || "no action"}</span></li>)}</ul></>}
    </div>
  );
}

function Versions({ wf, canManage, dirty, rollback }: { wf: Detail; canManage: boolean; dirty: boolean; rollback: (v: Version) => void }) {
  return (
    <div className="rule-form">
      <b>Version history</b>
      {dirty && <small className="auth-err">You have unsaved changes. Save or discard them before rolling back.</small>}
      <ul className="imp-list">
        {[...wf.versions].reverse().map((v) => (
          <li key={v.version}>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <span style={{ display: "grid", gap: 2, flex: 1 }}>
                <b>v{v.version} {v.version === wf.version && <span className="chip">current</span>} {v.version === wf.deployedVersion && <span className="chip LOW">deployed</span>}</b>
                <small>{v.note}</small>
                <small className="mute">{v.savedBy} · {dt(v.savedAt)} · {v.nodes.length} nodes</small>
              </span>
              {canManage && v.version !== wf.version && <button className="ico-btn" disabled={dirty} onClick={() => rollback(v)}><RotateCcw size={13} /> Rollback</button>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Metrics({ wf }: { wf: Detail }) {
  const m = wf.metrics;
  return (
    <div className="rule-form">
      <b>Performance</b>
      <small className="mute">Shadow runs of the deployed version on real transfers (last {wf.runs.length ? 500 : 0} runs kept).</small>
      <div className="metric-grid">
        <div><span className="mute">Avg execution</span><b>{m.avgMs === null ? "—" : `${m.avgMs} ms`}</b></div>
        <div><span className="mute">Error rate</span><b className={m.errorRate ? "HIGH" : ""}>{pct(m.errorRate)}</b></div>
        <div><span className="mute">Throughput</span><b>{m.throughputPerHour}/h</b></div>
        <div><span className="mute">Success rate</span><b>{pct(m.successRate)}</b></div>
        <div><span className="mute">Runs (24 h)</span><b>{m.runs24h}</b></div>
        <div><span className="mute">Actions fired</span><b>{m.fired}</b></div>
      </div>
      <b style={{ marginTop: 8 }}>Recent runs</b>
      {!wf.runs.length ? <p className="mute" style={{ margin: 0 }}>{wf.status === "Active" ? "No runs yet. Runs appear when new transfers arrive." : "Deploy the workflow to start recording runs."}</p> : (
        <ul className="run-list">{wf.runs.map((r, i) => <li key={i}><span className={r.ok ? "LOW" : "HIGH"}>{r.ok ? "✓" : "✗"}</span><span>{ago(r.at)}<div className="mute">{r.ref} · {r.ms} ms</div></span><span className="mute" style={{ marginLeft: "auto", textAlign: "right" }}>{r.error ?? (r.fired.length ? r.fired.map((f) => ACTIONS[f as keyof typeof ACTIONS]).join(", ") : "no action")}</span></li>)}</ul>
      )}
    </div>
  );
}

export default function WorkflowEditor(p: { id: string | null; canManage: boolean; canDeploy: boolean }) { return <ReactFlowProvider><Editor {...p} /></ReactFlowProvider>; }
