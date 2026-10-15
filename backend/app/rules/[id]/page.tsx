import Link from "next/link";
import RuleBuilder from "@/components/RuleBuilder";
import { userCan } from "@/lib/session";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main>
      <p><Link className="button ico-btn" href="/rules">← Back to rules</Link></p>
      <h1 style={{ marginBottom: 4 }}>Rule {id}</h1><p className="mute" style={{ margin: "0 0 16px" }}>Edit the workflow and details, then save. Backtest shows what the rule would catch.</p>
      <RuleBuilder ruleId={id} canManage={await userCan("rules.manage")} canActivate={await userCan("rules.activate")} />
    </main>
  );
}
