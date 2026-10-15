import Approvals from "@/components/Approvals";
import { currentUser, userCan } from "@/lib/session";

export default async function Page() { return <main><Approvals me={(await currentUser())!} canCheck={await userCan("settings.checker")} /></main>; }
