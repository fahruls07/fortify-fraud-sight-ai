import Settings from "@/components/Settings";
import { getAccess } from "@/lib/acm";
import { currentUser, userCan } from "@/lib/session";

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const me = (await currentUser())!;
  return <main><Settings me={me} myEmail={getAccess(me).email ?? ""} tab={(await searchParams).tab ?? "general"}
    canMake={await userCan("settings.maker")} canCheck={await userCan("settings.checker")} canConfig={await userCan("settings.config")} /></main>;
}
