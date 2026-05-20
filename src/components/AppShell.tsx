import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { getSession, listOrgs } from "@/lib/auth";
import { logoutAction } from "@/app/orgs/actions";
import { CollapsibleNavGroup } from "./CollapsibleNavGroup";
import { SearchBar } from "./SearchBar";

const NAV_ITEMS = [
  { href: "/", label: "Home" },
  { href: "/care-queue", label: "Care queue", badge: 17 },
];

const LEADERSHIP_NAV_ITEMS = [
  { href: "/shepherd-team", label: "Shepherd team" },
  { href: "/shepherds", label: "Shepherds" },
];

const PCO_DATA_NAV_ITEMS = [
  { href: "/people", label: "People" },
  { href: "/groups", label: "Groups" },
  { href: "/teams", label: "Teams" },
  { href: "/checkins", label: "Check-ins" },
];

const OTHER_NAV_ITEMS = [
  { href: "/more", label: "See more" },
];

const SETTINGS_NAV_ITEMS = [
  { href: "/pco", label: "Sync" },
  { href: "/pco/filters", label: "Filters" },
  { href: "/metrics", label: "Metrics" },
  { href: "/shepherd-map", label: "Shepherd map" },
  { href: "/care-map", label: "Care map" },
];

const NEXT_STEPS_NAV_ITEMS = [
  { href: "/lanes", label: "Activity overview" },
  { href: "/lanes/list", label: "Lanes" },
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
      {/* Sticky sidebar — pinned to the viewport height with its own
          scroll, so the main content can be arbitrarily tall without
          stretching the nav. */}
      <aside className="w-56 shrink-0 border-r border-border-soft px-4 py-5 text-sm hidden md:flex md:flex-col sticky top-0 h-screen overflow-y-auto">
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
        <div className="text-xs text-muted uppercase tracking-wider mb-2 px-2">Dashboard</div>
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

        <div className="text-xs text-muted uppercase tracking-wider mt-7 mb-2 px-2">
          Leadership
        </div>
        <ul className="space-y-0.5">
          {LEADERSHIP_NAV_ITEMS.map((item) => {
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

        <CollapsibleNavGroup
          label="PCO data"
          items={PCO_DATA_NAV_ITEMS}
          active={active}
        />

        <div className="text-xs text-muted uppercase tracking-wider mt-7 mb-2 px-2">
          Next Steps Pathway
        </div>
        <ul className="space-y-0.5">
          {NEXT_STEPS_NAV_ITEMS.map((item) => {
            const isActive =
              item.label === active ||
              (item.label === "Activity overview" && active === "Activity / Lanes");
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

        <div className="text-xs text-muted uppercase tracking-wider mt-7 mb-2 px-2">Other</div>
        <ul className="space-y-0.5">
          {OTHER_NAV_ITEMS.map((item) => {
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
