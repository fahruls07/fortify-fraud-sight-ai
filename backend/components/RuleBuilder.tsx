"use client";
import "@xyflow/react/dist/style.css";
import { useEffect, useRef, useState } from "react";
import {
  addEdge, Background, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState, useReactFlow,
  type Connection, type Edge, type Node, type NodeProps,
} from "@xyflow/react";
import { GitBranch, Plus, X, Zap } from "lucide-react";
import { FIELDS, RULE_ACTIONS, SEVERITIES, validateRule, type Field, type Leaf, type Rule, type RuleBody } from "@/lib/rules/dsl";
import { DEFAULTS, FIELD_LABEL, OPS_FOR, toGraph, toRule, type ActionData, type CondData, type RuleAction, type WfNode } from "@/lib/rules/workflow";
import { idr } from "@/lib/format";
import Link from "next/link";
import { useRouter } from "next/navigation";
import CopilotChat from "./CopilotChat";

type Backtest = { matched: number; total: number; windowDays: number; alertIds: string[] };
type Meta = Pick<RuleBody, "name" | "description" | "severity">;
type Item = { kind: "condition"; field: Field } | { kind: "action"; action: RuleAction };

const OP: Record<Leaf["op"], string> = { ">": "greater than", ">=": "at least", "<": "less than", "<=": "at most", "==": "equals", "!=": "not", in: "one of", isNotNull: "detected" };
const ACTION_LABEL: Record<RuleAction, string> = { ALLOW: "Allow", CHALLENGE: "Request verification", HOLD: "Hold for review", DECLINE: "Decline transaction" };
const MIME = "application/x-fortify-block";
const EDGE = { type: "smoothstep", markerEnd: { type: MarkerType.ArrowClosed } } as const;
const BLANK: Meta = { name: "", description: "", severity: "MEDIUM" };

