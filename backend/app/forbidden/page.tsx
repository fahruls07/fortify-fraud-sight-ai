import Link from "next/link";

export default function Page() {
  return <main><div className="card empty-state"><h1>Access denied</h1><p className="mute">Your account does not have permission for this page. Ask a maker to request access and a checker to approve it in Settings.</p><Link className="btn" href="/">Back to home</Link></div></main>;
}
