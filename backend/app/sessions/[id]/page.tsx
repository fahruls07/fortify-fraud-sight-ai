import { SessionView } from "@/components/Explore";
import { userCan } from "@/lib/session";

export default async function Page({ params }: { params: Promise<{ id: string }> }) { return <main><SessionView id={(await params).id} canComment={await userCan("cases.manage")} /></main>; }
