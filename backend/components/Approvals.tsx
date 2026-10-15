"use client";
import { useEffect, useState } from "react";
import { Check, ShieldCheck, X } from "lucide-react";
import { LABEL, ROLE_LABEL, type AccessRequest } from "@/lib/perms";
import { usePager } from "./Pager";
import { SkelTable } from "./Skeleton";

const dt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Jakarta" }) + " WIB" : "—");
const STATUS = ["PENDING", "APPROVED", "REJECTED"] as const;

const TYPE_LABEL = { CREATE_USER: "Create user", UPDATE_ACCESS: "Edit user", DELETE_USER: "Delete user" } as const;

function diff(r: AccessRequest) {
  if (r.type === "DELETE_USER") return <ul className="diff"><li className="del">Delete account and all its access ({r.before?.perms.length ?? 0} permissions)</li></ul>;
  const before = r.before ?? { perms: [], active: false }, after = r.after!;
  const add = after.perms.filter((p) => !before.perms.includes(p)), del = before.perms.filter((p) => !after.perms.includes(p));
  return (
    <ul className="diff">
      {r.type === "CREATE_USER" && <li className="add">New account{after.active ? "" : " (disabled)"} with initial password</li>}
      {r.type === "UPDATE_ACCESS" && before.active !== after.active && <li className={after.active ? "add" : "del"}>{after.active ? "Enable account" : "Disable account"}</li>}
      {r.passwordReset && <li className="del">Reset password</li>}
      {after.name && after.name !== r.before?.name && <li className="add">Name: {after.name}</li>}
      {after.email && after.email !== r.before?.email && <li className="add">Email: {after.email}</li>}
      {after.role && after.role !== r.before?.role && <li className="add">Role: {ROLE_LABEL[after.role]}</li>}
      {add.map((p) => <li key={p} className="add">+ {LABEL[p]}</li>)}
      {del.map((p) => <li key={p} className="del">− {LABEL[p]}</li>)}
    </ul>
  );
}

// Maker-checker queue: every user/access change waits here until a second person approves it.
export default function Approvals({ me, canCheck }: { me: string; canCheck: boolean }) {
  const [reqs, setReqs] = useState<AccessRequest[] | null>(null);
  const [status, setStatus] = useState<string>("PENDING");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const load = () => { fetch("/api/settings/requests").then((r) => r.json()).then(setReqs); };
  useEffect(load, []);
  const all = reqs ?? [];
  const reqPager = usePager(status ? all.filter((r) => r.status === status) : all);
  const count = (s: string) => all.filter((r) => r.status === s).length;

  async function decide(r: AccessRequest, d: "approve" | "reject") {
    setBusy(true); setErr(""); setMsg("");
    const res = await fetch(`/api/settings/requests/${r.id}/${d}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note: notes[r.id] ?? "" }) });
    const j = await res.json(); setBusy(false);
    if (!res.ok) return setErr(j.error ?? "Request failed.");
    setMsg(`${r.id} ${d === "approve" ? "approved and applied" : "rejected"}.`); load();
  }

  return (
    <>
      <div className="hdr"><div><h1 style={{ margin: 0 }}>Approval Center</h1><span className="mute">Maker-checker queue. Changes to users and access take effect only after a second person approves them.</span></div></div>
      <div className="auth-tabs" role="tablist" style={{ marginBottom: 16 }}>
        {STATUS.map((s) => <button key={s} role="tab" aria-selected={status === s} onClick={() => { setStatus(s); reqPager.reset(); }}>{s[0] + s.slice(1).toLowerCase()} {count(s) > 0 && <span className={s === "PENDING" ? "badge" : "mute"}>{count(s)}</span>}</button>)}
        <button role="tab" aria-selected={!status} onClick={() => { setStatus(""); reqPager.reset(); }}>All</button>
      </div>
      {msg && <p className="ok-msg" role="status">{msg}</p>}
      {err && <p className="auth-err" role="alert">{err}</p>}
      {!reqs ? <SkelTable cols={5} /> : <>
        {!reqPager.shown.length && <div className="card empty-state"><ShieldCheck size={28} /><b>No access requests yet</b><span className="mute">A maker submits changes from Settings; a checker approves them here.</span></div>}
        <div className="reqs">
          {reqPager.shown.map((r) => {
            const self = r.maker === me || r.target === me;
            return (
              <div key={r.id} className="card req">
                <div className="hdr" style={{ margin: 0 }}>
                  <b>{r.id}</b><span className="chip">{TYPE_LABEL[r.type]}</span><span><b>{r.target}</b></span>
                  <span className={`chip ${r.status === "APPROVED" ? "LOW" : r.status === "REJECTED" ? "HIGH" : "MEDIUM"}`} style={{ marginLeft: "auto" }}>{r.status}</span>
                </div>
                <div className="mute">Maker <b>{r.maker}</b> · {dt(r.createdAt)}{r.checker && <> · Checker <b>{r.checker}</b> · {dt(r.decidedAt)}</>}</div>
                {diff(r)}
                {r.note && <p className="mute" style={{ margin: 0 }}>Note: {r.note}</p>}
                {r.status === "PENDING" && canCheck && (
                  <div className="filters" style={{ margin: 0 }}>
                    <input style={{ flex: 1 }} placeholder="Note for the maker (optional)" value={notes[r.id] ?? ""} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
                    <button className="btn ico-btn" disabled={busy || self} title={self ? "Maker and checker must be different users, and you cannot approve your own access" : ""} onClick={() => decide(r, "approve")}><Check size={16} /> Approve</button>
                    <button className="ico-btn" disabled={busy || self} onClick={() => decide(r, "reject")}><X size={16} /> Reject</button>
                  </div>
                )}
                {r.status === "PENDING" && !canCheck && <span className="mute">Waiting for a checker.</span>}
              </div>
            );
          })}
        </div>
        {reqPager.bar}
      </>}
    </>
  );
}
