"use client";
import { useEffect, useState } from "react";
import { Copy, KeyRound, Plug, Plus, Trash2, X } from "lucide-react";
import { IB_ENDPOINTS, LANGUAGES, TIMEZONES } from "@/lib/settings-shared";
import type { ApiKey, Config } from "@/lib/settings";
import { Skel, SkelTable } from "../Skeleton";
import { toast } from "../Toaster";

type Section = keyof Config;
type Pub = { config: Config; secretsSet: string[] };
type Test = { ok: boolean; message: string; ms: number };
const dt = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

// One section's form: draft vs saved, Save / Cancel, secrets that are write-only.
function useSection<S extends Section>(section: S, pub: Pub | null, setPub: (p: Pub) => void) {
  const [draft, setDraft] = useState<Config[S] | null>(null), [clear, setClear] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null), [busy, setBusy] = useState(false);
  useEffect(() => { if (pub && !draft) setDraft(structuredClone(pub.config[section])); }, [pub]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = !!pub && !!draft && (JSON.stringify(draft) !== JSON.stringify(pub.config[section]) || clear.length > 0);
  const cancel = () => { if (pub) setDraft(structuredClone(pub.config[section])); setClear([]); setMsg(null); };
  async function save() {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/settings/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ section, values: draft, clear }) });
    const j = await r.json(); setBusy(false);
    if (!r.ok) return setMsg({ error: j.error });
    setPub(j); setDraft(structuredClone(j.config[section])); setClear([]); setMsg({ ok: "Saved." });
  }
  const isSet = (path: string) => !!pub?.secretsSet.includes(path) && !clear.includes(path);
  return { draft, setDraft, dirty, save, cancel, msg, busy, isSet, clear, setClear };
}

function Secret({ label, path, value, onChange, s, placeholder, multiline, disabled }: { label: string; path: string; value: string; onChange: (v: string) => void; s: { isSet: (p: string) => boolean; clear: string[]; setClear: (c: string[]) => void }; placeholder?: string; multiline?: boolean; disabled: boolean }) {
  const set = s.isSet(path), ph = set ? "•••••••• stored (leave empty to keep)" : placeholder;
  return (
    <label className="field"><span>{label} {set && <button type="button" className="linkish" disabled={disabled} onClick={() => s.setClear([...s.clear, path])}>Remove</button>}{s.clear.includes(path) && <span className="mute"> (will be removed on save)</span>}</span>
      {multiline ? <textarea className="json-editor" rows={4} value={value} placeholder={ph} disabled={disabled} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
        : <input type="password" value={value} placeholder={ph} disabled={disabled} onChange={(e) => onChange(e.target.value)} autoComplete="new-password" />}
    </label>
  );
}

function Bar({ s, disabled, children }: { s: { dirty: boolean; save: () => void; cancel: () => void; busy: boolean; msg: { ok?: string; error?: string } | null }; disabled: boolean; children?: React.ReactNode }) {
  return (
    <div className="save-bar">
      {s.msg?.ok && <span className="ok-msg" style={{ margin: 0 }}>{s.msg.ok}</span>}
      {s.msg?.error && <span className="auth-err" style={{ margin: 0 }}>{s.msg.error}</span>}
      {children}
      <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
        <button onClick={s.cancel} disabled={!s.dirty || s.busy}>Cancel</button>
        <button className="btn" onClick={s.save} disabled={disabled || !s.dirty || s.busy}>{s.busy ? "Saving…" : "Save changes"}</button>
      </span>
    </div>
  );
}

