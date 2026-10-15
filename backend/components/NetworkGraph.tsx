"use client";
import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BaseEdge, EdgeLabelRenderer, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, getStraightPath, useReactFlow, type Edge, type EdgeProps, type Node, type NodeProps } from "@xyflow/react";
import { Ban, Building2, Clock, Download, Globe, Landmark, Maximize, Smartphone, User, Users, X, ZoomIn, ZoomOut } from "lucide-react";
import type { AccountGraph, GEdge, GNode } from "@/lib/graph";
import { ago, idr } from "@/lib/format";
import { Skel } from "./Skeleton";

const ICON: Record<GNode["kind"], React.ReactNode> = {
  center: <Landmark size={22} />, sender: <User size={18} />, onward: <Users size={18} />, bank: <Building2 size={16} />, name: <Clock size={16} />, device: <Smartphone size={16} />, country: <Globe size={16} />,
};
const KIND_LABEL: Record<GNode["kind"], string> = { center: "Beneficiary account", sender: "Sender (customer)", onward: "Linked account", bank: "Bank", name: "Account age", device: "Device", country: "IP country" };
const short = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} M` : n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} jt` : n >= 1e3 ? `${Math.round(n / 1e3)} rb` : String(n));
const dt = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

type ND = GNode & { selected?: boolean } & Record<string, unknown>;
function GraphNode({ data }: NodeProps<Node<ND>>) {
  const d = data;
  return (
    <div className={`gnode ${d.kind}${d.flagged ? " flagged" : ""}${d.blocked ? " blocked" : ""}${d.selected ? " sel" : ""}`}>
      <Handle type="target" position={Position.Top} className="ghandle" /><Handle type="source" position={Position.Bottom} className="ghandle" />
      <div className="gdot">{ICON[d.kind]}{d.blocked && <span className="gban" title="Blocklisted"><Ban size={12} /></span>}{(d.count ?? 1) > 1 && d.kind !== "sender" && <span className="gcount">{d.count}</span>}</div>
      <div className="glabel">{d.label}</div>{d.sub && <div className="gsub">{d.sub}</div>}
    </div>
  );
}
// Straight edge with the amount pill in the middle, like a money-flow graph.
function MoneyEdge({ id, sourceX, sourceY, targetX, targetY, markerEnd, style, data }: EdgeProps<Edge<{ e: GEdge }>>) {
  const [path, lx, ly] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  const e = data!.e, money = e.kind === "transfer" || (e.kind === "onward" && e.amount > 0);
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {money && <EdgeLabelRenderer><div className={`gpill${e.fraud ? " fraud" : ""}`} style={{ transform: `translate(-50%,-50%) translate(${lx}px,${ly}px)` }}>Rp {short(e.amount)} ({e.count})</div></EdgeLabelRenderer>}
      {e.kind === "shared_device" && <EdgeLabelRenderer><div className="gpill dev" style={{ transform: `translate(-50%,-50%) translate(${lx}px,${ly}px)` }}>shared device</div></EdgeLabelRenderer>}
    </>
  );
}
const NODE_TYPES = { g: GraphNode }, EDGE_TYPES = { money: MoneyEdge };

