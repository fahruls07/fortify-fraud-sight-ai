"use client";
import { useEffect, useState } from "react";
import { Check, KeyRound, Pencil, Trash2, UserCog, UserPlus, X } from "lucide-react";
import { PERM_TREE, ROLE_LABEL, ROLE_PERMS, ROLES, type Access, type Perm, type Role } from "@/lib/perms";
import { usePager } from "../Pager";
import { SkelTable } from "../Skeleton";
import { PermTree } from "./PermTree";

type User = Access & { username: string; lastLogin: string | null; pending: string | null };
type Edit = { user: User | null; username: string; name: string; email: string; role: Role; password: string; perms: Perm[]; active: boolean; mode: "edit" | "password" };
const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) + " WIB" : "Never");

// Users with role presets; every create / edit / delete / password reset is a maker-checker request.
export default function UsersTab({ me, canMake }: { me: string; canMake: boolean }) {
  const [users, setUsers] = useState<User[] | null>(null);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [view, setView] = useState<"users" | "matrix">("users");
  const [msg, setMsg] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const load = () => { fetch("/api/settings/users").then((r) => r.json()).then(setUsers); };
  useEffect(load, []);
  const pager = usePager(users ?? []);

  async function post(body: unknown, ok: string) {
    setBusy(true); setErr(""); setMsg("");
    const r = await fetch("/api/settings/requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json(); setBusy(false);
    if (!r.ok) return setErr(j.error ?? "Request failed."), false;
    setMsg(`${ok} It takes effect after a checker approves it in the Approval Center.`); load(); return true;
  }
  const open = (u: User | null, mode: Edit["mode"] = "edit") => {
    setErr(""); setMsg("");
    setEdit(u ? { user: u, username: u.username, name: u.name ?? "", email: u.email ?? "", role: u.role ?? "CUSTOM", password: "", perms: u.perms, active: u.active, mode }
      : { user: null, username: "", name: "", email: "", role: "OPERATOR", password: "", perms: ROLE_PERMS.OPERATOR, active: true, mode });
  };
  const submit = async () => {
    if (!edit) return;
    const b = { type: edit.user ? "UPDATE_ACCESS" : "CREATE_USER", target: edit.username, name: edit.name, email: edit.email, role: edit.role, perms: edit.perms, active: edit.active, password: edit.password || undefined };
    if (await post(b, edit.mode === "password" ? `Password reset requested for ${edit.username}.` : `Request submitted for ${edit.username || "new user"}.`)) setEdit(null);
  };
  const remove = async (u: User) => { if (confirm(`Request deletion of ${u.name || u.username}? A checker must approve it.`)) await post({ type: "DELETE_USER", target: u.username }, `Deletion of ${u.username} requested.`); };
  const locked = (u: User) => !canMake || u.username === me || !!u.pending;

  return (
    <>
      <div className="hdr" style={{ margin: "0 0 12px" }}>
        <div className="seg">
          <button aria-pressed={view === "users"} onClick={() => setView("users")}>Users</button>
          <button aria-pressed={view === "matrix"} onClick={() => setView("matrix")}>Role permissions matrix</button>
        </div>
        {canMake && view === "users" && <button className="btn ico-btn" style={{ marginLeft: "auto" }} onClick={() => open(null)}><UserPlus size={15} /> Add user</button>}
      </div>
      {msg && <p className="ok-msg" role="status">{msg}</p>}
      {err && !edit && <p className="auth-err" role="alert">{err}</p>}

      {view === "matrix" ? (
        <div className="card tablewrap">
          <table className="matrix">
            <thead><tr><th>Permission</th>{ROLES.map((r) => <th key={r} className="c">{ROLE_LABEL[r]}</th>)}</tr></thead>
            <tbody>
              {PERM_TREE.map((g) => [
                <tr key={g.key} className="grp"><td colSpan={ROLES.length + 1}>{g.label}</td></tr>,
                ...g.children.map((c) => <tr key={c.key}><td>{c.label} <code className="mute">{c.key}</code></td>{ROLES.map((r) => <td key={r} className="c">{ROLE_PERMS[r].includes(c.key) ? <Check size={16} className="yes" aria-label="Allowed" /> : <span className="mute" aria-label="Not allowed">—</span>}</td>)}</tr>),
              ])}
            </tbody>
          </table>
          <p className="mute" style={{ padding: "0 16px 12px", margin: 0 }}>Pick <b>Custom</b> as a user&apos;s role to grant individual permissions instead of a preset.</p>
        </div>
      ) : !users ? <SkelTable cols={6} /> : <>
        <div className="card tablewrap">
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last login</th><th style={{ textAlign: "right" }}>Actions</th></tr></thead>
            <tbody>
              {pager.shown.map((u) => (
                <tr key={u.username}>
                  <td><span className="avatar sm">{(u.name || u.username)[0].toUpperCase()}</span> <b>{u.name || u.username}</b>{u.username === me && <span className="mute"> (you)</span>}<div className="mute" style={{ marginLeft: 34 }}>@{u.username}</div></td>
                  <td>{u.email || <span className="mute">—</span>}</td>
                  <td><span className={`chip role-${u.role}`}>{ROLE_LABEL[u.role ?? "CUSTOM"]}</span></td>
                  <td><span className={`chip ${u.active ? "LOW" : "HIGH"}`}>{u.active ? "Active" : "Disabled"}</span>{u.pending && <div><span className="chip MEDIUM" title="Waiting for a checker">{u.pending} pending</span></div>}</td>
                  <td className="mute">{dt(u.lastLogin)}</td>
                  <td><span style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                    <button className="ico-btn" onClick={() => open(u)}>{locked(u) ? "View" : <><Pencil size={14} /> Edit</>}</button>
                    {!locked(u) && <button className="ico-btn" title="Reset password" onClick={() => open(u, "password")}><KeyRound size={14} /></button>}
                    {!locked(u) && <button className="ico-btn danger" title="Delete user" disabled={busy} onClick={() => remove(u)}><Trash2 size={14} /></button>}
                  </span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pager.bar}
      </>}

      {edit && (() => {
        const u = edit.user, ro = !!u && locked(u);
        return (
          <div className="drawer wide" role="dialog" aria-label={u ? `User ${u.username}` : "Add user"}>
            <div className="hdr"><UserCog size={20} /><b>{edit.mode === "password" ? `Reset password · ${u!.username}` : u ? (u.name || u.username) : "Add user"}</b><button className="icon" style={{ marginLeft: "auto" }} onClick={() => setEdit(null)} aria-label="Close"><X size={18} /></button></div>
            {ro && <p className="mute">{!canMake ? "You need the Maker permission to request changes." : u!.username === me ? "You cannot change your own account." : `Locked: ${u!.pending} is waiting for a checker.`}</p>}
            <div className="rule-form">
              {edit.mode === "password" ? <>
                <p className="mute" style={{ margin: 0 }}>Sets a new password for <b>@{u!.username}</b>. Share it securely; the user should change it after first login.</p>
                <label className="field"><span>New password</span><input type="password" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} autoComplete="new-password" placeholder="At least 8 characters" /></label>
              </> : <>
                {!u && <label className="field"><span>Username</span><input value={edit.username} onChange={(e) => setEdit({ ...edit, username: e.target.value.toLowerCase() })} placeholder="3–32 chars: a-z, 0-9, . _ -" autoComplete="off" /></label>}
                <div className="wf-row">
                  <label className="field"><span>Full name</span><input value={edit.name} disabled={ro} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
                  <label className="field"><span>Email</span><input type="email" value={edit.email} disabled={ro} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></label>
                </div>
                <div className="wf-row">
                  <label className="field"><span>Role</span><select value={edit.role} disabled={ro} onChange={(e) => { const r = e.target.value as Role; setEdit({ ...edit, role: r, perms: r === "CUSTOM" ? edit.perms : ROLE_PERMS[r] }); }}>
                    {[...ROLES, "CUSTOM" as const].map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></label>
                  <label className="field"><span>Status</span><select value={String(edit.active)} disabled={ro} onChange={(e) => setEdit({ ...edit, active: e.target.value === "true" })}><option value="true">Active</option><option value="false">Disabled</option></select></label>
                </div>
                {!u && <label className="field"><span>Initial password</span><input type="password" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} autoComplete="new-password" placeholder="At least 8 characters" /></label>}
                <div className="field"><span>Permissions {edit.role !== "CUSTOM" && <span className="mute">(from the {ROLE_LABEL[edit.role]} role; choose Custom to change)</span>}</span>
                  <PermTree value={edit.perms} disabled={ro || edit.role !== "CUSTOM"} onChange={(perms) => setEdit({ ...edit, perms })} /></div>
              </>}
              {err && <p className="auth-err" role="alert" style={{ margin: 0 }}>{err}</p>}
              {!ro && <button className="btn" disabled={busy} onClick={submit}>{edit.mode === "password" ? "Request password reset" : u ? "Submit changes for approval" : "Submit new user for approval"}</button>}
            </div>
          </div>
        );
      })()}
    </>
  );
}
