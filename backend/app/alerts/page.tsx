import AlertsBoard from "@/components/AlertsBoard";
import { currentUser, userCan } from "@/lib/session";

export default async function Page() {
  return <main><AlertsBoard me={(await currentUser()) ?? ""} canAck={await userCan("alerts.investigate")} canResolve={await userCan("alerts.decide")} canCase={await userCan("cases.manage")} /></main>;
}
