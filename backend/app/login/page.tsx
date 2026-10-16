import LoginForm from "@/components/LoginForm";

export const metadata = { title: "Sign in — FraudSight AI" };

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const n = (await searchParams).next;
  const next = n?.startsWith("/") && !n.startsWith("//") ? n : "/"; // same-origin paths only, no open redirect
  return (
    <div className="auth">
      <section className="auth-side">
        <div className="brand"><img className="logo" src="/logo-app.png" alt="FraudSight AI" width={686} height={176} /></div>
        <div>
          <p className="auth-lead">Suspicious transaction investigation console for the Anti-Fraud team.</p>
          <ul className="auth-facts">
            <li>The alert queue updates live as transfers are held.</li>
            <li>Assistant summarizes session signals, customer history, and the account network.</li>
            <li>Every decision is recorded in the audit log with its reason.</li>
          </ul>
        </div>
        <small>Access restricted to registered analysts.</small>
      </section>
      <section className="auth-main"><LoginForm next={next} /></section>
    </div>
  );
}
