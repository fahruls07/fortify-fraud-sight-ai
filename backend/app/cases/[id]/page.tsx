import { CaseDetail } from "@/components/Cases";
import { userCan } from "@/lib/session";

export default async function Page({ params }: { params: Promise<{ id: string }> }) { return <main><CaseDetail id={(await params).id} canEdit={await userCan("cases.manage")} /></main>; }