// Radial layout: senders on the left arc, linked accounts on the right, bank / age above, devices and IP countries outside their sender.
function layout(g: AccountGraph, sel: string | null) {
  const pos = new Map<string, { x: number; y: number }>([[g.accountId, { x: 0, y: 0 }]]);
  const arc = (ids: string[], from: number, to: number, r: number) => ids.forEach((id, i) => { const a = ids.length === 1 ? (from + to) / 2 : from + ((to - from) * i) / (ids.length - 1); pos.set(id, { x: Math.cos(a) * r, y: Math.sin(a) * r }); });
  const of = (k: GNode["kind"]) => g.nodes.filter((n) => n.kind === k).map((n) => n.id);
  const senders = of("sender"), linked = of("onward");
  arc(senders, Math.PI * 0.62, Math.PI * 1.38, Math.max(260, senders.length * 34));
  arc(linked, -Math.PI * 0.38, Math.PI * 0.38, Math.max(260, linked.length * 30));
  arc([...of("bank"), ...of("name")], -Math.PI * 0.68, -Math.PI * 0.32, 190);
  // attributes: place near the first sender that uses them, further out
  const attrs = [...of("device"), ...of("country")];
  attrs.forEach((id, i) => {
    const owner = g.edges.find((e) => e.target === id)?.source, p = owner && pos.get(owner);
    const a = p ? Math.atan2(p.y, p.x) + ((i % 3) - 1) * 0.12 : Math.PI / 2 + i * 0.25, r = p ? Math.hypot(p.x, p.y) + 150 : 230;
    pos.set(id, { x: Math.cos(a) * r, y: Math.sin(a) * r });
  });
  const nodes: Node<ND>[] = g.nodes.map((n) => ({ id: n.id, type: "g", position: pos.get(n.id) ?? { x: 0, y: 260 }, data: { ...n, selected: n.id === sel }, origin: [0.5, 0.5] }));
  const edges: Edge<{ e: GEdge }>[] = g.edges.map((e) => {
    const money = e.kind === "transfer" || e.kind === "onward", color = e.fraud ? "#dc2626" : e.kind === "shared_device" ? "#f59e0b" : money ? "#6b46c1" : "#a1a1aa";
    return { id: e.id, source: e.source, target: e.target, type: "money", data: { e }, style: { stroke: color, strokeWidth: money ? 1.8 : 1, strokeDasharray: e.kind === "shared_device" ? "6 4" : e.kind === "attribute" ? "2 4" : undefined, opacity: sel && e.source !== sel && e.target !== sel ? 0.25 : 1 },
      ...(money && { markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 } }) };
  });
  return { nodes, edges };
}

function Graph({ g }: { g: AccountGraph }) {
  const [sel, setSel] = useState<string | null>(null);
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const { nodes, edges } = useMemo(() => layout(g, sel), [g, sel]);
  const node = g.nodes.find((n) => n.id === sel), rel = g.edges.filter((e) => e.source === sel || e.target === sel);
  function csv() {
    const rows = [["from", "to", "type", "amount_idr", "count", "fraud"], ...g.edges.map((e) => [g.nodes.find((n) => n.id === e.source)?.label ?? e.source, g.nodes.find((n) => n.id === e.target)?.label ?? e.target, e.kind, e.amount, e.count, e.fraud])];
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv" }));
    a.download = `connections-${g.accountId}.csv`; a.click(); URL.revokeObjectURL(a.href);
  }
  return (
    <div className="gwrap">
      <div className="gcanvas">
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={NODE_TYPES} edgeTypes={EDGE_TYPES} fitView fitViewOptions={{ padding: 0.15 }} minZoom={0.2} maxZoom={2.5}
          nodesConnectable={false} onNodeClick={(_, n) => setSel(n.id === sel ? null : n.id)} onPaneClick={() => setSel(null)} proOptions={{ hideAttribution: true }} />
        <div className="gtools">
          <button className="icon" onClick={() => zoomIn({ duration: 200 })} aria-label="Zoom in" title="Zoom in"><ZoomIn size={16} /></button>
          <button className="icon" onClick={() => zoomOut({ duration: 200 })} aria-label="Zoom out" title="Zoom out"><ZoomOut size={16} /></button>
          <button className="icon" onClick={() => fitView({ padding: 0.15, duration: 300 })} aria-label="Fit" title="Fit"><Maximize size={16} /></button>
          <button className="icon" onClick={csv} aria-label="Export connections as CSV" title="Export CSV"><Download size={16} /></button>
        </div>
        <div className="glegend">
          <span><i className="lg center" /> beneficiary</span><span><i className="lg sender" /> sender</span><span><i className="lg flag" /> fraud-linked</span><span><Ban size={11} className="HIGH" /> blocklisted</span>
          <span><b className="lg-line money" /> transfer</span><span><b className="lg-line fraud" /> confirmed fraud</span><span><b className="lg-line dev" /> shared device</span>
        </div>
      </div>
      {node && (
        <aside className="gside card">
          <div className="hdr" style={{ margin: 0 }}><span className={`gdot mini ${node.kind}${node.flagged ? " flagged" : ""}`}>{ICON[node.kind]}</span><div><b>{node.label}</b><div className="mute">{KIND_LABEL[node.kind]}{node.sub ? ` · ${node.sub}` : ""}</div></div>
            <button className="icon" style={{ marginLeft: "auto" }} onClick={() => setSel(null)} aria-label="Close"><X size={16} /></button></div>
          <div className="filters" style={{ margin: 0 }}>{node.flagged && <span className="chip HIGH">Fraud-linked</span>}{node.blocked && <span className="chip HIGH"><Ban size={11} /> Blocklisted</span>}{(node.count ?? 1) > 1 && <span className="chip">Seen {node.count}×</span>}</div>
          {rel.filter((e) => e.txs.length).map((e) => (
            <div key={e.id}><b>{idr(e.amount)}</b> <span className="mute">in {e.count} transfer{e.count > 1 ? "s" : ""}</span>
              <ul className="gtx">{[...e.txs].reverse().map((t) => (
                <li key={t.id}><span>{dt(t.at)}</span><b>{idr(t.amount)}</b><span className="mute">{t.status.toLowerCase()}</span>
                  {t.alertId && <Link href={`/alerts/${t.alertId}`} className={`chip ${t.outcome === "FRAUD" ? "HIGH" : t.risk ?? ""}`}>{t.alertId}{t.outcome ? ` · ${t.outcome === "FRAUD" ? "fraud" : "ok"}` : ""}</Link>}</li>
              ))}</ul>
            </div>
          ))}
          {!rel.some((e) => e.txs.length) && <p className="mute" style={{ margin: 0 }}>{rel.length} connection(s). {node.kind === "onward" ? "From the network intelligence feed." : node.kind === "device" || node.kind === "country" ? "Used in transfers to this account." : ""}</p>}
        </aside>
      )}
    </div>
  );
}

