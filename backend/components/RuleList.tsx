"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Download, Pencil, Trash2, Upload, X } from "lucide-react";
import { FIELDS, validateRule, type Rule } from "@/lib/rules/dsl";
import type { PackItem } from "@/lib/rules/pack";
import { usePager } from "./Pager";
import CopilotChat from "./CopilotChat";
import { SkelTable } from "./Skeleton";

type Msg = { ok?: string; error?: string; details?: string[] } | null;
type Perf = { ruleId: string; name: string; status: string; hits: number; total: number; hitRate: number; decided: number; fraud: number; falsePositives: number; precision: number | null; recall: number | null;
  suggestions: { kind: string; text: string; condition?: object; expression?: string }[] };

// UI vocabulary over the stored rule model.
export const ACTION_LABEL = { DECLINE: "Block", HOLD: "Review", CHALLENGE: "Flag", ALLOW: "Allow" } as const;
const ACTION_HINT = { DECLINE: "Block the transaction", HOLD: "Hold for analyst review", CHALLENGE: "Flag: ask the customer to verify", ALLOW: "Allow (exception rule)" };
const cap = (s: string) => s[0] + s.slice(1).toLowerCase();
const dt = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
type Form = { id?: string; name: string; description: string; severity: string; action: string; condition: string };
const BLANK: Form = { name: "", description: "", severity: "MEDIUM", action: "HOLD", condition: JSON.stringify({ all: [{ field: "amount", op: ">", value: 10000000 }] }, null, 2) };