function TestButton({ target, arg, dirty, label = "Test connection" }: { target: string; arg?: string; dirty: boolean; label?: string }) {
  const [r, setR] = useState<Test | null>(null), [busy, setBusy] = useState(false);
  async function run() { setBusy(true); setR(null); const res = await fetch("/api/settings/config/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target, arg }) }); setR(await res.json()); setBusy(false); }
  return (
    <span className="test-btn">
      <button className="ico-btn" onClick={run} disabled={busy || dirty} title={dirty ? "Save first: tests use the saved settings" : ""}><Plug size={14} /> {busy ? "Testing…" : label}</button>
      {r && <span className={r.ok ? "ok-msg" : "auth-err"} style={{ margin: 0 }}>{r.ok ? "✓" : "✗"} {r.message} <span className="mute">({r.ms} ms)</span></span>}
    </span>
  );
}

export function useConfig() {
  const [pub, setPub] = useState<Pub | null>(null);
  useEffect(() => { fetch("/api/settings/config").then((r) => r.json()).then(setPub); }, []);
  return { pub, setPub };
}

export function GeneralTab({ pub, setPub, canEdit }: { pub: Pub | null; setPub: (p: Pub) => void; canEdit: boolean }) {
  const s = useSection("general", pub, setPub), d = s.draft;
  if (!d) return <Skel h={300} />;
  const set = (p: Partial<Config["general"]>) => s.setDraft({ ...d, ...p });
  const n = (v: string) => (v === "" ? NaN : Number(v));
  return (
    <div className="card cfg">
      <h3>Application</h3>
      <div className="cfg-grid">
        <label className="field"><span>App name</span><input value={d.appName} disabled={!canEdit} onChange={(e) => set({ appName: e.target.value })} /><small className="mute">Shown in the sidebar and browser tab.</small></label>
        <label className="field"><span>Timezone</span><select value={d.timezone} disabled={!canEdit} onChange={(e) => set({ timezone: e.target.value as Config["general"]["timezone"] })}>{Object.entries(TIMEZONES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select><small className="mute">Stored for reports and integrations; screens currently display WIB.</small></label>
        <label className="field"><span>Language</span><select value={d.language} disabled={!canEdit} onChange={(e) => set({ language: e.target.value as "en" })}>{Object.entries(LANGUAGES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}<option disabled>Bahasa Indonesia (coming soon)</option></select></label>
      </div>
      <h3>Default thresholds</h3>
      <p className="mute" style={{ marginTop: -6 }}>Defaults offered when building rules and workflows. They do not change the baseline scoring engine.</p>
      <div className="cfg-grid">
        <label className="field"><span>Rule default: min amount (IDR)</span><input type="number" min={0} value={Number.isNaN(d.minAmount) ? "" : d.minAmount} disabled={!canEdit} onChange={(e) => set({ minAmount: n(e.target.value) })} /></label>
        <label className="field"><span>Max velocity (tx / hour)</span><input type="number" min={1} value={Number.isNaN(d.maxVelocity) ? "" : d.maxVelocity} disabled={!canEdit} onChange={(e) => set({ maxVelocity: n(e.target.value) })} /></label>
        <label className="field"><span>Geo radius (km)</span><input type="number" min={1} value={Number.isNaN(d.geoRadiusKm) ? "" : d.geoRadiusKm} disabled={!canEdit} onChange={(e) => set({ geoRadiusKm: n(e.target.value) })} /><small className="mute">Distance from usual location that counts as a geo anomaly.</small></label>
      </div>
      <h3>High-value transfers</h3>
      <div className="cfg-grid">
        <label className="field"><span>Always review transfers from (IDR)</span><input type="number" min={0} value={Number.isNaN(d.highValueAmount) ? "" : d.highValueAmount} disabled={!canEdit} onChange={(e) => set({ highValueAmount: n(e.target.value) })} />
          <small className="mute">Transfers at or above this amount are held for review (at least Medium) even from a known device to a known payee. 0 = off. Applies to /api/transactions/score; workflows decide for themselves.</small></label>
      </div>
      <h3>Alerts</h3>
      <div className="cfg-grid">
        <label className="field"><span>Auto-resolve alerts after (hours)</span><input type="number" min={0} max={720} value={Number.isNaN(d.autoResolveHours) ? "" : d.autoResolveHours} disabled={!canEdit} onChange={(e) => set({ autoResolveHours: n(e.target.value) })} />
          <small className="mute">0 = off. Only <b>Low</b> severity alerts nobody has acknowledged: they are approved as not fraud and the held transfer is released. Logged as <code>system:auto-resolve</code>.</small></label>
      </div>
      <Bar s={s} disabled={!canEdit} />
    </div>
  );
}

export function ApiTab({ pub, setPub, canEdit }: { pub: Pub | null; setPub: (p: Pub) => void; canEdit: boolean }) {
  const s = useSection("api", pub, setPub), d = s.draft;
  const [keys, setKeys] = useState<Omit<ApiKey, "hash">[] | null>(null), [name, setName] = useState(""), [fresh, setFresh] = useState<string | null>(null), [kErr, setKErr] = useState("");
  const loadKeys = () => fetch("/api/settings/apikeys").then((r) => r.json()).then(setKeys);
  useEffect(() => { loadKeys(); }, []);
  const origin = typeof window === "undefined" ? "" : location.origin;
  async function gen() {
    setKErr(""); const r = await fetch("/api/settings/apikeys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }), j = await r.json();
    if (!r.ok) return setKErr(j.error); setFresh(j.key); setName(""); loadKeys();
  }
  async function revoke(k: Omit<ApiKey, "hash">) { if (!confirm(`Revoke "${k.name}"? Apps using it will stop working immediately.`)) return; await fetch(`/api/settings/apikeys/${k.id}/revoke`, { method: "POST" }); loadKeys(); }
  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => toast("Copied to clipboard", "info"), () => toast("Could not copy", "error"));
  return (
    <>
      <div className="card cfg">
        <div className="hdr" style={{ margin: 0 }}><h3 style={{ margin: 0 }}>Internet banking fraud-detection endpoints</h3><span className="mute">Base URL <code>{origin}</code> · <a href="/api/openapi" target="_blank" rel="noreferrer">Open full API reference →</a></span></div>
        <div className="tablewrap"><table className="ep-table">
          <thead><tr><th>Method</th><th>Endpoint</th><th>Auth</th><th>Purpose</th><th /></tr></thead>
          <tbody>{IB_ENDPOINTS.map((e) => {
            const full = e.path.startsWith("/") ? `${origin}${e.path}` : e.path;
            const curl = e.path.startsWith("/api/transactions") || e.path.startsWith("/api/flows") ? `curl -X ${e.method} '${full.replace("{transactionId}", "TX-L0001").replace("{slug}", "high-amount-check")}' -H 'X-API-Key: <your key>'${"example" in e ? ` -H 'Content-Type: application/json' -d '${e.example}'` : ""}` : "";
            return (
              <tr key={e.path}>
                <td><span className={`chip method-${e.method}`}>{e.method}</span></td>
                <td><code>{e.path}</code></td><td className="mute">{e.auth}</td><td className="desc">{e.desc}</td>
                <td style={{ whiteSpace: "nowrap" }}>{e.path.startsWith("/") && <button className="icon" title="Copy URL" aria-label="Copy URL" onClick={() => copy(full)}><Copy size={14} /></button>}
                  {curl && <button className="linkish" onClick={() => copy(curl)} title="Copy a curl example">curl</button>}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
        <small className="mute">Send <code>X-API-Key</code> on every banking call. Enforcement is switched on under Access below; the OpenAPI file documents every field and response.</small>
      </div>
      <div className="card cfg">
        <div className="hdr" style={{ margin: 0 }}><h3 style={{ margin: 0 }}>API keys</h3><span className="mute">For the internet-banking channel calling <code>/api/transactions/*</code> with header <code>X-API-Key</code>.</span></div>
        {canEdit && <div className="filters" style={{ margin: "12px 0" }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Key name, e.g. Internet Banking (prod)" style={{ flex: 1, minWidth: 240 }} onKeyDown={(e) => e.key === "Enter" && name.trim() && gen()} />
          <button className="btn ico-btn" disabled={!name.trim()} onClick={gen}><KeyRound size={15} /> Generate new API key</button>
        </div>}
        {kErr && <p className="auth-err">{kErr}</p>}
        {fresh && <div className="key-once" role="alert">
          <b>Copy this key now. It will not be shown again.</b>
          <span><code>{fresh}</code><button className="ico-btn" onClick={() => copy(fresh)}><Copy size={14} /> Copy</button><button className="icon" onClick={() => setFresh(null)} aria-label="Dismiss"><X size={16} /></button></span>
        </div>}
        {!keys ? <SkelTable rows={3} cols={5} /> : (
          <div className="tablewrap"><table>
            <thead><tr><th>Name</th><th>Key</th><th>Created</th><th>Last used</th><th>Status</th><th style={{ textAlign: "right" }}>Action</th></tr></thead>
            <tbody>
              {keys.map((k) => <tr key={k.id}>
                <td><b>{k.name}</b><div className="mute">by {k.createdBy}</div></td><td><code>{k.prefix}••••••••{k.last4}</code></td><td className="mute">{dt(k.createdAt)}</td><td className="mute">{dt(k.lastUsedAt)}</td>
                <td><span className={`chip ${k.status === "ACTIVE" ? "LOW" : "HIGH"}`}>{k.status === "ACTIVE" ? "Active" : "Revoked"}</span>{k.revokedAt && <div className="mute">{dt(k.revokedAt)}</div>}</td>
                <td style={{ textAlign: "right" }}>{canEdit && k.status === "ACTIVE" && <button className="danger" onClick={() => revoke(k)}>Revoke</button>}</td>
              </tr>)}
              {!keys.length && <tr><td colSpan={6} className="mute empty">No API keys yet.</td></tr>}
            </tbody>
          </table></div>
        )}
      </div>
      {!d ? <Skel h={200} /> : (
        <div className="card cfg">
          <h3>Access</h3>
          <label className="toggle"><input type="checkbox" checked={d.requireApiKey} disabled={!canEdit} onChange={(e) => s.setDraft({ ...d, requireApiKey: e.target.checked })} /> Require a valid API key on <code>/api/transactions/*</code></label>
          {d.requireApiKey && !keys?.some((k) => k.status === "ACTIVE") && <p className="auth-err">No active key: every banking call would be rejected. Generate a key first.</p>}
          <h3>Webhook</h3>
          <div className="cfg-grid">
            <label className="field" style={{ gridColumn: "span 2" }}><span>Webhook URL</span><input value={d.webhookUrl} disabled={!canEdit} onChange={(e) => s.setDraft({ ...d, webhookUrl: e.target.value })} placeholder="https://core-banking.example/fraud-events" /></label>
            <Secret label="Signing secret" path="api.webhookSecret" value={d.webhookSecret} onChange={(v) => s.setDraft({ ...d, webhookSecret: v })} s={s} placeholder="Used for the X-Fortify-Signature HMAC" disabled={!canEdit} />
          </div>
          <div className="filters" style={{ margin: "8px 0 0" }}>
            <label className="toggle"><input type="checkbox" checked={d.webhookEvents.alertCreated} disabled={!canEdit} onChange={(e) => s.setDraft({ ...d, webhookEvents: { ...d.webhookEvents, alertCreated: e.target.checked } })} /> Alert created</label>
            <label className="toggle"><input type="checkbox" checked={d.webhookEvents.alertResolved} disabled={!canEdit} onChange={(e) => s.setDraft({ ...d, webhookEvents: { ...d.webhookEvents, alertResolved: e.target.checked } })} /> Alert resolved</label>
          </div>
          <h3>Endpoints</h3>
          <div className="cfg-grid">
            <label className="field"><span>GraphQL endpoint</span><span className="copy-field"><code>{origin}/api/graphql</code><button className="icon" onClick={() => copy(`${origin}/api/graphql`)} aria-label="Copy"><Copy size={14} /></button></span></label>
            <label className="field"><span>OpenAPI spec</span><span className="copy-field"><code>{origin}/api/openapi</code><button className="icon" onClick={() => copy(`${origin}/api/openapi`)} aria-label="Copy"><Copy size={14} /></button></span></label>
          </div>
          <Bar s={s} disabled={!canEdit}><TestButton target="webhook" dirty={s.dirty} label="Send test webhook" /></Bar>
        </div>
      )}
    </>
  );
}

export function NotificationTab({ pub, setPub, canEdit, myEmail }: { pub: Pub | null; setPub: (p: Pub) => void; canEdit: boolean; myEmail: string }) {
  const s = useSection("notification", pub, setPub), d = s.draft;
  const [to, setTo] = useState(myEmail);
  if (!d) return <Skel h={400} />;
  const smtp = (p: Partial<Config["notification"]["smtp"]>) => s.setDraft({ ...d, smtp: { ...d.smtp, ...p } });
  return (
    <div className="card cfg">
      <h3>Email (SMTP)</h3>
      <div className="cfg-grid">
        <label className="field"><span>Host</span><input value={d.smtp.host} disabled={!canEdit} onChange={(e) => smtp({ host: e.target.value })} placeholder="smtp.bank.co.id" /></label>
        <label className="field"><span>Port</span><input type="number" value={d.smtp.port} disabled={!canEdit} onChange={(e) => smtp({ port: Number(e.target.value) })} /></label>
        <label className="field"><span>Security</span><select value={String(d.smtp.secure)} disabled={!canEdit} onChange={(e) => smtp({ secure: e.target.value === "true" })}><option value="false">STARTTLS (587)</option><option value="true">TLS / SSL (465)</option></select></label>
        <label className="field"><span>Username</span><input value={d.smtp.user} disabled={!canEdit} onChange={(e) => smtp({ user: e.target.value })} autoComplete="off" /></label>
        <Secret label="Password" path="notification.smtp.pass" value={d.smtp.pass} onChange={(v) => smtp({ pass: v })} s={s} disabled={!canEdit} />
        <label className="field"><span>From</span><input value={d.smtp.from} disabled={!canEdit} onChange={(e) => smtp({ from: e.target.value })} /></label>
      </div>
      <div className="test-row"><input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Send test to…" style={{ minWidth: 240 }} /><TestButton target="smtp" arg={to} dirty={s.dirty} label="Send test email" /></div>
      {!d.smtp.host && <p className="mute">Without an SMTP host, emails are saved as .eml files in data/runtime/outbox.</p>}

      <h3>Slack</h3>
      <label className="toggle"><input type="checkbox" checked={d.slack.enabled} disabled={!canEdit} onChange={(e) => s.setDraft({ ...d, slack: { ...d.slack, enabled: e.target.checked } })} /> Post new alerts to Slack</label>
      <div className="cfg-grid"><div style={{ gridColumn: "span 2" }}><Secret label="Incoming webhook URL" path="notification.slack.webhookUrl" value={d.slack.webhookUrl} onChange={(v) => s.setDraft({ ...d, slack: { ...d.slack, webhookUrl: v } })} s={s} placeholder="https://hooks.slack.com/services/…" disabled={!canEdit} /></div></div>
      <div className="test-row"><TestButton target="slack" dirty={s.dirty} label="Send test to Slack" /></div>

      <h3>Telegram</h3>
      <label className="toggle"><input type="checkbox" checked={d.telegram.enabled} disabled={!canEdit} onChange={(e) => s.setDraft({ ...d, telegram: { ...d.telegram, enabled: e.target.checked } })} /> Send new alerts to Telegram</label>
      <div className="cfg-grid">
        <Secret label="Bot token" path="notification.telegram.botToken" value={d.telegram.botToken} onChange={(v) => s.setDraft({ ...d, telegram: { ...d.telegram, botToken: v } })} s={s} placeholder="123456789:ABC…" disabled={!canEdit} />
        <label className="field"><span>Chat ID</span><input value={d.telegram.chatId} disabled={!canEdit} onChange={(e) => s.setDraft({ ...d, telegram: { ...d.telegram, chatId: e.target.value } })} placeholder="-1001234567890 or @channel" /></label>
      </div>
      <div className="test-row"><TestButton target="telegram" dirty={s.dirty} label="Send test to Telegram" /></div>

      <h3>When to notify</h3>
      <label className="field" style={{ maxWidth: 320 }}><span>Minimum severity for Slack / Telegram</span>
        <select value={d.minSeverity} disabled={!canEdit} onChange={(e) => s.setDraft({ ...d, minSeverity: e.target.value as Config["notification"]["minSeverity"] })}><option value="MEDIUM">Medium and above</option><option value="HIGH">High and above</option><option value="CRITICAL">Critical only</option></select></label>
      <Bar s={s} disabled={!canEdit} />
    </div>
  );
}

export function IntegrationTab({ pub, setPub, canEdit }: { pub: Pub | null; setPub: (p: Pub) => void; canEdit: boolean }) {
  const s = useSection("integration", pub, setPub), d = s.draft;
  if (!d) return <Skel h={400} />;
  const fs = (p: Partial<Config["integration"]["firestore"]>) => s.setDraft({ ...d, firestore: { ...d.firestore, ...p } });
  const gf = (p: Partial<Config["integration"]["grafana"]>) => s.setDraft({ ...d, grafana: { ...d.grafana, ...p } });
  const ep = (i: number, p: Partial<{ name: string; url: string }>) => s.setDraft({ ...d, endpoints: d.endpoints.map((e, j) => (j === i ? { ...e, ...p } : e)) });
  return (
    <div className="card cfg">
      <h3>Database · Firestore</h3>
      <div className="cfg-grid">
        <label className="field"><span>Project ID</span><input value={d.firestore.projectId} disabled={!canEdit} onChange={(e) => fs({ projectId: e.target.value })} placeholder="my-gcp-project" /></label>
        <label className="field"><span>Database ID</span><input value={d.firestore.databaseId} disabled={!canEdit} onChange={(e) => fs({ databaseId: e.target.value })} /></label>
        <div style={{ gridColumn: "1 / -1" }}><Secret label="Service account key (JSON)" path="integration.firestore.serviceAccountJson" value={d.firestore.serviceAccountJson} onChange={(v) => fs({ serviceAccountJson: v })} s={s} placeholder='{ "type": "service_account", "client_email": …, "private_key": … }' multiline disabled={!canEdit} /></div>
      </div>
      <div className="test-row"><TestButton target="firestore" dirty={s.dirty} /><span className="mute">Needs the Cloud Datastore User role. The app still stores data locally; this checks connectivity.</span></div>

      <h3>External API endpoints</h3>
      <div style={{ display: "grid", gap: 8 }}>
        {d.endpoints.map((e, i) => (
          <div key={i} className="ep-row">
            <input value={e.name} disabled={!canEdit} onChange={(x) => ep(i, { name: x.target.value })} placeholder="Name, e.g. Core banking" />
            <input value={e.url} disabled={!canEdit} onChange={(x) => ep(i, { url: x.target.value })} placeholder="https://api.example/health" style={{ flex: 2 }} />
            <TestButton target="endpoint" arg={String(i)} dirty={s.dirty} label="Test" />
            {canEdit && <button className="icon" onClick={() => s.setDraft({ ...d, endpoints: d.endpoints.filter((_, j) => j !== i) })} aria-label="Remove endpoint"><Trash2 size={15} /></button>}
          </div>
        ))}
        {!d.endpoints.length && <p className="mute" style={{ margin: 0 }}>No external endpoints.</p>}
        {canEdit && <button className="ico-btn" style={{ justifySelf: "start" }} onClick={() => s.setDraft({ ...d, endpoints: [...d.endpoints, { name: "", url: "" }] })}><Plus size={14} /> Add endpoint</button>}
      </div>

      <h3>Logging · Grafana Loki</h3>
      <label className="toggle"><input type="checkbox" checked={d.grafana.enabled} disabled={!canEdit} onChange={(e) => gf({ enabled: e.target.checked })} /> Ship alert events to Loki</label>
      <div className="cfg-grid">
        <label className="field"><span>Loki URL</span><input value={d.grafana.lokiUrl} disabled={!canEdit} onChange={(e) => gf({ lokiUrl: e.target.value })} placeholder="https://logs-prod-020.grafana.net" /></label>
        <label className="field"><span>User / tenant ID</span><input value={d.grafana.user} disabled={!canEdit} onChange={(e) => gf({ user: e.target.value })} autoComplete="off" /></label>
        <Secret label="API key" path="integration.grafana.apiKey" value={d.grafana.apiKey} onChange={(v) => gf({ apiKey: v })} s={s} disabled={!canEdit} />
      </div>
      <div className="test-row"><TestButton target="grafana" dirty={s.dirty} label="Send test log" /></div>
      <Bar s={s} disabled={!canEdit} />
    </div>
  );
}


export function AiTab({ pub, setPub, canEdit }: { pub: Pub | null; setPub: (p: Pub) => void; canEdit: boolean }) {
  const s = useSection("ai", pub, setPub), d = s.draft;
  if (!d) return <Skel h={300} />;
  const set = (p: Partial<Config["ai"]>) => s.setDraft({ ...d, ...p });
  const keySet = s.isSet("ai.apiKey");
  return (
    <div className="card cfg">
      <h3>Gemini connection</h3>
      <p className="mute" style={{ marginTop: -6 }}>Used by every AI layer: alert investigation Assistant, rule generator, Rule / Workflow Assistant chat, workflow AI nodes and the dashboard assistant. Empty fields fall back to the server environment variables.</p>
      <div className="field"><span>Connect with</span><div className="seg">
        <button aria-pressed={d.mode === "api_key"} disabled={!canEdit} onClick={() => set({ mode: "api_key" })}>API key (Google AI Studio)</button>
        <button aria-pressed={d.mode === "vertex"} disabled={!canEdit} onClick={() => set({ mode: "vertex" })}>Vertex AI (Google Cloud)</button>
      </div></div>
      <div className="cfg-grid">
        {d.mode === "api_key"
          ? <Secret label="API key" path="ai.apiKey" value={d.apiKey} onChange={(v) => set({ apiKey: v })} s={s} placeholder="AIza…" disabled={!canEdit} />
          : <>
            <label className="field"><span>Project ID</span><input value={d.project} disabled={!canEdit} onChange={(e) => set({ project: e.target.value })} placeholder="my-gcp-project" /><small className="mute">Uses the server&apos;s Google credentials (ADC / service account).</small></label>
            <label className="field"><span>Location</span><input value={d.location} disabled={!canEdit} onChange={(e) => set({ location: e.target.value })} placeholder="global" /></label>
          </>}
        <label className="field"><span>Model</span><input list="gemini-models" value={d.model} disabled={!canEdit} onChange={(e) => set({ model: e.target.value })} />
          <datalist id="gemini-models"><option value="gemini-3.8-flash" /><option value="gemini-3.5-flash-lite" /></datalist></label>
        <label className="field"><span>Base URL <span className="mute">(optional)</span></span><input value={d.baseUrl} disabled={!canEdit} onChange={(e) => set({ baseUrl: e.target.value })} placeholder="https://generativelanguage.googleapis.com" />
          <small className="mute">Only for a proxy / private endpoint. Leave empty for Google&apos;s default.</small></label>
      </div>
      {d.mode === "api_key" && !keySet && !d.apiKey && <p className="mute" style={{ margin: 0 }}>No key stored: AI features use GEMINI_API_KEY / GOOGLE_CLOUD_PROJECT from the server environment if present, otherwise their offline fallbacks.</p>}
      <Bar s={s} disabled={!canEdit}><TestButton target="gemini" dirty={s.dirty} label="Test Gemini" /></Bar>
    </div>
  );
}

export function CustomerMsgSection({ pub, setPub, canEdit }: { pub: Pub | null; setPub: (p: Pub) => void; canEdit: boolean }) {
  const s = useSection("customer", pub, setPub), d = s.draft;
  const [to, setTo] = useState("+62812");
  if (!d) return <Skel h={300} />;
  const ch = (k: "sms" | "push", p: Partial<Config["customer"]["sms"]>) => s.setDraft({ ...d, [k]: { ...d[k], ...p } });
  const tpl = (k: keyof Config["customer"]["templates"], v: string) => s.setDraft({ ...d, templates: { ...d.templates, [k]: v } });
  return (
    <div className="card cfg">
      <h3>Customer messages (SMS · push · OTP)</h3>
      <p className="mute" style={{ marginTop: -6 }}>Sent when an analyst challenges (OTP), declines, freezes or releases a transfer. Any HTTP gateway works: FraudSight AI POSTs your body template with <code>{"{{phone}}"}</code>, <code>{"{{text}}"}</code>, <code>{"{{customerId}}"}</code>, <code>{"{{bank}}"}</code>. With nothing enabled, messages go to Risk Intelligence → Customer messages (outbox).</p>
      {(["sms", "push"] as const).map((k) => (
        <div key={k} className="cfg" style={{ gap: 8 }}>
          <label className="toggle"><input type="checkbox" checked={d[k].enabled} disabled={!canEdit} onChange={(e) => ch(k, { enabled: e.target.checked })} /> {k === "sms" ? "SMS gateway" : "Push gateway"}</label>
          <div className="cfg-grid">
            <label className="field"><span>URL</span><input value={d[k].url} disabled={!canEdit} onChange={(e) => ch(k, { url: e.target.value })} placeholder={k === "sms" ? "https://sms-gateway.example/send" : "https://push.example/notify"} /></label>
            <Secret label="Auth header (Name: value)" path={`customer.${k}.authHeader`} value={d[k].authHeader} onChange={(v) => ch(k, { authHeader: v })} s={s} placeholder="Authorization: Bearer …" disabled={!canEdit} />
            <label className="field" style={{ gridColumn: "1 / -1" }}><span>JSON body template</span><textarea className="json-editor" rows={2} value={d[k].body} disabled={!canEdit} onChange={(e) => ch(k, { body: e.target.value })} /></label>
          </div>
          <div className="test-row">{k === "sms" && <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Test phone" style={{ width: 180 }} />}<TestButton target={k} arg={k === "sms" ? to : "TEST"} dirty={s.dirty} label={`Send test ${k.toUpperCase()}`} /></div>
        </div>
      ))}
      <div className="cfg-grid">
        <label className="field"><span>OTP valid for (minutes)</span><input type="number" min={1} max={30} value={d.otpMinutes} disabled={!canEdit} onChange={(e) => s.setDraft({ ...d, otpMinutes: Number(e.target.value) })} /></label>
        <label className="field"><span>OTP attempts</span><input type="number" min={1} max={10} value={d.otpAttempts} disabled={!canEdit} onChange={(e) => s.setDraft({ ...d, otpAttempts: Number(e.target.value) })} /><small className="mute">After the last wrong try the transfer stays held and goes back to the analysts.</small></label>
      </div>
      <h3>Message templates</h3>
      <p className="mute" style={{ marginTop: -6 }}>Placeholders: {"{{bank}} {{amount}} {{beneficiary}} {{minutes}}"} and {"{{otp}}"} (challenge only, required).</p>
      {(["challenge", "declined", "frozen", "released"] as const).map((k) => (
        <label key={k} className="field"><span>{k[0].toUpperCase() + k.slice(1)}</span><textarea rows={2} value={d.templates[k]} disabled={!canEdit} onChange={(e) => tpl(k, e.target.value)} /></label>
      ))}
      <Bar s={s} disabled={!canEdit} />
    </div>
  );
}