// `expand` opens the panel when the Assistant report cites RC_MULE_NETWORK.
export default function NetworkGraph({ accountId, expand }: { accountId: string; expand?: boolean }) {
  const [g, setG] = useState<AccountGraph | null>(null), [tab, setTab] = useState<"graph" | "timeline">("graph");
  useEffect(() => { fetch(`/api/accounts/${encodeURIComponent(accountId)}/graph`).then((r) => r.json()).then(setG); }, [accountId]);
  void expand;
  if (!g) return <div className="card"><Skel w={260} h={20} /><div style={{ height: 12 }} /><Skel h={420} /></div>;
  const m = g.summary;
  return (
    <div className="card gcard">
      <div className="ghead">
        <div className={`gdot big center${m.fraud ? " flagged" : ""}`}><Landmark size={22} /></div>
        <div><b style={{ fontSize: 16 }}>{g.name ?? "Beneficiary account"}</b><div className="mute">{g.accountId}{g.bank ? ` · ${g.bank}` : ""}</div></div>
        {g.blocked.length > 0 && <span className="chip HIGH gblock" title={g.blocked.map((b) => b.label).join(", ")}><Ban size={12} /> Blocklisted attributes ({g.blocked.length})</span>}
        <div className="gstats">
          <span><b>{idr(m.received)}</b><small>received</small></span><span><b>{m.transfers}</b><small>transfers</small></span><span><b>{m.senders}</b><small>senders</small></span>
          <span><b className={m.alerts ? "MEDIUM" : ""}>{m.alerts}</b><small>alerts</small></span><span><b className={m.fraud ? "HIGH" : ""}>{m.fraud}</b><small>confirmed fraud</small></span>
          <span><b>{m.linkedAccounts}</b><small>linked accounts</small></span>{m.maxRisk && <span><b className={m.maxRisk}>{m.maxRisk}</b><small>max risk</small></span>}
          {m.firstSeen && <span><b>{ago(m.firstSeen)}</b><small>first seen</small></span>}
        </div>
      </div>
      <div className="auth-tabs" role="tablist" style={{ margin: "4px 0 10px" }}>
        <button role="tab" aria-selected={tab === "graph"} onClick={() => setTab("graph")}>Connections graph</button>
        <button role="tab" aria-selected={tab === "timeline"} onClick={() => setTab("timeline")}>Timeline ({g.timeline.length})</button>
      </div>
      {tab === "graph" ? <ReactFlowProvider><Graph g={g} /></ReactFlowProvider> : (
        <ol className="gtimeline">{g.timeline.map((t, i) => (
          <li key={i} className={t.kind}><span className={`tdot ${t.risk ?? ""}`} /><div><b>{t.text}</b><div className="mute">{dt(t.at)}{t.ref && <> · {t.ref.startsWith("ALT") ? <Link href={`/alerts/${t.ref}`}>{t.ref}</Link> : t.ref}</>}</div></div></li>
        ))}{!g.timeline.length && <li className="mute">No history for this account yet.</li>}</ol>
      )}
    </div>
  );
}
