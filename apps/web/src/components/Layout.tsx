import { NavLink, Outlet } from "react-router-dom";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

const NAV = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/posts", label: "Intelligence Feed" },
  { to: "/monitors", label: "Monitors" },
  { to: "/watchlists", label: "Watchlists" },
  { to: "/rules", label: "Rules" },
  { to: "/alerts", label: "Alerts" },
  { to: "/digests", label: "Digests" },
  { to: "/sources", label: "Sources" },
  { to: "/usage", label: "Usage & Cost" },
  { to: "/settings", label: "Settings" },
  { to: "/system", label: "System" },
];

export function Layout() {
  const qc = useQueryClient();
  const [cacheMsg, setCacheMsg] = useState<string | null>(null);
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem("xie-theme");
    if (saved) return saved === "dark";
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("xie-theme", dark ? "dark" : "light");
  }, [dark]);

  return (
    <div className="min-h-full bg-bg text-fg">
      <div className="flex min-h-screen">
        <aside className="w-56 shrink-0 border-r border-line bg-panel/40 p-4">
          <div className="mb-6">
            <div className="text-sm font-semibold tracking-tight text-fg">X Intelligence Engine</div>
            <div className="text-xs text-fg-subtle">XIE · analyst console</div>
          </div>
          <nav aria-label="Primary" className="space-y-1">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `block rounded px-3 py-1.5 text-sm ${isActive ? "bg-sky-600/20 text-sky-300" : "text-fg-muted hover:bg-elevated hover:text-fg"}`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="mt-6 space-y-1 border-t border-line pt-3">
            <button
              onClick={() => setDark((d) => !d)}
              className="block w-full rounded px-3 py-1.5 text-left text-xs text-fg-muted hover:bg-elevated"
            >
              Toggle {dark ? "light" : "dark"} theme
            </button>
            <button
              onClick={() => {
                qc.clear();
                setCacheMsg("Client cache cleared");
                setTimeout(() => setCacheMsg(null), 2000);
              }}
              className="block w-full rounded px-3 py-1.5 text-left text-xs text-fg-muted hover:bg-elevated"
            >
              Clear cache
            </button>
            {/* Cloudflare Access logout — clears the SSO session for this hostname. */}
            <a
              href="/cdn-cgi/access/logout"
              className="block w-full rounded px-3 py-1.5 text-left text-xs text-fg-muted hover:bg-elevated"
            >
              Log out
            </a>
            {cacheMsg && <div className="px-3 text-xs text-teal-400">{cacheMsg}</div>}
          </div>
        </aside>
        <main className="flex-1 overflow-x-hidden p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
