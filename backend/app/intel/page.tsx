import Intel from "@/components/Intel";
import { userCan } from "@/lib/session";

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  return <main><Intel canManage={await userCan("intel.manage")} tab={(await searchParams).tab ?? "lists"} /></main>;
}
