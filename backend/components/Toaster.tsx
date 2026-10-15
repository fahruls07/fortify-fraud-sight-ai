"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { toastLabel } from "@/lib/toastlabels";

type Toast = { id: number; kind: "success" | "error" | "info"; title: string; detail?: string };
const EVT = "fortify:toast";
// Any component can also raise one directly: toast("Copied", "info").
export const toast = (title: string, kind: Toast["kind"] = "success", detail?: string) => dispatchEvent(new CustomEvent(EVT, { detail: { title, kind, detail } }));

// Global toasts. Every mutating /api call (POST / PUT / DELETE) toasts its outcome automatically, so all menus behave the same.
export default function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    let seq = 0;
    const push = (t: Omit<Toast, "id">) => { const id = ++seq; setItems((x) => [...x.slice(-3), { ...t, id }]); setTimeout(() => setItems((x) => x.filter((y) => y.id !== id)), t.kind === "error" ? 7000 : 3500); };
    const onEvt = (e: Event) => push((e as CustomEvent).detail);
    addEventListener(EVT, onEvt);
    const w = window as typeof window & { __fortifyFetch?: typeof fetch };
    w.__fortifyFetch ??= window.fetch.bind(window);
    const orig = w.__fortifyFetch;
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const u = new URL(url, location.href), label = u.origin === location.origin && u.pathname.startsWith("/api/") ? toastLabel(init?.method ?? (input instanceof Request ? input.method : "GET"), u.pathname, init?.body) : null;
      try {
        const res = await orig(input, init);
        if (label) res.clone().json().catch(() => ({})).then((j: { error?: string; errors?: { message: string }[]; details?: string[]; mode?: string; id?: string }) => {
          const gqlErr = j.errors?.[0]?.message;
          if (!res.ok || gqlErr) push({ kind: "error", title: j.error ?? gqlErr ?? `Request failed (HTTP ${res.status})`, detail: j.details?.slice(0, 3).join(" · ") });
          else push({ kind: "success", title: label, detail: j.mode === "outbox" ? "SMTP not configured: saved to the outbox" : undefined });
        });
        return res;
      } catch (e) { if (label) push({ kind: "error", title: "Network error", detail: (e as Error).message }); throw e; }
    };
    return () => { removeEventListener(EVT, onEvt); window.fetch = orig; };
  }, []);
  const ICON = { success: <CheckCircle2 size={18} />, error: <AlertCircle size={18} />, info: <Info size={18} /> };
  return (
    <div className="toaster" aria-live="polite" aria-atomic="false">
      {items.map((t) => (
        <div key={t.id} className={`toast-item ${t.kind}`} role={t.kind === "error" ? "alert" : "status"}>
          {ICON[t.kind]}<span><b>{t.title}</b>{t.detail && <small>{t.detail}</small>}</span>
          <button className="icon" onClick={() => setItems((x) => x.filter((y) => y.id !== t.id))} aria-label="Dismiss"><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}
