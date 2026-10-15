import WorkflowList from "@/components/WorkflowList";
import { userCan } from "@/lib/session";

export default async function Page() { return <main><WorkflowList canManage={await userCan("rules.manage")} canDeploy={await userCan("rules.activate")} /></main>; }
