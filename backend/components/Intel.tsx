"use client";
import { useEffect, useState } from "react";
import { Ban, CheckCircle2, Fingerprint, MessageCircle, Plus, Search, ShieldAlert, Trash2, X } from "lucide-react";
import { AML_TYPES, LIST_TYPES, type AmlEntry, type AmlResult, type ListEntry, type RiskEvent } from "@/lib/intel";
import type { CustomerMessage } from "@/lib/custchannel";
import { ago } from "@/lib/format";
import { usePager } from "./Pager";
import { SkelTable } from "./Skeleton";

const TABS = [
  { key: "lists", label: "Watchlists", icon: Ban },
  { key: "aml", label: "AML", icon: ShieldAlert },
  { key: "events", label: "Login & account events", icon: Fingerprint },
  { key: "messages", label: "Customer messages", icon: MessageCircle },
] as const;
const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export default function Intel({ canManage, tab: initial }: { canManage: boolean; tab: string }) {
  const [tab, setTab] = useState(TABS.some((t) => t.key === initial) ? initial : "lists");
  const go = (t: string) => { setTab(t); history.replaceState(null, "", `/intel?tab=${t}`); };
  return (
    <>
      <div className="hdr"><div><h1 style={{ margin: 0 }}>Risk Intelligence</h1><span className="mute">Blacklists and whitelists, AML screening lists, login / account-change events from the banking app, and every message sent to customers.</span></div></div>
      <div className="auth-tabs tabs-ico" role="tablist" style={{ marginBottom: 16, flexWrap: "wrap" }}>
        {TABS.map(({ key, label, icon: Icon }) => <button key={key} role="tab" aria-selected={tab === key} onClick={() => go(key)}><Icon size={15} /> {label}</button>)}
      </div>
      {tab === "lists" && <Lists canManage={canManage} />}
      {tab === "aml" && <Aml canManage={canManage} />}
      {tab === "events" && <Events />}
      {tab === "messages" && <Messages />}
    </>
  );
}

