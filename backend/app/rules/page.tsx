import RuleList from "@/components/RuleList";
import { userCan } from "@/lib/session";

export default async function Page() { return <main><RuleList canManage={await userCan("rules.manage")} canActivate={await userCan("rules.activate")} /></main>; }
