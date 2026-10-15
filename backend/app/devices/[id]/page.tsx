import { DevicePage } from "@/components/Explore";

export default async function Page({ params }: { params: Promise<{ id: string }> }) { return <main><DevicePage id={decodeURIComponent((await params).id)} /></main>; }
