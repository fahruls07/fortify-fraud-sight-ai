"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Ban, Briefcase, Calendar, CheckCircle2, Cpu, Fingerprint, Globe, Landmark, MapPin, MessageSquareReply, Search, ShieldAlert, Smartphone, User, Users, Workflow } from "lucide-react";
import type { customerList, customerProfile, deviceDetail, devices, feedback, search, sessionDetail } from "@/lib/views";
import { ago, idr } from "@/lib/format";
import { usePager } from "./Pager";
import { Skel, SkelCards, SkelTable } from "./Skeleton";
import RiskDial from "./RiskDial";
import NetworkGraph from "./NetworkGraph";
import NotesPanel from "./NotesPanel";

const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const cap = (s: string) => s[0] + s.slice(1).toLowerCase();
function useJson<T>(url: string | null) {
  const [d, setD] = useState<T | null>(null), [err, setErr] = useState("");
  useEffect(() => { if (!url) return; setD(null); fetch(url).then(async (r) => (r.ok ? setD(await r.json()) : setErr((await r.json()).error ?? "Not found"))); }, [url]);
  return { d, err };
}
const Missing = ({ err, back, label }: { err: string; back: string; label: string }) => <div className="card empty-state"><b>{err}</b><Link className="btn" href={back}>{label}</Link></div>;

// ---------------- Investigator ----------------
export function Investigator() {
  const router = useRouter(), params = useSearchParams(), [q, setQ] = useState(params.get("q") ?? ""), [res, setRes] = useState<ReturnType<typeof search> | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    const t = setTimeout(() => { if (q.trim().length >= 2) { fetch(`/api/search?q=${encodeURIComponent(q)}`).then((r) => r.json()).then(setRes); router.replace(`/investigator?q=${encodeURIComponent(q)}`); } else setRes(null); }, 250);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="hdr"><div><h1 style={{ margin: 0 }}>Investigator</h1><span className="mute">Search everything at once: customer name or ID, account number, beneficiary, phone, device, IP, session, alert, case or transaction.</span></div></div>
      <div className="inv-search"><Search size={20} /><input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Budi, ACC-BEN-7781, Samsung, 185.220., ALT-0139, CASE-0002…" aria-label="Search" /></div>
      {!res ? <p className="mute">Type at least 2 characters.</p> : !res.total ? <div className="card empty-state"><Search size={26} /><b>No results for “{res.query}”</b></div> : (
        <div className="inv-groups">{res.groups.map((g) => (
          <div key={g.kind} className="card"><div className="hdr" style={{ margin: "0 0 8px" }}><b>{g.kind}</b><span className="mute">{g.items.length}</span></div>
            <ul className="inv-list">{g.items.map((it) => <li key={it.id}><Link href={it.href}><span><b>{it.title}</b><small className="mute">{it.sub}</small></span>{it.risk && <span className={`chip ${it.risk}`}>{cap(it.risk)}</span>}</Link></li>)}</ul>
          </div>
        ))}</div>
      )}
    </>
  );
}

