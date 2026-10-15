"use client";
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

const DEMO = { username: "sari", password: "fortify123" };

export default function LoginForm({ next }: { next: string }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState(""), [password, setPassword] = useState(""), [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const reg = mode === "register";
  const mismatch = reg && confirm !== "" && confirm !== password;

  function switchTo(m: typeof mode) { setMode(m); setErr(""); setPassword(""); setConfirm(""); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mismatch) return setErr("Passwords do not match.");
    setBusy(true); setErr("");
    const res = await fetch(`/api/auth/${reg ? "register" : "login"}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reg ? { username, password, confirm } : { username, password }),
    });
    if (res.ok) return location.assign(next); // full reload so the layout picks up the new session
    setBusy(false);
    setErr((await res.json().catch(() => ({}))).error ?? "Something went wrong. Please try again.");
  }

  const pw = (id: string, label: string, value: string, set: (v: string) => void, auto: string) => (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <div className="pw">
        <input id={id} type={show ? "text" : "password"} value={value} onChange={(e) => set(e.target.value)} autoComplete={auto} required minLength={reg ? 8 : undefined}
          aria-invalid={id === "confirm" && mismatch} />
        {id === "password" && <button type="button" className="icon" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>}
      </div>
    </label>
  );

  return (
    <form className="auth-form" onSubmit={submit}>
      <div className="auth-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={!reg} onClick={() => switchTo("login")}>Sign in</button>
        <button type="button" role="tab" aria-selected={reg} onClick={() => switchTo("register")}>Create account</button>
      </div>
      <h1>{reg ? "Create analyst account" : "Sign in to the console"}</h1>
      <p className="mute">{reg ? "Choose a username and password. Enter the password twice to avoid typos." : "Use a registered analyst account."}</p>

      <label className="field" htmlFor="username">
        <span>Username</span>
        <input id="username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} required autoFocus />
        {reg && <small className="mute">3–32 characters: lowercase letters, digits, . _ -</small>}
      </label>
      {pw("password", "Password", password, setPassword, reg ? "new-password" : "current-password")}
      {reg && pw("confirm", "Confirm password", confirm, setConfirm, "new-password")}
      {reg && password && <small className={mismatch ? "HIGH" : "mute"} style={{ marginTop: -8 }}>{mismatch ? "Passwords do not match yet." : password.length < 8 ? `At least 8 characters (${password.length}/8)` : confirm === password ? "Passwords match." : ""}</small>}

      {err && <p className="auth-err" role="alert">{err}</p>}
      <button className="btn" type="submit" disabled={busy}>{busy ? "Processing…" : reg ? "Create account & sign in" : "Sign in"}</button>

      {!reg && (
        <div className="demo">
          <div><span className="mute">Demo account</span><br /><code>{DEMO.username}</code> / <code>{DEMO.password}</code></div>
          <button type="button" onClick={() => { setUsername(DEMO.username); setPassword(DEMO.password); }}>Autofill</button>
        </div>
      )}
    </form>
  );
}
