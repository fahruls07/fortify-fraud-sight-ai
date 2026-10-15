import FraudReport from "@/components/FraudReport";
import { userCan } from "@/lib/session";

export default async function Page() { return <main><FraudReport canExport={await userCan("reports.export")} /></main>; }
