import { CustomerProfile } from "@/components/Explore";

export default async function Page({ params }: { params: Promise<{ id: string }> }) { return <main><CustomerProfile id={(await params).id} /></main>; }