// ---------------- Customer Profiles ----------------
export function CustomerList() {
  const router = useRouter(), { d } = useJson<ReturnType<typeof customerList>>("/api/customers");
  const [q, setQ] = useState(""), [risk, setRisk] = useState(""), [status, setStatus] = useState("");
  const n = q.trim().toLowerCase(), rows = (d ?? []).filter((c) => (!n || `${c.name} ${c.id} ${c.accountId} ${c.city}`.toLowerCase().includes(n)) && (!risk || c.maxRisk === risk) && (!status || c.accountStatus === status))
    .sort((a, b) => b.openAlerts - a.openAlerts || b.alerts - a.alerts);
  const pager = usePager(rows);
  return (
    <>
      <div className="hdr"><div><h1 style={{ margin: 0 }}>Customer Profiles</h1><span className="mute">Every customer with their risk, alerts and latest activity. Open one for the full profile, sessions, connections and timeline.</span></div></div>
      <div className="filters">
        <input value={q} onChange={(e) => { setQ(e.target.value); pager.reset(); }} placeholder="Search name, ID, account, city…" style={{ minWidth: 260 }} aria-label="Search" />
        <select value={risk} onChange={(e) => { setRisk(e.target.value); pager.reset(); }} aria-label="Risk"><option value="">Any max risk</option>{["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((l) => <option key={l} value={l}>{cap(l)}</option>)}</select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); pager.reset(); }} aria-label="Status"><option value="">Any account status</option><option value="ACTIVE">Active</option><option value="FROZEN">Frozen</option></select>
      </div>
      {!d ? <SkelTable cols={7} /> : <div className="card tablewrap"><table>
        <thead><tr><th>Customer</th><th>Segment</th><th>Max risk</th><th>Alerts</th><th>Transactions</th><th>Last activity</th><th>Account</th></tr></thead>
        <tbody>{pager.shown.map((c) => (
          <tr key={c.id} className="clickable" onClick={() => router.push(`/customers/${c.id}`)}>
            <td><span className="avatar sm">{c.name[0]}</span> <b>{c.name}</b><div className="mute" style={{ marginLeft: 34 }}>{c.id} · {c.city}</div></td>
            <td>{c.segment}</td><td>{c.maxRisk ? <span className={`chip ${c.maxRisk}`}>{cap(c.maxRisk)}</span> : <span className="mute">—</span>}</td>
            <td>{c.alerts}{c.openAlerts > 0 && <span className="mute"> · {c.openAlerts} open</span>}{c.fraud > 0 && <div><span className="chip HIGH">{c.fraud} fraud</span></div>}</td>
            <td>{c.transactions}</td><td className="mute">{c.lastActivity ? ago(c.lastActivity) : "—"}</td>
            <td><code>{c.maskedAccount}</code>{c.accountStatus === "FROZEN" && <div><span className="chip HIGH">Frozen</span></div>}{c.blocked && <div><span className="chip HIGH"><Ban size={10} /> blocklisted</span></div>}</td>
          </tr>
        ))}</tbody>
      </table></div>}
      {pager.bar}
    </>
  );
}

type Profile = NonNullable<ReturnType<typeof customerProfile>>;
export function CustomerProfile({ id }: { id: string }) {
  const { d, err } = useJson<Profile>(`/api/customers/${id}/profile`), [tab, setTab] = useState("overview");
  if (err) return <Missing err={err} back="/customers" label="Back to customers" />;
  if (!d) return <div style={{ display: "grid", gap: 16 }}><Skel w={320} h={30} /><SkelCards n={4} /><SkelTable /></div>;
  const c = d.customer, s = d.stats;
  const TABS = [["overview", "Overview"], ["transactions", `Transactions (${s.transactions})`], ["alerts", `Alerts & cases (${s.alerts})`], ["sessions", `Sessions (${d.sessions.length})`], ["connections", "Connections"], ["timeline", "Timeline"]];
  return (
    <>
      <p className="crumbs"><Link href="/customers">Customer Profiles</Link> › <b>{c.name}</b></p>
      <div className="card ph">
        <RiskDial level={d.maxRisk} label="Max risk level" />
        <RiskDial level={d.weightedScore >= 60 ? "HIGH" : d.weightedScore >= 30 ? "MEDIUM" : "LOW"} label="Weighted risk" score={d.weightedScore} />
        <span className="avatar" style={{ width: 48, height: 48, fontSize: 20 }}>{c.name[0]}</span>
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}><h1>{c.name}</h1><code className="mute">{c.id}</code>
            {d.blocked && <span className="chip HIGH"><Ban size={11} /> Blocklisted attributes</span>}{c.accountStatus === "FROZEN" && <span className="chip HIGH">Account frozen</span>}{d.aml.matches.length > 0 && <span className="chip MEDIUM">AML match</span>}</div>
          <div className="meta"><span><Calendar size={14} /> customer since {new Date(c.customerSince).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}</span><span><Landmark size={14} /> {c.maskedAccount}</span><span><MapPin size={14} /> {c.city}, {c.homeCountry}</span><span><Smartphone size={14} /> {c.usualDevice}</span><span>{c.phone}</span><span>{c.segment} · {c.age} y</span></div>
        </div>
        <div className="gstats"><span><b>{idr(s.total)}</b><small>sent ({s.transactions} tx)</small></span><span><b>{idr(s.avg)}</b><small>avg transfer</small></span><span><b>{idr(c.avgDailySpend)}</b><small>avg daily spend</small></span><span><b className={s.open ? "MEDIUM" : ""}>{s.alerts}</b><small>alerts ({s.open} open)</small></span><span><b className={s.fraud ? "HIGH" : ""}>{s.fraud}</b><small>confirmed fraud</small></span><span><b>{s.cases}</b><small>cases</small></span></div>
      </div>
      <div className="auth-tabs" role="tablist" style={{ marginBottom: 16, flexWrap: "wrap" }}>{TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}</div>

      {tab === "overview" && <div className="ov-grid">
        <div className="card"><b>Behaviour baseline</b><dl className="kv">
          <dt>Usual device</dt><dd>{c.usualDevice}</dd><dt>Active hours</dt><dd>{c.usualActiveHours.from}–{c.usualActiveHours.to}</dd><dt>Avg daily spend</dt><dd>{idr(c.avgDailySpend)}</dd>
          <dt>Hesitation</dt><dd>{(c.sessionBaseline.hesitationTimeMs / 1000).toFixed(1)} s</dd><dt>Typing deviation</dt><dd>{c.sessionBaseline.typingCadenceDeviation}</dd><dt>Navigation</dt><dd>{c.sessionBaseline.navigationPattern}</dd>
          <dt>Known beneficiaries</dt><dd>{c.knownBeneficiaries.length}</dd><dt>Risk profile</dt><dd><span className={`chip ${c.riskProfile}`}>{cap(c.riskProfile)}</span></dd></dl></div>
        <div className="card"><b>Devices</b><ul className="inv-list" style={{ marginTop: 8 }}>{d.devices.map((x) => <li key={x.device}><Link href={`/devices/${encodeURIComponent(x.device)}`}><span><b>{x.device}</b><small className="mute">{x.sessions} sessions{x.usual ? " · usual" : " · not usual"}{x.rooted ? " · rooted" : ""}</small></span>{x.blocked && <span className="chip HIGH"><Ban size={10} /> blocked</span>}</Link></li>)}</ul></div>
        <div className="card"><b>Top beneficiaries</b><ul className="inv-list" style={{ marginTop: 8 }}>{d.beneficiaries.slice(0, 8).map((b) => <li key={b.accountId}><Link href={`/graph?account=${encodeURIComponent(b.accountId)}`}><span><b>{b.name}</b><small className="mute">{b.bank} · {b.count}× · {idr(b.amount)}{b.known ? " · known" : " · new"}</small></span>{b.blocked && <span className="chip HIGH"><Ban size={10} /> blocked</span>}</Link></li>)}</ul></div>
        <div className="card"><b>AML screening</b><p className={d.aml.matches.length ? "auth-err" : "ok-msg"} style={{ margin: "8px 0 0" }}>{d.aml.matches.length ? d.aml.reasons.join("; ") : "No sanctions / PEP / internal list match."}</p>
          {d.events.length > 0 && <><b style={{ display: "block", marginTop: 12 }}>Recent login & account events</b><ul className="inv-list">{d.events.slice(0, 5).map((e) => <li key={e.id}><span><b>{e.type === "login_attempt" ? "Login" : `Change: ${e.change}`}</b><small className="mute">{ago(e.at)} · {e.deviceId ?? "?"} · {e.ipCountry ?? ""}</small></span><span className={`chip ${e.decision === "DENY" ? "HIGH" : e.decision === "CHALLENGE" ? "MEDIUM" : "LOW"}`}>{e.decision}</span></li>)}</ul></>}</div>
      </div>}
      {tab === "transactions" && <div className="card tablewrap"><table>
        <thead><tr><th>When</th><th>Transaction</th><th className="num">Amount</th><th>Beneficiary</th><th>Status</th><th>Alert</th></tr></thead>
        <tbody>{d.transactions.map((t) => <tr key={t.id}><td className="mute">{dt(t.createdAt)}</td><td><code>{t.id}</code></td><td className="num">{idr(t.amount)}</td><td>{t.beneficiary.name}<div className="mute">{t.beneficiary.bankName} · {t.beneficiary.isNew ? "new" : "known"}</div></td><td><span className="status">{t.status}</span></td><td>{t.alertId ? <Link href={`/alerts/${t.alertId}`}>{t.alertId}</Link> : "—"}</td></tr>)}</tbody>
      </table></div>}
      {tab === "alerts" && <><div className="card tablewrap" style={{ marginBottom: 16 }}><table>
        <thead><tr><th>Alert</th><th>Risk</th><th className="num">Amount</th><th>Status</th><th>Outcome</th><th>Case</th></tr></thead>
        <tbody>{d.alerts.map((a) => <tr key={a.id}><td><Link href={`/alerts/${a.id}`}><b>{a.id}</b></Link><div className="mute">{ago(a.createdAt)}</div></td><td><span className={`chip ${a.level}`}>{cap(a.level)}</span> <span className="mute">{a.score}</span></td><td className="num">{idr(a.amount)}</td><td>{a.status}</td><td>{a.outcome ? <span className={`chip ${a.outcome === "FRAUD" ? "HIGH" : "LOW"}`}>{a.outcome === "FRAUD" ? "Fraud" : "Not fraud"}</span> : "—"}</td><td>{a.caseId ? <Link href={`/cases/${a.caseId}`}>{a.caseId}</Link> : "—"}</td></tr>)}
          {!d.alerts.length && <tr><td colSpan={6} className="mute empty">No alerts for this customer.</td></tr>}</tbody>
      </table></div>{d.cases.length > 0 && <div className="card"><b>Cases</b><ul className="inv-list">{d.cases.map((k) => <li key={k.id}><Link href={`/cases/${k.id}`}><span><b>{k.id}</b><small className="mute">{k.title}</small></span><span className="chip">{k.status}</span></Link></li>)}</ul></div>}</>}
      {tab === "sessions" && <div className="card tablewrap"><table>
        <thead><tr><th>Session</th><th>Device</th><th>IP country</th><th>Signals</th></tr></thead>
        <tbody>{d.sessions.map((x) => <tr key={x.id} className="clickable" onClick={() => location.assign(`/sessions/${x.id}`)}><td><b>{x.id}</b><div className="mute">{dt(x.startedAt)}</div></td><td>{x.device}</td><td>{x.ipCountry}{x.vpn && " · VPN"}</td><td>{x.screenSharing && <span className="chip HIGH">{x.screenSharing}</span>} {x.newDevice && <span className="chip MEDIUM">new device</span>}</td></tr>)}
          {!d.sessions.length && <tr><td colSpan={4} className="mute empty">No sessions recorded.</td></tr>}</tbody>
      </table></div>}
      {tab === "connections" && (d.beneficiaries[0] ? <><p className="mute" style={{ marginTop: 0 }}>Connections of this customer&apos;s riskiest beneficiaries. Pick one:</p>
        <ConnPicker list={d.beneficiaries.map((b) => ({ id: b.accountId, label: `${b.name} · ${idr(b.amount)}` }))} /></> : <p className="mute">No beneficiaries yet.</p>)}
      {tab === "timeline" && <div className="card"><ol className="gtimeline">{d.timeline.map((t, i) => <li key={i}><span className={`tdot ${t.risk ?? ""}`} /><div><b>{t.text}</b><div className="mute">{dt(t.at)} · {t.ref}</div></div></li>)}</ol></div>}
    </>
  );
}
function ConnPicker({ list }: { list: { id: string; label: string }[] }) {
  const [acc, setAcc] = useState(list[0].id);
  return <><select value={acc} onChange={(e) => setAcc(e.target.value)} style={{ marginBottom: 12 }} aria-label="Beneficiary">{list.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select><NetworkGraph key={acc} accountId={acc} /></>;
}

// ---------------- Device Intelligence ----------------
export function DeviceList() {
  const router = useRouter(), { d } = useJson<ReturnType<typeof devices>>("/api/devices"), [q, setQ] = useState(""), [only, setOnly] = useState("");
  const rows = (d ?? []).filter((x) => (!q || x.device.toLowerCase().includes(q.toLowerCase())) && (!only || (only === "risky" ? x.risk >= 50 : only === "shared" ? x.customers > 1 : x.blocked)));
  const pager = usePager(rows);
  return (
    <>
      <div className="hdr"><div><h1 style={{ margin: 0 }}>Device Intelligence</h1><span className="mute">Devices seen in sessions, with risk from rooting, remote-access apps, VPN, sharing across customers, alerts and blocklists.</span></div></div>
      <div className="filters"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search device…" aria-label="Search" style={{ minWidth: 240 }} />
        <select value={only} onChange={(e) => setOnly(e.target.value)} aria-label="Filter"><option value="">All devices</option><option value="risky">Risk ≥ 50</option><option value="shared">Shared by several customers</option><option value="blocked">Blocklisted</option></select></div>
      {!d ? <SkelTable cols={7} /> : <div className="card tablewrap"><table>
        <thead><tr><th>Device</th><th>Risk</th><th>Sessions</th><th>Customers</th><th>Signals</th><th>IP countries</th><th>Alerts</th><th>Last seen</th></tr></thead>
        <tbody>{pager.shown.map((x) => (
          <tr key={x.device} className="clickable" onClick={() => router.push(`/devices/${encodeURIComponent(x.device)}`)}>
            <td><Smartphone size={14} /> <b>{x.device}</b>{x.blocked && <div><span className="chip HIGH"><Ban size={10} /> blocklisted</span></div>}</td>
            <td><span className="score"><i style={{ width: `${x.risk}%`, background: x.risk >= 70 ? "var(--high)" : x.risk >= 40 ? "var(--med)" : "var(--low)" }} /></span> {x.risk}</td>
            <td>{x.sessions}</td><td>{x.customers}{x.customers > 1 && <span className="chip MEDIUM" style={{ marginLeft: 6 }}>shared</span>}</td>
            <td>{x.rooted && <span className="chip HIGH">rooted</span>} {x.screenSharing && <span className="chip HIGH">remote app</span>} {x.vpn && <span className="chip MEDIUM">VPN</span>}</td>
            <td className="mute">{x.countries.join(", ")}</td><td>{x.alerts}{x.fraud > 0 && <span className="chip HIGH" style={{ marginLeft: 6 }}>{x.fraud} fraud</span>}</td><td className="mute">{ago(x.lastSeen)}</td>
          </tr>
        ))}</tbody>
      </table></div>}
      {pager.bar}
    </>
  );
}
export function DevicePage({ id }: { id: string }) {
  const { d, err } = useJson<NonNullable<ReturnType<typeof deviceDetail>>>(`/api/devices/${encodeURIComponent(id)}`);
  if (err) return <Missing err={err} back="/devices" label="Back to devices" />;
  if (!d) return <Skel h={400} />;
  return (
    <>
      <p className="crumbs"><Link href="/devices">Device Intelligence</Link> › <b>{d.device}</b></p>
      <div className="card ph"><RiskDial level={d.risk >= 70 ? "HIGH" : d.risk >= 40 ? "MEDIUM" : "LOW"} label="Device risk" score={d.risk} /><Smartphone size={30} />
        <div style={{ display: "grid", gap: 6 }}><h1>{d.device}</h1><div className="meta"><span>{d.sessions} sessions</span><span>{d.customers} customers</span><span>{d.countries.join(", ")}</span><span>last seen {ago(d.lastSeen)}</span></div>
          <div className="filters" style={{ margin: 0 }}>{d.blocked && <span className="chip HIGH"><Ban size={11} /> Blocklisted</span>}{d.rooted && <span className="chip HIGH">Rooted</span>}{d.screenSharing && <span className="chip HIGH">Remote-access app seen</span>}{d.vpn && <span className="chip MEDIUM">VPN</span>}{d.customers > 1 && <span className="chip MEDIUM">Shared by {d.customers} customers</span>}</div></div></div>
      <div className="ov-grid">
        <div className="card"><b>Customers on this device</b><ul className="inv-list" style={{ marginTop: 8 }}>{d.customersList.map((c) => <li key={c.id}><Link href={`/customers/${c.id}`}><span><b>{c.name}</b><small className="mute">{c.id}{c.usual ? " · usual device" : " · not their usual device"}</small></span></Link></li>)}</ul></div>
        <div className="card tablewrap" style={{ gridColumn: "span 2" }}><table>
          <thead><tr><th>Session</th><th>Customer</th><th>IP</th><th>Signals</th></tr></thead>
          <tbody>{d.sessionsList.map((x) => <tr key={x.id}><td><Link href={`/sessions/${x.id}`}><b>{x.id}</b></Link><div className="mute">{dt(x.startedAt)}</div></td><td>{x.customerId}</td><td>{x.ipCountry}{x.vpn && " · VPN"}</td><td>{x.screenSharing && <span className="chip HIGH">{x.screenSharing}</span>} {x.rooted && <span className="chip HIGH">rooted</span>} {x.newDevice && <span className="chip MEDIUM">new</span>}</td></tr>)}</tbody>
        </table></div>
      </div>
    </>
  );
}

// ---------------- Connections Graph Explorer ----------------
type AccRow = { accountId: string; name: string; bank: string; transfers: number; received: number; senders: number; alerts: number; fraud: number; maxRisk: string | null; lastSeen: string; accountAgeDays: number; linkedAccounts: number; sharedDevice: number; blocked: boolean };
const VIEWS = [["all", "All accounts"], ["fraud", "Confirmed fraud"], ["blocked", "Blocklisted"], ["network", "Mule network links"], ["alerts", "With alerts"], ["shared", "Many senders"]] as const;
export function GraphExplorer() {
  const params = useSearchParams(), router = useRouter(), acc = params.get("account");
  const { d } = useJson<AccRow[]>("/api/accounts");
  const [q, setQ] = useState(""), [view, setView] = useState<(typeof VIEWS)[number][0]>("all");
  const top = useRef<HTMLDivElement>(null);
  const test = (r: AccRow) => view === "fraud" ? r.fraud > 0 : view === "blocked" ? r.blocked : view === "network" ? r.linkedAccounts > 0 : view === "alerts" ? r.alerts > 0 : view === "shared" ? r.senders > 1 : true;
  const n = q.trim().toLowerCase(), rows = (d ?? []).filter((r) => test(r) && (!n || `${r.accountId} ${r.name} ${r.bank}`.toLowerCase().includes(n)));
  const pager = usePager(rows);
  const pick = (id: string | null) => { router.replace(id ? `/graph?account=${encodeURIComponent(id)}` : "/graph", { scroll: false }); if (id) requestAnimationFrame(() => top.current?.scrollIntoView({ behavior: "smooth", block: "start" })); };
  const cnt = (k: (typeof VIEWS)[number][0]) => (d ?? []).filter((r) => (k === "fraud" ? r.fraud > 0 : k === "blocked" ? r.blocked : k === "network" ? r.linkedAccounts > 0 : k === "alerts" ? r.alerts > 0 : k === "shared" ? r.senders > 1 : true)).length;
  return (
    <>
      <div className="hdr"><div><h1 style={{ margin: 0 }}>Connections Graph Explorer</h1><span className="mute">Every beneficiary account with a connections graph, riskiest first. Click one to explore who sends it money, where it goes, and the devices, IPs and blocklisted attributes around it.</span></div></div>
      <div ref={top} style={{ scrollMarginTop: 80 }}>
        {acc && <div style={{ marginBottom: 16 }}>
          <div className="hdr" style={{ margin: "0 0 8px" }}><b>Graph: {d?.find((r) => r.accountId === acc)?.name ?? acc}</b><button className="linkish" style={{ marginLeft: "auto" }} onClick={() => pick(null)}>Close graph ×</button></div>
          <NetworkGraph key={acc} accountId={acc} />
        </div>}
      </div>
      <div className="auth-tabs" role="tablist" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        {VIEWS.map(([k, l]) => <button key={k} role="tab" aria-selected={view === k} onClick={() => { setView(k); pager.reset(); }}>{l} <span className="mute">{d ? cnt(k) : ""}</span></button>)}
      </div>
      <div className="filters"><input value={q} onChange={(e) => { setQ(e.target.value); pager.reset(); }} placeholder="Filter by account number, name or bank…" style={{ minWidth: 300 }} aria-label="Filter accounts" /></div>
      {!d ? <SkelTable cols={8} /> : <div className="card tablewrap"><table>
        <thead><tr><th>Beneficiary account</th><th>Risk</th><th className="num">Received</th><th>Senders</th><th>Transfers</th><th>Alerts</th><th>Network</th><th>Last seen</th><th /></tr></thead>
        <tbody>{pager.shown.map((r) => (
          <tr key={r.accountId} className={`clickable${acc === r.accountId ? " wf-on" : ""}`} onClick={() => pick(r.accountId)}>
            <td><b>{r.name}</b><div className="mute"><code>{r.accountId}</code> · {r.bank}{r.accountAgeDays < 30 ? ` · ${r.accountAgeDays} d old` : ""}</div></td>
            <td>{r.blocked && <span className="chip HIGH"><Ban size={10} /> blocklisted</span>} {r.fraud > 0 && <span className="chip HIGH">{r.fraud} fraud</span>} {r.maxRisk && <span className={`chip ${r.maxRisk}`}>{cap(r.maxRisk)}</span>}{!r.blocked && !r.fraud && !r.maxRisk && <span className="mute">—</span>}</td>
            <td className="num">{idr(r.received)}</td><td>{r.senders}</td><td>{r.transfers}</td><td>{r.alerts || <span className="mute">0</span>}</td>
            <td>{r.linkedAccounts ? <span title="Linked accounts / sharing a device">{r.linkedAccounts} linked{r.sharedDevice ? ` · ${r.sharedDevice} shared device` : ""}</span> : <span className="mute">—</span>}</td>
            <td className="mute">{ago(r.lastSeen)}</td>
            <td><button className="ico-btn" onClick={(e) => { e.stopPropagation(); pick(r.accountId); }}><Users size={14} /> Graph</button></td>
          </tr>
        ))}{!rows.length && <tr><td colSpan={9} className="mute empty">No accounts in this view.</td></tr>}</tbody>
      </table></div>}
      {pager.bar}
    </>
  );
}

// ---------------- Session view ----------------
type Sess = NonNullable<ReturnType<typeof sessionDetail>>;
const SECTIONS = [["alerts", "Alerts"], ["customer", "Customer details"], ["rules", "Fired rules"], ["reasons", "Risk reason codes"], ["sanctions", "Sanctions, PEP & adverse"], ["location", "IP & location"], ["device", "Device risk signals"], ["biometrics", "Behavior biometrics"], ["feedback", "Feedback"], ["comments", "Comments"]] as const;
const Sig = ({ rows }: { rows: { signal: string; value: string; risky: boolean; note?: string; baseline?: string; deviation?: number | null }[] }) => (
  <div className="sig-grid">{rows.map((r) => (
    <div key={r.signal} className={`sig${r.risky ? " risky" : ""}`}><span>{r.signal}</span><b>{r.value}</b>
      {(r.baseline !== undefined || r.note) && <small className="mute">{r.baseline !== undefined ? `baseline ${r.baseline}` : r.note}{typeof r.deviation === "number" && r.deviation !== 0 ? ` · ${r.deviation > 0 ? "+" : ""}${r.deviation}%` : ""}</small>}</div>
  ))}</div>
);
export function SessionView({ id, canComment }: { id: string; canComment: boolean }) {
  const { d, err } = useJson<Sess>(`/api/sessions/${id}/detail`), [active, setActive] = useState("alerts");
  useEffect(() => {
    const els = SECTIONS.map(([k]) => document.getElementById(`sec-${k}`)).filter((x): x is HTMLElement => !!x);
    const ob = new IntersectionObserver((es) => { const v = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]; if (v) setActive(v.target.id.slice(4)); }, { rootMargin: "-80px 0px -60% 0px" });
    els.forEach((e) => ob.observe(e)); return () => ob.disconnect();
  }, [d]);
  if (err) return <Missing err={err} back="/customers" label="Back to customers" />;
  if (!d) return <Skel h={500} />;
  const x = d.session, c = d.customer;
  return (
    <>
      <p className="crumbs"><Link href="/customers">Customer Profiles</Link> › <Link href={`/customers/${c.id}`}>{c.name}</Link> › <b>Session {x.id}</b></p>
      <div className="card ph"><RiskDial level={d.risk} /><Fingerprint size={30} />
        <div style={{ display: "grid", gap: 6 }}><div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}><h1>{c.name}&apos;s session</h1><code className="mute">{x.id}</code></div>
          <div className="meta"><span><User size={14} /> <Link href={`/customers/${c.id}`}>{c.name}</Link></span><span><Smartphone size={14} /> <Link href={`/devices/${encodeURIComponent(x.deviceModel)}`}>{x.deviceModel}</Link></span><span><Workflow size={14} /> {d.flow}</span><span><Calendar size={14} /> {dt(x.startedAt)}</span><span><Globe size={14} /> {x.ipCountry}{x.isVpnDetected ? " (VPN)" : ""}</span><span><Cpu size={14} /> {d.channel}</span></div></div></div>
      <div className="sess">
        <nav className="card sess-nav" aria-label="Sections"><div className="mute" style={{ padding: "0 10px 6px", fontSize: 11 }}>SECTIONS</div>
          {SECTIONS.map(([k, l]) => <a key={k} href={`#sec-${k}`} className={active === k ? "on" : ""} onClick={() => setActive(k)}>{l}</a>)}</nav>
        <div className="sess-body">
          <section id="sec-alerts" className="card"><h3>Alerts</h3>{d.alerts.length ? <ul className="inv-list">{d.alerts.map((a) => <li key={a.id}><Link href={`/alerts/${a.id}`}><span><b>{a.id}</b><small className="mute">score {a.score} · {a.status}</small></span><span className={`chip ${a.level}`}>{cap(a.level)}</span>{a.outcome && <span className={`chip ${a.outcome === "FRAUD" ? "HIGH" : "LOW"}`}>{a.outcome === "FRAUD" ? "fraud" : "not fraud"}</span>}</Link></li>)}</ul> : <p className="mute">No alert raised in this session.</p>}
            {d.transactions.length > 0 && <><h4>Transactions in this session</h4><ul className="inv-list">{d.transactions.map((t) => <li key={t.id}><span><b>{idr(t.amount)}</b> → {t.beneficiary}<small className="mute">{t.id} · {t.status}</small></span></li>)}</ul></>}</section>
          <section id="sec-customer" className="card"><h3>Customer details</h3><dl className="kv"><dt>Name</dt><dd><Link href={`/customers/${c.id}`}>{c.name}</Link></dd><dt>Account</dt><dd>{c.maskedAccount}</dd><dt>Segment</dt><dd>{c.segment}</dd><dt>City</dt><dd>{c.city}</dd><dt>Usual device</dt><dd>{c.usualDevice}</dd><dt>Risk profile</dt><dd><span className={`chip ${c.riskProfile}`}>{cap(c.riskProfile)}</span></dd></dl></section>
          <section id="sec-rules" className="card"><h3>Fired rules</h3>{d.firedRules.length ? <ul className="inv-list">{d.firedRules.map((r, i) => <li key={i}><Link href={`/rules/${r.ruleId}`}><span><b>{r.name}</b><small className="mute"><code>{r.expression}</code> · {r.status} · on {r.transactionId}</small></span><span className={`chip ${r.severity}`}>{r.action}</span></Link></li>)}</ul> : <p className="mute">No rule matched this session&apos;s transactions.</p>}</section>
          <section id="sec-reasons" className="card"><h3>Risk reason codes</h3>{d.reasonCodes.length ? <div className="cp-reasons">{d.reasonCodes.map((r, i) => <div key={i} className={`cp-reason ${r.severity}`}><div className="hdr" style={{ margin: 0 }}><span className={`chip ${r.severity}`}>{r.severity}</span><b>{r.code}</b></div><code className="cp-evidence">{r.evidence}</code><span className="cp-expl">{r.explanation}</span></div>)}</div> : <p className="mute">No AI Assistant investigation for this session yet. Run it from the alert.</p>}</section>
          <section id="sec-sanctions" className="card"><h3>Sanctions, PEP & adverse</h3><p className={d.sanctions.matches.length ? "auth-err" : "ok-msg"} style={{ margin: 0 }}>{d.sanctions.reasons.length ? d.sanctions.reasons.join("; ") : "No sanctions, PEP or internal-list match for the customer or beneficiaries."}</p></section>
          <section id="sec-location" className="card"><h3>IP and location details</h3><Sig rows={d.location} /></section>
          <section id="sec-device" className="card"><h3>Device risk signals</h3><Sig rows={d.device} /></section>
          <section id="sec-biometrics" className="card"><h3>Behavior biometrics</h3><p className="mute" style={{ marginTop: 0 }}>This session compared with the customer&apos;s own baseline. Red = unusual for this customer.</p><Sig rows={d.biometrics.map((b) => ({ ...b, deviation: b.deviation }))} /></section>
          <section id="sec-feedback" className="card"><h3>Feedback</h3>{d.feedback.length ? <ul className="inv-list">{d.feedback.map((f) => <li key={f.alertId}><span><b>{f.label === "FRAUD" ? "Fraud" : "Not fraud"}</b> · {f.action.replaceAll("_", " ").toLowerCase()}<small className="mute">{f.by} · {dt(f.at)}{f.reason ? ` · “${f.reason}”` : ""}{f.followedAi ? " · followed AI" : ""}</small></span></li>)}</ul> : <p className="mute">No analyst feedback yet.</p>}</section>
          <section id="sec-comments"><h3 style={{ margin: "4px 0 10px" }}>Comments</h3><NotesPanel entity={`session:${x.id}`} canEdit={canComment} /></section>
        </div>
      </div>
    </>
  );
}