function TriggerNode() {
  return (
    <div className="wf-node trigger">
      <span className="wf-ico"><Zap size={14} /></span>
      <div><b>Transfer submitted</b><small>Every internet banking transaction</small></div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function ConditionNode({ id, data }: NodeProps<Node<CondData>>) {
  const { updateNodeData, deleteElements } = useReactFlow();
  const type = FIELDS[data.field], base = type.replace("?", "");
  const set = (p: Partial<CondData>) => updateNodeData(id, p);
  return (
    <div className="wf-node cond">
      <Handle type="target" position={Position.Top} />
      <header><b>{FIELD_LABEL[data.field]}</b><button className="icon nodrag" onClick={() => deleteElements({ nodes: [{ id }] })} aria-label="Delete block"><X size={14} /></button></header>
      <div className="wf-row nodrag">
        <select value={data.op} onChange={(e) => set({ op: e.target.value as Leaf["op"] })} aria-label="Operator">
          {OPS_FOR[type].map((o) => <option key={o} value={o}>{OP[o]}</option>)}
        </select>
        {data.op !== "isNotNull" && (base === "boolean"
          ? <select value={data.text} onChange={(e) => set({ text: e.target.value })} aria-label="Value"><option value="true">Yes</option><option value="false">No</option></select>
          : <input value={data.text} onChange={(e) => set({ text: e.target.value })} aria-label="Value" placeholder={data.op === "in" ? "comma-separated" : "value"} inputMode={base === "number" && data.op !== "in" ? "numeric" : undefined} />)}
      </div>
      {data.field === "amount" && data.op !== "in" && Number(data.text) > 0 && <small className="mute">{idr(Number(data.text))}</small>}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function ActionNode({ id, data }: NodeProps<Node<ActionData>>) {
  const { updateNodeData, deleteElements } = useReactFlow();
  return (
    <div className={`wf-node act ${data.action}`}>
      <Handle type="target" position={Position.Top} />
      <header><b>Action</b><button className="icon nodrag" onClick={() => deleteElements({ nodes: [{ id }] })} aria-label="Delete block"><X size={14} /></button></header>
      <select className="nodrag" value={data.action} onChange={(e) => updateNodeData(id, { action: e.target.value })} aria-label="Action">
        {RULE_ACTIONS.map((a) => <option key={a} value={a}>{ACTION_LABEL[a]} ({a})</option>)}
      </select>
    </div>
  );
}
const NODE_TYPES = { trigger: TriggerNode, condition: ConditionNode, action: ActionNode };

function Builder({ ruleId, canManage, canActivate }: Props) {
  const router = useRouter();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [meta, setMeta] = useState<Meta>(BLANK);
  const [saved, setSaved] = useState<{ rule: Rule; key: string } | null>(null);
  const [bt, setBt] = useState<{ ruleId: string; r: Backtest } | null>(null);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, fitView } = useReactFlow();

  // Compile the canvas on every render; the server re-validates on save (trust boundary in validateRule).
  const compiled = toRule(nodes as WfNode[], edges);
  const v = "error" in compiled ? compiled : !meta.name.trim() ? { error: "Enter a rule name." } : !meta.description.trim() ? { error: "Enter a rule description." }
    : validateRule({ ...meta, condition: compiled.condition, action: compiled.action });
  const body = "rule" in v ? v.rule : null;
  const key = body ? JSON.stringify(body) : "";
  const current = saved && saved.key === key ? saved.rule : null; // any edit turns this into an unsaved new draft

  function show(g: { nodes: WfNode[]; edges: { id: string; source: string; target: string }[] }) {
    setNodes(g.nodes as Node[]);
    setEdges(g.edges.map((e) => ({ ...e, ...EDGE })));
    requestAnimationFrame(() => fitView({ padding: 0.2, duration: 300 }));
  }
  function open(r: Rule) {
    show(toGraph(r.condition, r.action));
    setMeta({ name: r.name, description: r.description, severity: r.severity });
    const ok = validateRule(r);
    setSaved("rule" in ok ? { rule: r, key: JSON.stringify(ok.rule) } : null);
    setNote(""); setErr("");
  }
  function blank() {
    show({ nodes: [{ id: "trigger", type: "trigger", position: { x: 0, y: 0 }, data: {}, deletable: false }, { id: "action", type: "action", position: { x: 0, y: 260 }, data: { action: "HOLD" } }], edges: [] });
    setMeta(BLANK); setSaved(null); setNote(""); setErr("");
  }

  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (!ruleId) return blank();
    fetch(`/api/rules/${ruleId}`).then((r) => (r.ok ? r.json().then(open) : setMissing(true)));
  }, [ruleId]);

  function add(item: Item, at?: { x: number; y: number }) {
    if (!at) { const b = canvas.current!.getBoundingClientRect(); at = screenToFlowPosition({ x: b.left + b.width / 2 - 115, y: b.top + b.height / 2 - 40 }); }
    const id = crypto.randomUUID();
    setNodes((ns) => [...ns, item.kind === "condition"
      ? { id, type: "condition", position: at, data: { field: item.field, ...DEFAULTS[item.field] } }
      : { id, type: "action", position: at, data: { action: item.action } }]);
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const raw = e.dataTransfer.getData(MIME);
    if (raw) add(JSON.parse(raw) as Item, screenToFlowPosition({ x: e.clientX - 115, y: e.clientY - 20 }));
  }
  const onConnect = (c: Connection) => setEdges((es) => addEdge({ ...c, ...EDGE }, es.filter((x) => !(x.source === c.source && x.target === c.target))));

  async function call(url: string, payload?: unknown, method = "POST") {
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: payload ? JSON.stringify(payload) : undefined });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    return j;
  }
  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(""); try { await fn(); } catch (e) { setErr((e as Error).message); } setBusy(false); };
  // Editing an existing rule updates it in place (PUT); a new draft is created once, then the URL moves to its edit page.
  const ensureSaved = async () => {
    if (current) return current;
    if (ruleId) { const r: Rule = await call(`/api/rules/${ruleId}`, body, "PUT"); setSaved({ rule: r, key }); return r; }
    const r: Rule = await call("/api/rules", body); setSaved({ rule: r, key }); router.replace(`/rules/${r.id}`); return r;
  };
  const save = () => run(async () => { await ensureSaved(); });
  const backtest = () => run(async () => { const r = await ensureSaved(); setBt({ ruleId: r.id, r: await call(`/api/rules/${r.id}/backtest`) }); });
  const activate = () => run(async () => { const r = await ensureSaved(); const a: Rule = await call(`/api/rules/${r.id}/activate`); setSaved({ rule: a, key }); });
  const deactivate = () => run(async () => { const d: Rule = await call(`/api/rules/${ruleId}/deactivate`); setSaved((p) => p && { ...p, rule: d }); });
  const remove = () => confirm(`Delete rule ${ruleId}? This cannot be undone.`) && run(async () => { await call(`/api/rules/${ruleId}`, undefined, "DELETE"); router.push("/rules"); });

  const palette = (item: Item, label: string, cls: string) => (
    <div key={label} className={`wf-item ${cls}`} draggable role="button" tabIndex={0} title="Drag onto the canvas, or click to add"
      onDragStart={(e) => { e.dataTransfer.setData(MIME, JSON.stringify(item)); e.dataTransfer.effectAllowed = "move"; }}
      onClick={() => add(item)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), add(item))}>
      <Plus size={14} />{label}
    </div>
  );

  if (missing) return <p className="mute">Rule {ruleId} not found. <Link href="/rules">Back to rules</Link></p>;
  return (
    <>
      <div className="cp-dock" style={{ marginBottom: 16 }}>
        <CopilotChat kind="rule" getCurrent={() => ({ ...meta, ...("condition" in compiled ? { condition: compiled.condition, action: compiled.action } : {}) })}
          onApply={(p) => { const r = p as RuleBody | null; if (!r?.condition) return; show(toGraph(r.condition, r.action)); setMeta({ name: r.name, description: r.description, severity: r.severity }); setSaved(null); setNote("Built by Assistant. Review the flow, then save."); }}
          summary={(p) => `${p.name} · ${String(p.expression ?? "")} → ${String(p.action)}`} />
      </div>

      <div className="wf">
        <aside className="card wf-palette">
          <div className="mute">Conditions</div>
          {(Object.keys(FIELDS) as Field[]).map((f) => palette({ kind: "condition", field: f }, FIELD_LABEL[f], "cond"))}
          <div className="mute" style={{ marginTop: 12 }}>Actions</div>
          {RULE_ACTIONS.map((a) => palette({ kind: "action", action: a }, ACTION_LABEL[a], `act ${a}`))}
        </aside>

        <div className="card wf-canvas" ref={canvas} onDrop={onDrop} onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}>
          <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} nodeTypes={NODE_TYPES}
            isValidConnection={(c) => c.source !== c.target} fitView minZoom={0.3} maxZoom={1.5} deleteKeyCode={["Backspace", "Delete"]}>
            <Background gap={20} />
            <Controls showInteractive={false} />
          </ReactFlow>
          <div className="wf-hint"><GitBranch size={13} /> Chain in series = <b>all</b> conditions (AND) · Parallel branches from Trigger = <b>any</b> (OR)</div>
        </div>

        <aside className="card wf-side">
          <div className="hdr" style={{ margin: 0 }}>
            <b>{current ? current.id : "New draft"}</b>
            {current && <span className={`chip ${current.status === "Active" ? "LOW" : "MEDIUM"}`}>{current.status}</span>}
          </div>
          {note && <p className="mute" style={{ margin: 0 }}>{note}</p>}
          <label className="field"><span>Name</span><input value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} /></label>
          <label className="field"><span>Description</span><textarea rows={3} value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} /></label>
          <label className="field"><span>Severity</span>
            <select value={meta.severity} onChange={(e) => setMeta({ ...meta, severity: e.target.value as Meta["severity"] })}>{SEVERITIES.map((s) => <option key={s}>{s}</option>)}</select>
          </label>
          <div className="field"><span>Expression</span>
            {body ? <code className="wf-expr">{body.expression}</code> : <p className="auth-err" role="status">{"error" in v && v.error}</p>}
            {"mode" in compiled && <small className="mute">{compiled.mode === "all" ? "All conditions must match" : "Any one condition is enough"} → {ACTION_LABEL[compiled.action]}</small>}
          </div>
          <div className="wf-btns">
            <button className="btn" onClick={save} disabled={busy || !body || !!current}>{current ? "Saved" : ruleId ? "Save changes" : "Save draft"}</button>
            <button onClick={backtest} disabled={busy || !body}>Backtest</button>
            {canActivate && (saved?.rule.status === "Active" && current
              ? <button onClick={deactivate} disabled={busy}>Deactivate</button>
              : <button onClick={activate} disabled={busy || !body}>{ruleId ? "Activate" : "Save & activate"}</button>)}
            {ruleId && canManage && saved?.rule.status !== "Active" && <button className="danger" onClick={remove} disabled={busy}>Delete</button>}
            {saved?.rule.status === "Active" && !current && <small className="mute" style={{ flexBasis: "100%" }}>Saving changes moves this rule back to Draft; activate it again afterwards.</small>}
            <button onClick={() => router.push("/rules")} disabled={busy} style={{ flexBasis: "100%" }}>← Back to rules</button>
          </div>
          {bt && bt.ruleId === current?.id && <p role="status" style={{ margin: 0 }}>This rule would catch <b>{bt.r.matched}</b> of {bt.r.total} transactions in the last {bt.r.windowDays} days{bt.r.alertIds.length ? `, including ${bt.r.alertIds.slice(0, 3).join(", ")}` : ""}.</p>}
          {err && <p className="auth-err" role="alert">{err}</p>}
        </aside>
      </div>

    </>
  );
}

type Props = { ruleId?: string; canManage: boolean; canActivate: boolean };
export default function RuleBuilder(p: Props) { return <ReactFlowProvider><Builder {...p} /></ReactFlowProvider>; }
