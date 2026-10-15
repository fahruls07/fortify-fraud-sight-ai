import WorkflowEditor from "@/components/WorkflowEditor";
import { userCan } from "@/lib/session";

// /workflows/new opens an empty editor; saving it moves to /workflows/{id}.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <main className="full"><WorkflowEditor id={id === "new" ? null : id} canManage={await userCan("rules.manage")} canDeploy={await userCan("rules.activate")} /></main>;
}
