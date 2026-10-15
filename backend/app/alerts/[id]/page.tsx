import Link from "next/link";
import AlertDetail from "@/components/AlertDetail";
import { userCan } from "@/lib/session";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <main><p><Link href="/alerts">← Alert Queues</Link></p><AlertDetail id={(await params).id} canCase={await userCan("cases.manage")} /></main>;
}
