import Link from "next/link";
import type { ReactNode } from "react";
import { LANE_STATS } from "@/lib/mock";
import { getSession, listOrgs } from "@/lib/auth";
import { logoutAction } from "@/app/orgs/actions";

const NAV_ITEMS = [
  { href: "/", label: "Home" },
  { href: "/care-queue", label: "Care queue", badge: 17 },
  { href: "/lanes", label: "Activity / Lanes" },
  { href: "/shepherds", label: "Shepherds" },
  { href: "/people", label: "People", disabled: true },
  { href: "/groups", label: "Groups", disabled: true },
  { href: "/movement", label: "Movement", disabled: true },
];

export async function AppShell({
  children,
  active,
  breadcrumb,
}: {
  children: ReactNode;
  active: string;
  breadcrumb: string;
}) {
  const session = await getSession();
  const myOrgs = session ? listOrgs(session.user.id) : [];
  const otherOrgsExist = myOrgs.length > 1;

  return (
    <div className="flex min-h-screen bg-bg text-fg">
      <aside className="w-56 shrink-0 border-r border-border-soft px-4 py-5 text-sm hidden md:block">
        <Link href="/" className="flex items-center gap-2 mb-3 group">
          <span className="w-6 h-6 rounded grid place-items-center bg-accent text-[var(--accent-fg)]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12c0-3 3-6 9-6s9 3 9 6-3 6-9 6-9-3-9-6Z" />
            </svg>
          </span>
          <span className="font-semibold tracking-tight">Shepherding</span>
        </Link>
        {session?.orgName && (
          <div className="px-2 mb-5 text-xs text-muted">
            <div className="text-fg font-medium truncate">{session.orgName}</div>
            <div>
              {session.role === "admin" ? "Admin" : "Member"}
              {otherOrgsExist && (
                <Link href="/orgs" className="text-accent ml-2 hover:underline">
                  switch
                </Link>
              )}
            </div>
          </div>
        )}
        <div className="text-xs text-muted uppercase tracking-wider mb-2 px-2">Workspace</div>
        <ul className="space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const isActive = item.label === active;
            const baseClass =
              "px-2 py-1.5 rounded flex items-center justify-between transition-colors";
            const stateClass = isActive
              ? "bg-bg-elev-2 text-fg font-medium"
              : item.disabled
                ? "text-subtle cursor-default"
                : "text-fg hover:bg-bg-elev-2";
            return (
              <li key={item.href}>
                {item.disabled ? (
                  <span className={`${baseClass} ${stateClass}`}>
                    <span>{item.label}</span>
                    <span className="text-[10px] text-subtle">soon</span>
                  </span>
                ) : (
                  <Link href={item.href} className={`${baseClass} ${stateClass}`}>
                    <span>{item.label}</span>
                    {item.badge ? (
                      <span className="text-xs text-accent tnum">{item.badge}</span>
                    ) : null}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>

        <div className="text-xs text-muted uppercase tracking-wider mt-7 mb-2 px-2">Lanes</div>
        <ul className="space-y-0.5 text-sm">
          {LANE_STATS.map((lane) => (
            <li
              key={lane.key}
              className="px-2 py-1.5 rounded flex justify-between items-center text-fg hover:bg-bg-elev-2 cursor-default"
            >
              <span className="flex items-center gap-2">
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: `var(--lane-${lane.key})` }}
                />
                <span>{lane.label}</span>
              </span>
              <span className="text-muted tnum text-xs">{lane.count}</span>
            </li>
          ))}
        </ul>

        <div className="text-xs text-muted uppercase tracking-wider mt-7 mb-2 px-2">PCO</div>
        <ul className="space-y-0.5">
          <li>
            <Link
              href="/pco"
              className={`px-2 py-1.5 rounded flex items-center justify-between transition-colors ${
                active === "PCO"
                  ? "bg-bg-elev-2 text-fg font-medium"
                  : "text-fg hover:bg-bg-elev-2"
              }`}
            >
              <span>Sync settings</span>
            </Link>
          </li>
        </ul>

        {session && (
          <div className="mt-8 pt-4 border-t border-border-soft px-2">
            <div className="text-xs text-fg font-medium">{session.user.name}</div>
            <div className="text-xs text-muted truncate">{session.user.email}</div>
            <form action={logoutAction} className="mt-2">
              <button
                type="submit"
                className="text-xs text-muted hover:text-fg"
              >
                Sign out
              </button>
            </form>
          </div>
        )}
      </aside>

      <div className="flex-1 min-w-0">
        <header className="flex items-center justify-between border-b border-border-soft px-5 md:px-7 py-3 text-sm">
          <div className="flex items-center gap-2 text-muted min-w-0">
            <span className="hidden sm:inline">Workspace</span>
            <span className="hidden sm:inline">›</span>
            <span className="text-fg truncate">{breadcrumb}</span>
          </div>
          <div className="flex items-center gap-3">
            <input
              className="hidden lg:block bg-transparent border border-border-soft rounded px-3 py-1.5 text-sm w-72 placeholder:text-subtle"
              placeholder="Jump to person, group…  ⌘K"
            />
            <div
              className="w-7 h-7 rounded-full bg-bg-elev-2 grid place-items-center text-xs font-medium"
              title={session?.user.name}
            >
              {session ? initials(session.user.name) : "·"}
            </div>
          </div>
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
