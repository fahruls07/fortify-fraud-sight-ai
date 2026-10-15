"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Bell, ClipboardCheck, ShieldAlert } from "lucide-react";
import type { AlertRow } from "@/lib/alerts";
import type { AccessRequest } from "@/lib/perms";
import { ago, idr } from "@/lib/format";

type Note = { id: string; at: string; title: string; body: string; href: string; kind: "alert" | "approval"; level?: string };
const KEY = "notif-seen";
const read = () => { try { return localStorage.getItem(KEY) ?? ""; } catch { return ""; } };

// Top-bar notifications: new alerts arrive live over SSE; pending approvals are polled every minute.
export default function NotificationBell({ alerts, approvals }: { alerts: boolean; approvals: boolean }) {
  const [items, setItems] = useState<Note[]>([]);
  const [seen, setSeen] = useState(""), [open, setOpen] = useState(false), [, tick] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const fromAlert = (r: AlertRow): Note => ({ id: r.id, at: r.createdAt, kind: "alert", level: r.baselineLevel, title: `New ${r.baselineLevel.toLowerCase()}-risk alert ${r.id}`, body: `${r.customerName} · ${idr(r.amount)}`, href: `/alerts/${r.id}` });
  const merge = (n: Note[]) => setItems((p) => [...n, ...p.filter((x) => !n.some((y) => y.id === x.id))].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30));

  useEffect(() => {
    setSeen(read());
    let es: EventSource | undefined, t: ReturnType<typeof setInterval> | undefined;
    if (alerts) {
      fetch("/api/alerts?status=New").then((r) => r.json()).then((rows: AlertRow[]) => merge([...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10).map(fromAlert)));
      es = new EventSource("/api/alerts/stream");
      es.addEventListener("alert.created", (e) => merge([fromAlert(JSON.parse((e as MessageEvent).data))]));
      es.addEventListener("alert.updated", (e) => {
        const r = JSON.parse((e as MessageEvent).data) as AlertRow & { escalated?: boolean; escalatedAt?: string };
        if (r.escalated && r.status !== "Decided") merge([{ id: `sla-${r.id}`, at: r.escalatedAt ?? new Date().toISOString(), kind: "alert", level: "HIGH", title: `SLA breached: ${r.id}`, body: `${r.customerName} · ${idr(r.amount)} · still not decided`, href: `/alerts/${r.id}` }]);
      });
    }
    if (approvals) {
      const poll = () => fetch("/api/settings/requests").then((r) => r.json()).then((rs: AccessRequest[]) => {
        const pending = rs.filter((r) => r.status === "PENDING");
        setItems((p) => [...p.filter((x) => x.kind !== "approval"), ...pending.map((r): Note => ({ id: r.id, at: r.createdAt, kind: "approval", title: `Approval needed: ${r.id}`, body: `${r.type.replaceAll("_", " ").toLowerCase()} · ${r.target} (by ${r.maker})`, href: "/approvals" }))].sort((a, b) => b.at.localeCompare(a.at)));
      });
      poll(); t = setInterval(poll, 60000);
    }
    const r = setInterval(() => tick((n) => n + 1), 30000); // refresh "x min ago"
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("click", close);
    return () => { es?.close(); clearInterval(t); clearInterval(r); document.removeEventListener("click", close); };
  }, [alerts, approvals]);

  const unread = items.filter((n) => n.at > seen).length;
  const markRead = () => { const at = items[0]?.at ?? new Date().toISOString(); setSeen(at); try { localStorage.setItem(KEY, at); } catch {} };

  return (
    <div className="notif" ref={box}>
      <button className="icon" onClick={() => setOpen(!open)} aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} aria-expanded={open}>
        <Bell size={18} />{unread > 0 && <span className="badge notif-count">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="card menu notif-menu">
          <div className="hdr" style={{ margin: 0 }}><b>Notifications</b>{unread > 0 && <button className="linkish" style={{ marginLeft: "auto" }} onClick={markRead}>Mark all as read</button>}</div>
          {!items.length && <p className="mute" style={{ margin: 0 }}>You are all caught up.</p>}
          <ul>
            {items.map((n) => (
              <li key={n.id} className={n.at > seen ? "unread" : ""}>
                <Link href={n.href} onClick={() => setOpen(false)}>
                  <span className={`notif-ico ${n.level ?? ""}`}>{n.kind === "alert" ? <ShieldAlert size={16} /> : <ClipboardCheck size={16} />}</span>
                  <span><b>{n.title}</b><small>{n.body}</small><small className="mute">{ago(n.at)}</small></span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
