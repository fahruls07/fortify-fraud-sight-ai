import Link from "next/link";
import RuleBuilder from "@/components/RuleBuilder";
import { userCan } from "@/lib/session";

export default async function Page() {
  return (
    <main>
      <p><Link className="button ico-btn" href="/rules">← Back to rules</Link></p>
      <h1 style={{ marginBottom: 4 }}>New rule</h1><p className="mute" style={{ margin: "0 0 16px" }}>Describe the rule for AI, or drag conditions and actions onto the canvas and connect them.</p>
      <RuleBuilder canManage canActivate={await userCan("rules.activate")} />
    </main>
  );
}
