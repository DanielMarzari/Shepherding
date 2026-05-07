import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { LANE_STATS } from "@/lib/mock";
import { getSession, listOrgs } from "@/lib/auth";
import { logoutAction } from "@/app/orgs/actions";
import { SearchBar } from "./SearchBar";

const NAV_ITEMS = [
  { href: "/", label: "Home" },
  { href: "/care-queue", label: "Care queue", badge: 17 },
  { href: "/lanes", label: "Activity / Lanes" },
  { href: "/shepherds", label: "Shepherds" },
  { href: "/people", label: "People" },
  { href: "/groups", label: "Groups" },
  { href: "/movement", label: "Movement" },
];

const SETTINGS_NAV_ITEMS = [
  { href: "/pco", label: "Sync" },
  { href: "/pco/filters", label: "Filters" },
  { href: "/attendance", label: "Attendance" },
  { href: "/metrics", label: "Metrics" },
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
      <aside className="w-56 shrink-0 border-r border-border-soft px-4 py-5 text-sm hidden md:flex md:flex-col">
        <Link href="/" className="flex items-center gap-2 mb-3 group">
          <Image
            src="/icon.svg"
            alt="Shepherding"
            width={28}
            height={28}
            unoptimized
            className="shrink-0"
          />
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
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`px-2 py-1.5 rounded flex items-center justify-between transition-colors ${
                    isActive
                      ? "bg-bg-elev-2 text-fg font-medium"
                      : "text-fg hover:bg-bg-elev-2"
                  }`}
                >
                  <span>{item.label}</span>
                  {item.badge ? (
                    <span className="text-xs text-accent tnum">{item.badge}</span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="text-xs text-muted uppercase tracking-wider mt-7 mb-2 px-2">Lanes</div>
        <ul className="space-y-0.5 text-sm">
          {LANE_STATS.map((lane) => {
            const isActive = active === `lane:${lane.key}`;
            return (
              <li key={lane.key}>
                <Link
                  href={`/lanes/${lane.key}`}
                  className={`px-2 py-1.5 rounded flex justify-between items-center transition-colors ${
                    isActive
                      ? "bg-bg-elev-2 text-fg font-medium"
                      : "text-fg hover:bg-bg-elev-2"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: `var(--lane-${lane.key})` }}
                    />
                    <span>{lane.label}</span>
                  </span>
                  <span className="text-muted tnum text-xs">{lane.count}</span>
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="text-xs text-muted uppercase tracking-wider mt-7 mb-2 px-2">Settings</div>
        <ul className="space-y-0.5">
          {SETTINGS_NAV_ITEMS.map((item) => {
            const isActive = item.label === active;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`px-2 py-1.5 rounded flex items-center justify-between transition-colors ${
                    isActive
                      ? "bg-bg-elev-2 text-fg font-medium"
                      : "text-fg hover:bg-bg-elev-2"
                  }`}
                >
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="mt-auto pt-4">
          {session && (
            <div className="border-t border-border-soft pt-4 px-2 mb-3">
              <div className="text-xs text-fg font-medium">{session.user.name}</div>
              <div className="text-xs text-muted truncate">{session.user.email}</div>
              <form action={logoutAction} className="mt-2">
                <button type="submit" className="text-xs text-muted hover:text-fg">
                  Sign out
                </button>
              </form>
            </div>
          )}
          <p className="px-2 text-[10px] text-subtle leading-relaxed">
            Sheep icon by{" "}
            <a
              href="https://www.flaticon.com/free-icons/sheep"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted hover:text-fg underline"
              title="sheep icons"
            >
              Freepik · Flaticon
            </a>
          </p>
        </div>
      </aside>

      <div className="flex-1 min-w-0">
        <header className="flex items-center justify-between border-b border-border-soft px-5 md:px-7 py-3 text-sm">
          <div className="flex items-center gap-2 text-muted min-w-0">
            <span className="text-fg truncate">{breadcrumb}</span>
          </div>
          <div className="flex items-center gap-3">
            <SearchBar />
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