// ---------------- Feedback ----------------
export function FeedbackPage() {
  const { d } = useJson<ReturnType<typeof feedback>>("/api/feedback"), [label, setLabel] = useState(""), [who, setWho] = useState("");
  const rows = (d?.rows ?? []).filter((r) => (!label || r.label === label) && (!who || (who === "analyst" ? !r.by.includes(":") : r.by.startsWith(who))));
  const pager = usePager(rows), m = d?.summary, pct = (v: number | null | undefined) => (v == null ? "—" : `${(v * 100).toFixed(0)}%`);
  return (
    <>
      <div className="hdr"><div><h1 style={{ margin: 0 }}>Feedback</h1><span className="mute">Every fraud / not-fraud label from analysts, customers (OTP) and automation. It drives rule performance, tuning suggestions and AI agreement.</span></div></div>
      {!m ? <SkelCards n={4} /> : <div className="kpis">
        <div className="card kpi"><span className="ico"><MessageSquareReply size={18} /></span><span className="mute">Labels</span><b>{m.total}</b><span className="mute">{m.fraud} fraud · {m.notFraud} not fraud</span></div>
        <div className="card kpi"><span className="ico teal"><CheckCircle2 size={18} /></span><span className="mute">AI agreement</span><b>{pct(m.aiAgreement)}</b><span className="mute">decisions that followed the Assistant</span></div>
        <div className="card kpi"><span className="ico" style={{ color: "var(--med)", background: "color-mix(in srgb, var(--med) 12%, transparent)" }}><ShieldAlert size={18} /></span><span className="mute">Baseline false positives</span><b>{pct(m.baselineFalsePositive)}</b><span className="mute">of High baseline alerts</span></div>
        <div className="card kpi"><span className="ico bt"><Briefcase size={18} /></span><span className="mute">Customer / automatic</span><b>{m.customerConfirmed} / {m.autoResolved}</b><span className="mute">OTP-confirmed / auto-resolved</span></div>
      </div>}
      <div className="filters"><select value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Label"><option value="">All labels</option><option value="FRAUD">Fraud</option><option value="NOT_FRAUD">Not fraud</option></select>
        <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Source"><option value="">All sources</option><option value="analyst">Analysts</option><option value="customer:">Customer (OTP)</option><option value="system:">Automation</option></select></div>
      {!d ? <SkelTable cols={7} /> : <div className="card tablewrap"><table>
        <thead><tr><th>When</th><th>Alert</th><th>Customer</th><th className="num">Amount</th><th>Label</th><th>Decision</th><th>AI</th><th>By</th><th>Reason</th></tr></thead>
        <tbody>{pager.shown.map((r) => <tr key={r.alertId}><td className="mute">{dt(r.at)}</td><td><Link href={`/alerts/${r.alertId}`}>{r.alertId}</Link></td><td>{r.customer}</td><td className="num">{idr(r.amount)}</td>
          <td><span className={`chip ${r.label === "FRAUD" ? "HIGH" : "LOW"}`}>{r.label === "FRAUD" ? "Fraud" : "Not fraud"}</span></td><td>{r.action.replaceAll("_", " ").toLowerCase()}</td>
          <td>{r.aiRecommendation ? <span className={r.followedAi ? "LOW" : "MEDIUM"}>{r.followedAi ? "followed" : `overrode ${r.aiRecommendation.toLowerCase()}`}</span> : <span className="mute">—</span>}</td><td>{r.by}</td><td className="desc">{r.reason ?? "—"}</td></tr>)}
          {!rows.length && <tr><td colSpan={9} className="mute empty">No feedback yet. Decide alerts to create labels.</td></tr>}</tbody>
      </table></div>}
      {pager.bar}
    </>
  );
}