export default function RuleList({ canManage, canActivate }: { canManage: boolean; canActivate: boolean }) {
  const [form, setForm] = useState<Form | null>(null), [formErr, setFormErr] = useState("");
  const [priority, setPriority] = useState("");
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [msg, setMsg] = useState<Msg>(null), [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pkg, setPkg] = useState<{ file: File; items: PackItem[]; sel: Set<string> } | null>(null); // import preview
  const file = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState(""), [status, setStatus] = useState("");
  const [perf, setPerf] = useState<Record<string, Perf>>({}), [perfOpen, setPerfOpen] = useState<string | null>(null);
  const loadPerf = () => fetch("/api/rules/performance").then((r) => r.json()).then((l: Perf[]) => Array.isArray(l) && setPerf(Object.fromEntries(l.map((p) => [p.ruleId, p]))));
  useEffect(() => { loadPerf(); }, []);
  const load = () => fetch("/api/rules").then((r) => r.json()).then((l: Rule[]) => { setRules(l); setPicked((p) => new Set([...p].filter((id) => l.some((r) => r.id === id)))); });
  useEffect(() => { load(); }, []);

  const needle = q.trim().toLowerCase();
  const shown = (rules ?? []).filter((r) => (!status || r.status === status) && (!priority || r.severity === priority) && (!needle || [r.id, r.name, r.description, r.expression].some((v) => v.toLowerCase().includes(needle))));
  const pager = usePager(shown);
  const filt = (set: (v: string) => void) => (e: { target: { value: string } }) => { set(e.target.value); pager.reset(); };
  const toggle = (set: Set<string>, ids: string[], on: boolean) => { const n = new Set(set); ids.forEach((id) => (on ? n.add(id) : n.delete(id))); return n; };
  const pageIds = pager.shown.map((r) => r.id), allOnPage = pageIds.length > 0 && pageIds.every((id) => picked.has(id));
  const sel = [...picked];

  async function preview(f: File) {
    setBusy(true); setMsg(null);
    const body = new FormData(); body.append("file", f);
    const r = await fetch("/api/rules/import", { method: "POST", body }), j = await r.json();
    setBusy(false); if (file.current) file.current.value = "";
    if (!r.ok) return setMsg({ error: j.error, details: j.details });
    setPkg({ file: f, items: j.items, sel: new Set(j.items.filter((i: PackItem) => i.rule).map((i: PackItem) => i.file)) });
  }
  async function doImport() {
    if (!pkg) return;
    setBusy(true); setMsg(null);
    const body = new FormData(); body.append("file", pkg.file); body.append("files", JSON.stringify([...pkg.sel]));
    const r = await fetch("/api/rules/import", { method: "POST", body }), j = await r.json();
    setBusy(false);
    if (!r.ok) return setMsg({ error: j.error, details: j.details });
    setPkg(null); setMsg({ ok: `Imported ${j.imported.length} rule(s) as Draft: ${j.imported.join(", ")}.` }); load();
  }
  async function bulkDelete() {
    const active = (rules ?? []).filter((r) => picked.has(r.id) && r.status === "Active").map((r) => r.id), del = sel.filter((id) => !active.includes(id));
    if (!del.length) return setMsg({ error: "Only Draft rules can be deleted. Deactivate the selected rules first.", details: active });
    if (!confirm(`Delete ${del.length} rule(s)? This cannot be undone.${active.length ? `\n${active.length} active rule(s) will be skipped.` : ""}`)) return;
    setBusy(true); setMsg(null);
    const res = await Promise.all(del.map((id) => fetch(`/api/rules/${id}`, { method: "DELETE" }).then(async (r) => (r.ok ? null : `${id}: ${(await r.json()).error}`))));
    setBusy(false);
    const failed = [...res.filter((x): x is string => !!x), ...active.map((id) => `${id}: active rule skipped`)];
    setMsg(failed.length ? { error: `Deleted ${del.length - res.filter(Boolean).length} rule(s). Some were not deleted:`, details: failed } : { ok: `Deleted ${del.length} rule(s).` });
    load();
  }

  // Live client-side check with the same validator the server uses on save.
  const parsed = (() => { if (!form) return null; try { return { json: JSON.parse(form.condition) }; } catch (e) { return { err: `Condition is not valid JSON: ${(e as Error).message}` }; } })();
  const check = form && parsed && "json" in parsed ? validateRule({ ...form, condition: parsed.json }) : null;
  const formError = parsed && "err" in parsed ? parsed.err : check && "error" in check ? check.error : "";
  const edit = (r: Rule) => { setForm({ id: r.id, name: r.name, description: r.description, severity: r.severity, action: r.action, condition: JSON.stringify(r.condition, null, 2) }); setFormErr(""); };
  async function saveForm() {
    if (!form || !check || !("rule" in check)) return;
    setBusy(true); setFormErr("");
    const r = await fetch(form.id ? `/api/rules/${form.id}` : "/api/rules", { method: form.id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(check.rule) });
    const j = await r.json(); setBusy(false);
    if (!r.ok) return setFormErr(j.error);
    setForm(null); setMsg({ ok: form.id ? `${j.id} updated${rules?.find((x) => x.id === j.id)?.status === "Active" ? " and moved to Inactive; activate it again when ready" : ""}.` : `${j.id} created as Inactive.` }); load();
  }
  async function toggle1(r: Rule) {
    setBusy(true); setMsg(null);
    const res = await fetch(`/api/rules/${r.id}/${r.status === "Active" ? "deactivate" : "activate"}`, { method: "POST" }), j = await res.json();
    setBusy(false);
    setMsg(res.ok ? { ok: `${r.id} is now ${r.status === "Active" ? "Inactive" : "Active"}.` } : { error: j.error }); load();
  }
  async function delete1(r: Rule) {
    if (!confirm(`Delete rule "${r.name}" (${r.id})? This cannot be undone.`)) return;
    setBusy(true);
    const res = await fetch(`/api/rules/${r.id}`, { method: "DELETE" }), j = await res.json();
    setBusy(false); setMsg(res.ok ? { ok: `${r.id} deleted.` } : { error: j.error }); load();
  }

  return (
    <>
      <div className="hdr">
        <div><h1 style={{ margin: 0 }}>Rule Builder</h1><span className="mute">Fraud detection rules. Create, edit and switch rules on or off; workflows can call them. Tick rules to export or delete; import from a .zip package.</span></div>
        {canManage && <span style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input ref={file} type="file" accept=".zip,application/zip" hidden onChange={(e) => e.target.files?.[0] && preview(e.target.files[0])} />
          <button className="ico-btn" disabled={busy} onClick={() => file.current?.click()}><Upload size={16} /> Import</button>
          <button className="btn" onClick={() => { setForm(BLANK); setFormErr(""); }}>+ Create rule</button>
        </span>}
      </div>
      {msg?.ok && <p className="ok-msg" role="status">{msg.ok}</p>}
      {msg?.error && <div className="auth-err" role="alert" style={{ marginBottom: 12 }}><b>{msg.error}</b>{msg.details && <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{msg.details.map((d) => <li key={d}>{d}</li>)}</ul>}</div>}

      <div className="filters">
        <input value={q} onChange={filt(setQ)} placeholder="Search name, description, condition…" aria-label="Search rules" style={{ minWidth: 260 }} />
        <select value={priority} onChange={filt(setPriority)} aria-label="Priority filter"><option value="">All priorities</option>{["HIGH", "MEDIUM", "LOW", "CRITICAL"].map((p) => <option key={p} value={p}>{cap(p)}</option>)}</select>
        <select value={status} onChange={filt(setStatus)} aria-label="Status filter"><option value="">All statuses</option><option value="Active">Active</option><option value="Draft">Inactive</option></select>
      </div>
      <div className={`card selbar${sel.length ? " on" : ""}`}>
        <b>{sel.length ? `${sel.length} selected` : "Select rules to export or delete"}</b>
        {sel.length > 0 && <button className="linkish" onClick={() => setPicked(new Set())}>Clear</button>}
        {shown.length > 0 && <button className="linkish" onClick={() => setPicked(toggle(picked, shown.map((r) => r.id), true))}>Select all {shown.length}</button>}
        <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {sel.length ? <a className="ico-btn button" href={`/api/rules/export?ids=${sel.join(",")}`} download><Download size={16} /> Export selected</a>
            : <button className="ico-btn" disabled><Download size={16} /> Export selected</button>}
          {canManage && <button className="ico-btn danger" disabled={busy || !sel.length} onClick={bulkDelete}><Trash2 size={16} /> Delete selected</button>}
        </span>
      </div>

      {!rules ? <SkelTable cols={9} /> : <div className="card tablewrap">
        <table>
          <thead><tr>
            <th style={{ width: 40 }}><input type="checkbox" checked={allOnPage} onChange={(e) => setPicked(toggle(picked, pageIds, e.target.checked))} aria-label="Select all rules on this page" /></th>
            <th>Rule name</th><th>Description</th><th>Priority</th><th>Action</th><th>Status</th><th title="Matches in the last 30 days / precision on analyst decisions">Performance</th><th>Last modified</th><th style={{ textAlign: "right" }}>Actions</th>
          </tr></thead>
          <tbody>
            {pager.shown.map((r) => (
              <tr key={r.id} className={picked.has(r.id) ? "wf-on" : ""}>
                <td><input type="checkbox" checked={picked.has(r.id)} onChange={(e) => setPicked(toggle(picked, [r.id], e.target.checked))} aria-label={`Select ${r.id}`} /></td>
                <td><b>{r.name}</b><div className="mute wf-cell"><code title={r.expression}>{r.id} · {r.expression}</code></div></td>
                <td className="desc">{r.description}</td>
                <td><span className={`chip ${r.severity}`}>{cap(r.severity)}</span></td>
                <td>{ACTION_LABEL[r.action]}</td>
                <td>{(() => { const p = perf[r.id]; if (!p) return <span className="mute">—</span>; return (
                  <button className="perf-cell" onClick={() => setPerfOpen(r.id)} title="Open performance and tuning">
                    <b>{p.hits}</b> hits · {p.precision === null ? <span className="mute">no feedback</span> : <span className={p.precision < 0.5 ? "HIGH" : p.precision < 0.8 ? "MEDIUM" : "LOW"}>{Math.round(p.precision * 100)}% precise</span>}
                    {p.suggestions.length > 0 && <span className="chip MEDIUM">{p.suggestions.length} tip{p.suggestions.length > 1 ? "s" : ""}</span>}
                  </button>); })()}</td>
                <td>
                  {canActivate
                    ? <button className={`switch${r.status === "Active" ? " on" : ""}`} role="switch" aria-checked={r.status === "Active"} disabled={busy} onClick={() => toggle1(r)} title="Toggle status"><i />{r.status === "Active" ? "Active" : "Inactive"}</button>
                    : <span className={`status ${r.status === "Active" ? "Decided" : "Investigating"}`}>{r.status === "Active" ? "Active" : "Inactive"}</span>}
                </td>
                <td>{dt(r.updatedAt ?? r.createdAt)}<div className="mute">{r.updatedBy ?? r.createdBy}</div></td>
                <td><span style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  {canManage ? <button className="ico-btn" onClick={() => edit(r)}><Pencil size={14} /> Edit</button> : <button onClick={() => edit(r)}>View</button>}
                  {canManage && <button className="ico-btn danger" disabled={busy || r.status === "Active"} title={r.status === "Active" ? "Deactivate before deleting" : "Delete"} onClick={() => delete1(r)}><Trash2 size={14} /></button>}
                </span></td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={9} className="mute empty">No rules found.</td></tr>}
          </tbody>
        </table>
      </div>}
      {pager.bar}

      {form && (
        <div className="drawer wide" role="dialog" aria-label={form.id ? `Edit ${form.id}` : "Create rule"}>
          <div className="hdr"><b style={{ fontSize: 16 }}>{form.id ? `Edit rule ${form.id}` : "Create rule"}</b><button className="icon" style={{ marginLeft: "auto" }} onClick={() => setForm(null)} aria-label="Close"><X size={18} /></button></div>
          <div className="rule-form">
            {canManage && <div className="cp-dock"><CopilotChat kind="rule"
              getCurrent={() => { try { return { name: form.name, description: form.description, severity: form.severity, action: form.action, condition: JSON.parse(form.condition) }; } catch { return { name: form.name, description: form.description, severity: form.severity, action: form.action }; } }}
              onApply={(p) => { const r = p as { name?: string; description?: string; severity?: string; action?: string; condition?: unknown } | null; if (r) setForm((f) => f && ({ ...f, name: r.name ?? f.name, description: r.description ?? f.description, severity: r.severity ?? f.severity, action: r.action ?? f.action, condition: r.condition ? JSON.stringify(r.condition, null, 2) : f.condition })); }}
              summary={(p) => `${p.name} · ${String(p.expression ?? "")} → ${ACTION_LABEL[p.action as keyof typeof ACTION_LABEL] ?? p.action}`} /></div>}
            <label className="field"><span>Name</span><input value={form.name} disabled={!canManage} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Large transfer to new account" /></label>
            <label className="field"><span>Description</span><textarea rows={2} value={form.description} disabled={!canManage} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What this rule catches and why" /></label>
            <div className="wf-row">
              <label className="field"><span>Priority</span><select value={form.severity} disabled={!canManage} onChange={(e) => setForm({ ...form, severity: e.target.value })}>{["HIGH", "MEDIUM", "LOW", ...(form.severity === "CRITICAL" ? ["CRITICAL"] : [])].map((p) => <option key={p} value={p}>{cap(p)}</option>)}</select></label>
              <label className="field"><span>Action</span><select value={form.action} disabled={!canManage} onChange={(e) => setForm({ ...form, action: e.target.value })}>{(["DECLINE", "HOLD", "CHALLENGE", ...(form.action === "ALLOW" ? ["ALLOW"] : [])] as (keyof typeof ACTION_LABEL)[]).map((a) => <option key={a} value={a}>{ACTION_LABEL[a]} — {ACTION_HINT[a]}</option>)}</select></label>
            </div>
            <label className="field"><span>Condition (JSON) <button type="button" className="linkish" style={{ float: "right" }} disabled={!parsed || "err" in parsed} onClick={() => parsed && "json" in parsed && setForm({ ...form, condition: JSON.stringify(parsed.json, null, 2) })}>Format</button></span>
              <textarea className={`json-editor${formError && !formError.startsWith("name") ? " bad" : ""}`} rows={10} spellCheck={false} value={form.condition} disabled={!canManage} onChange={(e) => setForm({ ...form, condition: e.target.value })} />
            </label>
            {check && "rule" in check ? <p className="ok-msg" style={{ margin: 0 }}>Valid · <code>{check.rule.expression}</code></p> : formError && <p className="auth-err" style={{ margin: 0 }}>{formError}</p>}
            <details className="mute"><summary>Condition reference</summary>
              <p style={{ margin: "6px 0" }}>Use <code>{"{ \"all\": [...] }"}</code> (every check must match) or <code>{"{ \"any\": [...] }"}</code> (one is enough). Each check: <code>{"{ \"field\", \"op\", \"value\" }"}</code>. Operators: <code>&gt; &gt;= &lt; &lt;= == != in isNotNull</code>.</p>
              <ul style={{ margin: 0, paddingLeft: 18 }}>{Object.entries(FIELDS).map(([f, t]) => <li key={f}><code>{f}</code> · {t.replace("?", " (nullable)")}</li>)}</ul>
            </details>
            {formErr && <p className="auth-err" role="alert" style={{ margin: 0 }}>{formErr}</p>}
            {canManage && <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" style={{ flex: 1 }} disabled={busy || !check || !("rule" in check)} onClick={saveForm}>{form.id ? "Save changes" : "Create rule"}</button>
              <button onClick={() => setForm(null)}>Cancel</button>
            </div>}
            {form.id && <Link href={`/rules/${form.id}`} className="mute">Open in visual editor (AI assist, backtest) →</Link>}
            {form.id && rules?.find((r) => r.id === form.id)?.status === "Active" && <small className="mute">Saving changes moves an active rule to Inactive until it is switched on again.</small>}
          </div>
        </div>
      )}

      {perfOpen && perf[perfOpen] && (() => {
        const p = perf[perfOpen], r = rules?.find((x) => x.id === perfOpen);
        const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);
        return (
          <div className="drawer wide" role="dialog" aria-label={`Performance of ${p.ruleId}`}>
            <div className="hdr"><b style={{ fontSize: 16 }}>{p.name}</b><span className="mute">{p.ruleId} · {p.status}</span><button className="icon" style={{ marginLeft: "auto" }} onClick={() => setPerfOpen(null)} aria-label="Close"><X size={18} /></button></div>
            <p className="mute" style={{ marginTop: 0 }}>Last 30 days of transfers. Precision and recall use analyst decisions (FRAUD vs NOT FRAUD) on alerts this rule would have matched.</p>
            <div className="metric-grid">
              <div><span className="mute">Hits</span><b>{p.hits}</b><small className="mute">of {p.total} transfers ({pct(p.hitRate)})</small></div>
              <div><span className="mute">Precision</span><b className={p.precision !== null && p.precision < 0.5 ? "HIGH" : ""}>{pct(p.precision)}</b><small className="mute">{p.fraud} fraud / {p.decided} decided</small></div>
              <div><span className="mute">False positives</span><b>{p.falsePositives}</b></div>
              <div><span className="mute">Recall</span><b>{pct(p.recall)}</b><small className="mute">of all confirmed fraud</small></div>
            </div>
            <h3 style={{ fontSize: 14, margin: "16px 0 8px" }}>Tuning suggestions</h3>
            {!p.suggestions.length ? <p className="mute">No suggestions. {p.decided < 3 ? "Needs at least 3 analyst decisions on this rule's hits." : "The rule is performing well."}</p> : (
              <ul className="imp-list">{p.suggestions.map((sg, i) => (
                <li key={i}><div style={{ display: "grid", gap: 6 }}>
                  <span><span className="chip MEDIUM">{sg.kind}</span> {sg.text}</span>
                  {sg.expression && <code className="wf-expr">{sg.expression}</code>}
                  {canManage && r && sg.condition && <button className="btn" style={{ justifySelf: "start" }} onClick={() => { setPerfOpen(null); setForm({ id: r.id, name: r.name, description: r.description, severity: r.severity, action: r.action, condition: JSON.stringify(sg.condition, null, 2) }); setFormErr(""); }}>Apply in editor</button>}
                  {canManage && r && sg.kind === "strengthen" && <button className="btn" style={{ justifySelf: "start" }} onClick={() => { setPerfOpen(null); setForm({ id: r.id, name: r.name, description: r.description, severity: r.severity, action: "DECLINE", condition: JSON.stringify(r.condition, null, 2) }); }}>Open with action Block</button>}
                </div></li>
              ))}</ul>
            )}
          </div>
        );
      })()}

      {pkg && (
        <div className="drawer" role="dialog" aria-label="Import rules">
          <div className="hdr"><Upload size={18} /><b>Import rules</b><button className="icon" style={{ marginLeft: "auto" }} onClick={() => setPkg(null)} aria-label="Close"><X size={18} /></button></div>
          <p className="mute" style={{ marginTop: 0 }}>{pkg.file.name} · {pkg.items.length} rule(s) in package. Tick the rules to import; they are added as Draft.</p>
          <label className="toggle" style={{ marginBottom: 8 }}>
            <input type="checkbox" checked={pkg.items.filter((i) => i.rule).every((i) => pkg.sel.has(i.file))}
              onChange={(e) => setPkg({ ...pkg, sel: e.target.checked ? new Set(pkg.items.filter((i) => i.rule).map((i) => i.file)) : new Set() })} /> Select all valid
          </label>
          <ul className="imp-list">
            {pkg.items.map((i) => (
              <li key={i.file} className={i.rule ? "" : "bad"}>
                <label>
                  <input type="checkbox" disabled={!i.rule} checked={pkg.sel.has(i.file)} onChange={(e) => setPkg({ ...pkg, sel: toggle(pkg.sel, [i.file], e.target.checked) })} />
                  <span>
                    <b>{i.rule?.name ?? i.file}</b>
                    {i.rule ? <><small><span className={`chip ${i.rule.severity}`}>{i.rule.severity}</span> → {i.rule.action}</small><code className="mute">{i.rule.expression}</code></> : <small className="auth-err">{i.error}</small>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <button className="btn" style={{ width: "100%", marginTop: 12 }} disabled={busy || !pkg.sel.size} onClick={doImport}>{busy ? "Importing…" : `Import ${pkg.sel.size} rule(s)`}</button>
        </div>
      )}
    </>
  );
}
