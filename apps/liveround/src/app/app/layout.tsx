import Link from "next/link";
import type { ReactNode } from "react";
import { auth, signOut } from "@/auth";
import { Wordmark } from "@/components/wordmark";
import { getUserById } from "@/lib/db/store";
import { redirect } from "next/navigation";

const NAV = [
  { href: "/app/session", label: "Session" },
  { href: "/app/campaigns", label: "Campaigns" },
  { href: "/app/ideas", label: "Ideas" },
  { href: "/app/contacts", label: "Contacts" },
  { href: "/app/log", label: "Log" },
  { href: "/app/stats", label: "Stats" },
  { href: "/app/settings", label: "Settings" },
];

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const user = await getUserById(session.user.id);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-line px-4 py-3 md:px-6">
        <div className="flex items-center gap-6">
          <Link href="/app/session">
            <Wordmark />
          </Link>
          <nav className="hidden items-center gap-4 md:flex">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="text-sm text-muted hover:text-ink min-h-11 inline-flex items-center">
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm text-muted">
          <span className="hidden sm:inline tabular">
            {user ? `${user.planCredits + user.permanentCredits} cr` : ""}
          </span>
          <span className="hidden sm:inline truncate max-w-40">{session.user.email}</span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button type="submit" className="min-h-11 text-sm hover:text-ink">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <nav className="flex flex-wrap gap-x-4 gap-y-0 border-b border-line px-4 py-1 md:hidden" aria-label="App">
        {NAV.map((item) => (
          <Link key={item.href} href={item.href} className="text-sm text-muted hover:text-ink min-h-11 inline-flex items-center">
            {item.label}
          </Link>
        ))}
      </nav>
      <div id="app-main" className="flex-1">
        {children}
      </div>
    </div>
  );
}
