"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import NotificationBell from "./NotificationBell";
import DemoRefresh from "./DemoRefresh";
import Toaster from "./Toaster";
import { useEffect, useState } from "react";
import { Bell, Briefcase, ClipboardCheck, FileSpreadsheet, MessageSquareReply, Radar, Search, Share2, Smartphone, Users, Workflow, LayoutDashboard, Settings, LogOut, Moon, PanelLeftClose, PanelLeftOpen, SlidersHorizontal, Sun } from "lucide-react";

const m = (p: string) => (x: string) => x === p || x.startsWith(p + "/") || x.startsWith(p + "?");
// Grouped like an investigation console: tools to investigate, queues and reports, rules & automation, administration.
const GROUPS = [
  { title: "Investigation tools", items: [
    { href: "/", perm: "dashboard.view", label: "Command Center", icon: LayoutDashboard, match: (p: string) => p === "/" },
    { href: "/investigator", perm: "alerts.view", label: "Investigator", icon: Search, match: m("/investigator") },
    { href: "/customers", perm: "alerts.view", label: "Customer Profiles", icon: Users, match: (p: string) => m("/customers")(p) || m("/sessions")(p) },
    { href: "/devices", perm: "alerts.view", label: "Device Intelligence", icon: Smartphone, match: m("/devices") },
    { href: "/graph", perm: "alerts.view", label: "Connections Graph Explorer", icon: Share2, match: m("/graph") },
    { href: "/intel", perm: "intel.view", label: "Risk Intelligence", icon: Radar, match: m("/intel") },
  ] },
  { title: "Alerts and reports", items: [
    { href: "/alerts", perm: "alerts.view", label: "Alert Queues", icon: Bell, match: m("/alerts") },
    { href: "/cases", perm: "cases.view", label: "Cases", icon: Briefcase, match: m("/cases") },
    { href: "/feedback", perm: "alerts.view", label: "Feedback", icon: MessageSquareReply, match: m("/feedback") },
    { href: "/reports", perm: "reports.view", label: "Fraud Report", icon: FileSpreadsheet, match: m("/reports") },
  ] },
  { title: "Rules and automation", items: [
    { href: "/rules", perm: "rules.view", label: "Rule Builder", icon: SlidersHorizontal, match: m("/rules") },
    { href: "/workflows", perm: "rules.view", label: "Workflows", icon: Workflow, match: m("/workflows") },
  ] },
  { title: "Administration", items: [
    { href: "/approvals", perm: "settings.view", label: "Approval Center", icon: ClipboardCheck, match: m("/approvals") },
    { href: "/settings", perm: "settings.view", label: "Admin & Settings", icon: Settings, match: m("/settings") },
  ] },
];
const MENU = GROUPS.flatMap((g) => g.items);

const save = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} };

export default function Shell({ user, lastLogin, perms, appName, children }: { user: string; lastLogin: string | null; perms: string[]; appName: string; children: React.ReactNode }) {
  const path = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [dark, setDark] = useState(false);
  useEffect(() => {
    try { setCollapsed(localStorage.getItem("sidebar") === "collapsed"); } catch {}
    setDark(document.documentElement.dataset.theme === "dark");
  }, []);
  const toggleSidebar = () => { setCollapsed(!collapsed); save("sidebar", collapsed ? "open" : "collapsed"); };
  const toggleTheme = () => { const t = dark ? "light" : "dark"; document.documentElement.dataset.theme = t; setDark(!dark); save("theme", t); };
  const active = MENU.find((m) => m.match(path));
  const logout = () => fetch("/api/auth/logout", { method: "POST" }).then(() => location.assign("/login"));

  return (
    <div className={`app${collapsed ? " collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="brand">
          {/* Two files: wordmark when open, square icon when collapsed (CSS swaps them). */}
          <img className="logo logo-full" src="/logo-app.png" alt={appName} width={686} height={176} />
          <img className="logo logo-mark" src="/logo-app-icon.png" alt={appName} width={165} height={176} />
        </div>
        <nav>
          {GROUPS.map((g) => { const items = g.items.filter((x) => perms.includes(x.perm)); return items.length ? (
            <div key={g.title} className="navgroup"><div className="navtitle">{g.title}</div>
              {items.map(({ href, label, icon: Icon }) => (
                <Link key={href} href={href} className={active?.href === href ? "on" : ""} title={label} aria-current={active?.href === href ? "page" : undefined}>
                  <Icon size={18} /><span>{label}</span>
                </Link>
              ))}
            </div>) : null; })}
        </nav>
      </aside>
      <div className="content">
        <header className="topbar">
          <button className="icon" onClick={toggleSidebar} aria-label={collapsed ? "Open sidebar" : "Close sidebar"}>
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
          <b>{active?.label ?? appName}</b>
          <span style={{ flex: 1 }} />
          {perms.includes("settings.config") && <DemoRefresh />}
          <NotificationBell alerts={perms.includes("alerts.view")} approvals={perms.includes("settings.view")} />
          <button className="icon" onClick={toggleTheme} aria-label={dark ? "Light mode" : "Dark mode"}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
          <details className="account">
            <summary aria-label="Account"><span className="avatar">{user[0].toUpperCase()}</span><span className="who">{user}</span></summary>
            <div className="card menu">
              <b>{user}</b>
              <small>Last login: {lastLogin ? new Date(lastLogin).toLocaleString("en-GB", { timeZone: "Asia/Jakarta" }) + " WIB" : "First login"}</small>
              <button onClick={logout}><LogOut size={16} /> Sign out</button>
            </div>
          </details>
        </header>
        {children}
      </div>
      <Toaster />
    </div>
  );
}