function Lists({ canManage }: { canManage: boolean }) {
  const [rows, setRows] = useState<ListEntry[] | null>(null), [list, setList] = useState(""), [type, setType] = useState(""), [q, setQ] = useState("");
  const [form, setForm] = useState({ list: "BLACK", type: "ACCOUNT", value: "", reason: "", expiresAt: "" }), [err, setErr] = useState("");
  const load = () => fetch("/api/intel/watchlist").then((r) => r.json()).then(setRows);
  useEffect(() => { load(); }, []);
  const needle = q.trim().toLowerCase(), shown = (rows ?? []).filter((e) => (!list || e.list === list) && (!type || e.type === type) && (!needle || `${e.value} ${e.reason}`.toLowerCase().includes(needle)));
  const pager = usePager(shown);
  async function add() { setErr(""); const r = await post("/api/intel/watchlist", form); if (!r.ok) return setErr((await r.json()).error); setForm({ ...form, value: "", reason: "" }); load(); }
  async function del(e: ListEntry) { if (confirm(`Remove ${e.value} from the ${e.list.toLowerCase()}list?`)) { await fetch(`/api/intel/watchlist/${e.id}`, { method: "DELETE" }); load(); } }
  return (
    <>
      <p className="mute" style={{ marginTop: 0 }}>Checked on every transfer and login. <b>Blacklist</b>: the transfer is always held as HIGH risk (login: +60 risk). <b>Whitelist</b>: Low / Medium transfers pass without an alert; it never overrides a blacklist or a High score.</p>
      {canManage && <div className="card filterbar">
        <label className="field"><span>List</span><select value={form.list} onChange={(e) => setForm({ ...form, list: e.target.value })}><option value="BLACK">Blacklist</option><option value="WHITE">Whitelist</option></select></label>
        <label className="field"><span>Type</span><select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{Object.entries(LIST_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="field" style={{ flex: 1, minWidth: 180 }}><span>Value</span><input style={{ width: "100%" }} value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder={form.type === "IP" ? "10.1.2.3 or 10.1.0.0/16" : form.type === "DEVICE" ? "device ID / model" : form.type === "BENEFICIARY" ? "beneficiary name" : "account number"} /></label>
        <label className="field" style={{ flex: 1, minWidth: 180 }}><span>Reason</span><input style={{ width: "100%" }} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. confirmed mule, case CASE-0001" /></label>
        <label className="field"><span>Expires <span className="mute">(optional)</span></span><input type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} /></label>
        <button className="btn ico-btn" disabled={!form.value.trim()} onClick={add}><Plus size={15} /> Add</button>
        {err && <span className="auth-err" style={{ flexBasis: "100%" }}>{err}</span>}
      </div>}
      <div className="filters">
        <input value={q} onChange={(e) => { setQ(e.target.value); pager.reset(); }} placeholder="Search value or reason…" aria-label="Search" style={{ minWidth: 240 }} />
        <select value={list} onChange={(e) => { setList(e.target.value); pager.reset(); }} aria-label="List"><option value="">Both lists</option><option value="BLACK">Blacklist</option><option value="WHITE">Whitelist</option></select>
        <select value={type} onChange={(e) => { setType(e.target.value); pager.reset(); }} aria-label="Type"><option value="">All types</option>{Object.entries(LIST_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      </div>
      {!rows ? <SkelTable cols={7} /> : <div className="card tablewrap"><table>
        <thead><tr><th>List</th><th>Type</th><th>Value</th><th>Reason</th><th>Hits</th><th>Expires</th><th>Added</th><th /></tr></thead>
        <tbody>
          {pager.shown.map((e) => { const expired = !!e.expiresAt && Date.parse(e.expiresAt) < Date.now(); return (
            <tr key={e.id} style={expired ? { opacity: 0.55 } : undefined}>
              <td><span className={`chip ${e.list === "BLACK" ? "HIGH" : "LOW"}`}>{e.list === "BLACK" ? <><Ban size={11} /> Black</> : <><CheckCircle2 size={11} /> White</>}</span></td>
              <td>{LIST_TYPES[e.type]}</td><td><code>{e.value}</code></td><td className="desc">{e.reason || "—"}</td>
              <td>{e.hits}{e.lastHitAt && <div className="mute">{ago(e.lastHitAt)}</div>}</td><td className="mute">{e.expiresAt ? (expired ? "Expired" : dt(e.expiresAt)) : "Never"}</td>
              <td className="mute">{e.createdBy}<div>{ago(e.createdAt)}</div></td>
              <td>{canManage && <button className="icon danger" onClick={() => del(e)} aria-label="Remove"><Trash2 size={15} /></button>}</td>
            </tr>
          ); })}
          {!shown.length && <tr><td colSpan={8} className="mute empty">No entries.</td></tr>}
        </tbody>
      </table></div>}
      {pager.bar}
    </>
  );
}

function Aml({ canManage }: { canManage: boolean }) {
  const [rows, setRows] = useState<AmlEntry[] | null>(null), [form, setForm] = useState({ name: "", type: "SANCTION", country: "", source: "", notes: "" }), [err, setErr] = useState("");
  const [name, setName] = useState(""), [res, setRes] = useState<AmlResult | null>(null);
  const load = () => fetch("/api/intel/aml").then((r) => r.json()).then(setRows);
  useEffect(() => { load(); }, []);
  const pager = usePager(rows ?? []);
  async function add() { setErr(""); const r = await post("/api/intel/aml", form); if (!r.ok) return setErr((await r.json()).error); setForm({ ...form, name: "", notes: "" }); load(); }
  async function screen() { const r = await post("/api/intel/aml/screen", { name }); if (r.ok) setRes(await r.json()); }
  return (
    <>
      <p className="mute" style={{ marginTop: 0 }}>Every transfer screens the customer and beneficiary names (fuzzy: titles, word order and small typos are handled) plus behaviour: high-risk countries and structuring (3+ transfers just under Rp 100 juta in 24 h). A sanctions match holds the transfer; workflows can use the <b>AML check</b> node.</p>
      <div className="card filterbar">
        <label className="field" style={{ flex: 1, minWidth: 240 }}><span>Screen a name</span><input style={{ width: "100%" }} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim().length > 2 && screen()} placeholder="e.g. Victor Petrov Antonov" /></label>
        <button className="ico-btn" disabled={name.trim().length < 3} onClick={screen}><Search size={15} /> Screen</button>
        {res && <div style={{ flexBasis: "100%" }} className={res.matches.length ? "auth-err" : "ok-msg"}>
          {res.matches.length ? res.matches.map((m) => <div key={m.id}><b>{AML_TYPES[m.type as keyof typeof AML_TYPES]}</b>: {m.name} · {Math.round(m.score * 100)}% match</div>) : "No match on the AML lists."}
        </div>}
      </div>
      {canManage && <div className="card filterbar">
        <label className="field" style={{ flex: 1, minWidth: 200 }}><span>Name</span><input style={{ width: "100%" }} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label className="field"><span>Type</span><select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{Object.entries(AML_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="field"><span>Country</span><input value={form.country} maxLength={2} onChange={(e) => setForm({ ...form, country: e.target.value.toUpperCase() })} placeholder="ID" style={{ width: 70 }} /></label>
        <label className="field"><span>Source</span><input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="e.g. DTTOT, UN, OFAC" /></label>
        <label className="field" style={{ flex: 1, minWidth: 160 }}><span>Notes</span><input style={{ width: "100%" }} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
        <button className="btn ico-btn" disabled={form.name.trim().length < 3} onClick={add}><Plus size={15} /> Add</button>
        {err && <span className="auth-err" style={{ flexBasis: "100%" }}>{err}</span>}
      </div>}
      {!rows ? <SkelTable cols={6} /> : <div className="card tablewrap"><table>
        <thead><tr><th>Name</th><th>Type</th><th>Country</th><th>Source</th><th>Notes</th><th>Added</th><th /></tr></thead>
        <tbody>{pager.shown.map((e) => (
          <tr key={e.id}><td><b>{e.name}</b><div className="mute">{e.id}</div></td><td><span className={`chip ${e.type === "SANCTION" ? "HIGH" : e.type === "PEP" ? "MEDIUM" : ""}`}>{AML_TYPES[e.type]}</span></td>
            <td>{e.country || "—"}</td><td>{e.source || "—"}</td><td className="desc">{e.notes || "—"}</td><td className="mute">{e.createdBy}<div>{ago(e.createdAt)}</div></td>
            <td>{canManage && <button className="icon danger" aria-label="Remove" onClick={async () => { if (confirm(`Remove ${e.name}?`)) { await fetch(`/api/intel/aml/${e.id}`, { method: "DELETE" }); load(); } }}><Trash2 size={15} /></button>}</td></tr>
        ))}{!rows.length && <tr><td colSpan={7} className="mute empty">No AML entries.</td></tr>}</tbody>
      </table></div>}
      {pager.bar}
      <p className="mute" style={{ fontSize: 12 }}>Demo entries are fictional. Load your official lists (e.g. DTTOT / DPPSPM from PPATK, UN, OFAC) before production.</p>
    </>
  );
}

function Events() {
  const [rows, setRows] = useState<RiskEvent[] | null>(null), [type, setType] = useState(""), [decision, setDecision] = useState(""), [open, setOpen] = useState<RiskEvent | null>(null);
  useEffect(() => { const load = () => fetch(`/api/intel/events?${new URLSearchParams({ ...(type && { type }), ...(decision && { decision }) })}`).then((r) => r.json()).then(setRows); load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, [type, decision]);
  const pager = usePager(rows ?? []);
  return (
    <>
      <p className="mute" style={{ marginTop: 0 }}>Sent by the banking app to <code>POST /api/events/login</code> and <code>/api/events/account-update</code>; each is scored (ALLOW / CHALLENGE / DENY) and runs deployed workflows with that trigger. Refreshes every 10 s.</p>
      <div className="filters">
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Type"><option value="">All events</option><option value="login_attempt">Login attempts</option><option value="account_update">Account updates</option></select>
        <select value={decision} onChange={(e) => setDecision(e.target.value)} aria-label="Decision"><option value="">All decisions</option><option>ALLOW</option><option>CHALLENGE</option><option>DENY</option></select>
      </div>
      {!rows ? <SkelTable cols={7} /> : <div className="card tablewrap"><table>
        <thead><tr><th>Event</th><th>Customer</th><th>Device / IP</th><th>Detail</th><th>Score</th><th>Decision</th><th>Reasons</th></tr></thead>
        <tbody>{pager.shown.map((e) => (
          <tr key={e.id} className="clickable" onClick={() => setOpen(e)}><td><b>{e.type === "login_attempt" ? "Login" : "Account update"}</b><div className="mute">{e.id} · {ago(e.at)}</div></td><td>{e.customerId}</td>
            <td>{e.deviceId ?? "—"}<div className="mute">{e.ip ?? ""} {e.ipCountry ?? ""}</div></td>
            <td>{e.type === "login_attempt" ? `${e.success === false ? "failed" : e.success ? "success" : "—"} · ${e.failedAttempts} failed` : e.change}</td>
            <td><b>{e.score}</b></td><td><span className={`chip ${e.decision === "DENY" ? "HIGH" : e.decision === "CHALLENGE" ? "MEDIUM" : "LOW"}`}>{e.decision}</span></td><td className="desc">{e.reasons.join(", ") || "—"}</td></tr>
        ))}{!rows.length && <tr><td colSpan={7} className="mute empty">No events yet. See Settings → API Configuration for the endpoints.</td></tr>}</tbody>
      </table></div>}
      {pager.bar}
      {open && <div className="drawer" role="dialog" aria-label={open.id}><div className="hdr"><b>{open.id}</b><button className="icon" style={{ marginLeft: "auto" }} onClick={() => setOpen(null)} aria-label="Close"><X size={18} /></button></div><pre className="wf-expr">{JSON.stringify(open, null, 2)}</pre></div>}
    </>
  );
}

function Messages() {
  const [rows, setRows] = useState<CustomerMessage[] | null>(null);
  useEffect(() => { const load = () => fetch("/api/intel/messages").then((r) => r.json()).then(setRows); load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, []);
  const pager = usePager(rows ?? []);
  return (
    <>
      <p className="mute" style={{ marginTop: 0 }}>SMS / push sent when an analyst challenges, declines, freezes or releases a transfer. <b>OUTBOX</b> means no gateway is configured (Settings → Notification → Customer messages): the message was not delivered and is shown here for testing. Real OTPs are masked once delivered.</p>
      {!rows ? <SkelTable cols={6} /> : <div className="card tablewrap"><table>
        <thead><tr><th>Time</th><th>Customer</th><th>Channel</th><th>Type</th><th>Message</th><th>Status</th></tr></thead>
        <tbody>{pager.shown.map((m) => (
          <tr key={m.id}><td className="mute">{dt(m.at)}</td><td>{m.customerId}<div className="mute">{m.to}</div></td><td>{m.channel}</td><td>{m.kind}<div className="mute">{m.ref}</div></td>
            <td className="desc">{m.text}</td><td><span className={`chip ${m.status === "SENT" ? "LOW" : m.status === "FAILED" ? "HIGH" : "MEDIUM"}`}>{m.status}</span>{m.error && <div className="mute">{m.error}</div>}</td></tr>
        ))}{!rows.length && <tr><td colSpan={6} className="mute empty">No customer messages yet.</td></tr>}</tbody>
      </table></div>}
      {pager.bar}
    </>
  );
}
