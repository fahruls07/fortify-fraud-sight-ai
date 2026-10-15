"use client";
import { useState } from "react";
import { Bell, Bot, Code2, History, Plug, SlidersHorizontal, Users } from "lucide-react";
import UsersTab from "./settings/UsersTab";
import AuditTab from "./settings/AuditTab";
import { AiTab, ApiTab, CustomerMsgSection, GeneralTab, IntegrationTab, NotificationTab, useConfig } from "./settings/ConfigTabs";

const TABS = [
  { key: "general", label: "General", icon: SlidersHorizontal },
  { key: "api", label: "API Configuration", icon: Code2 },
  { key: "ai", label: "AI (Gemini)", icon: Bot },
  { key: "users", label: "User Management", icon: Users },
  { key: "notification", label: "Notification", icon: Bell },
  { key: "integration", label: "Integration", icon: Plug },
  { key: "audit", label: "Audit Log", icon: History },
] as const;
type Tab = (typeof TABS)[number]["key"];

export default function Settings({ me, myEmail, canMake, canCheck, canConfig, tab: initial }: { me: string; myEmail: string; canMake: boolean; canCheck: boolean; canConfig: boolean; tab: string }) {
  const [tab, setTab] = useState<Tab>(TABS.some((t) => t.key === initial) ? (initial as Tab) : "general");
  const { pub, setPub } = useConfig();
  const go = (t: Tab) => { setTab(t); history.replaceState(null, "", `/settings?tab=${t}`); };
  return (
    <>
      <div className="hdr"><div><h1 style={{ margin: 0 }}>Settings</h1>
        <span className="mute">System configuration, API access, users, notifications and integrations. Signed in as <b>{me}</b>{canMake && " · Maker"}{canCheck && " · Checker"}{canConfig ? " · Config editor" : " · read-only configuration"}.</span></div></div>
      <div className="auth-tabs tabs-ico" role="tablist" style={{ marginBottom: 16, flexWrap: "wrap" }}>
        {TABS.map(({ key, label, icon: Icon }) => <button key={key} role="tab" aria-selected={tab === key} onClick={() => go(key)}><Icon size={15} /> {label}</button>)}
      </div>
      {!canConfig && ["general", "api", "ai", "notification", "integration"].includes(tab) && <p className="mute">You can view the configuration. Editing needs the <code>settings.config</code> permission.</p>}
      {tab === "general" && <GeneralTab pub={pub} setPub={setPub} canEdit={canConfig} />}
      {tab === "api" && <ApiTab pub={pub} setPub={setPub} canEdit={canConfig} />}
      {tab === "ai" && <AiTab pub={pub} setPub={setPub} canEdit={canConfig} />}
      {tab === "users" && <UsersTab me={me} canMake={canMake} />}
      {tab === "notification" && <><NotificationTab pub={pub} setPub={setPub} canEdit={canConfig} myEmail={myEmail} /><CustomerMsgSection pub={pub} setPub={setPub} canEdit={canConfig} /></>}
      {tab === "integration" && <IntegrationTab pub={pub} setPub={setPub} canEdit={canConfig} />}
      {tab === "audit" && <AuditTab />}
    </>
  );
}
