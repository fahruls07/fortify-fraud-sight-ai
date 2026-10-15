import { cookies } from "next/headers";
import Shell from "@/components/Shell";
import { getAccess } from "@/lib/acm";
import { config } from "@/lib/settings";
import { COOKIE, lastLogin, verifySession } from "@/lib/auth";
import "./globals.css";

export const generateMetadata = () => ({ title: `${config().general.appName} Console` });

// Runs before paint so a saved/system dark theme doesn't flash light first.
const theme = `try{var t=localStorage.getItem("theme")||(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.dataset.theme=t}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = verifySession((await cookies()).get(COOKIE)?.value);
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" />
        <script dangerouslySetInnerHTML={{ __html: theme }} />
      </head>
      <body>{user ? <Shell user={user} lastLogin={lastLogin(user)} perms={getAccess(user).perms} appName={config().general.appName}>{children}</Shell> : children}</body>
    </html>
  );
}
