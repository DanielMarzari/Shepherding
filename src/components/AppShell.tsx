import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { getSession, listOrgs } from "@/lib/auth";
import { resolveNavConfig } from "@/lib/nav-config-db";
import {
  ACTIVE_TO_KEY,
  DEFAULT_NAV_CONFIG,
  PAGE_REGISTRY,
} from "@/lib/nav-registry";
import { logoutAction } from "@/app/orgs/actions";
import { SidebarNav } from "./SidebarNav";
import { SearchBar } from "./SearchBar";

const SIDEBAR =
  "w-56 shrink-0 border-r border-border-soft px-4 py-5 text-sm hidden md:flex md:flex-col sticky top-0 h-screen overflow-y-auto";

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

  // Per-org configurable sidebar (falls back to the coded default). Highlight
  // resolves by page key via the registry, so renaming a heading/label in the
  // nav editor never breaks which row lights up.
  const { config, activeToKey } = session?.orgId
    ? resolveNavConfig(session.orgId)
    : { config: DEFAULT_NAV_CONFIG, activeToKey: ACTIVE_TO_KEY };
  const activeKey = active ? activeToKey[active] ?? null : null;

  return (
    <div className="flex min-h-screen bg-bg text-fg">
      <aside className={SIDEBAR}>
        <Link href="/" className="flex items-center gap-2 mb-3 group">
          <Image src="/icon.svg" alt="Shepherding" width={28} height={28} unoptimized className="shrink-0" />
          <span className="font-semibold tracking-tight">Shepherding</span>
        </Link>
        {session?.orgName && (
          <div className="px-2 mb-5 text-xs text-muted">
            <div className="text-fg font-medium truncate">{session.orgName}</div>
            <div>
              {session.role === "admin" ? "Admin" : "Member"}
              {otherOrgsExist && (
                <Link href="/orgs" className="text-accent ml-2 hover:underline">switch</Link>
              )}
            </div>
          </div>
        )}

        <SidebarNav groups={config.groups} activeKey={activeKey} />

        <div className="mt-auto pt-4">
          {session && (
            <div className="border-t border-border-soft pt-4 px-2 mb-3">
              <div className="text-xs text-fg font-medium">{session.user.name}</div>
              <div className="text-xs text-muted truncate">{session.user.email}</div>
              <form action={logoutAction} className="mt-2">
                <button type="submit" className="text-xs text-muted hover:text-fg">Sign out</button>
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

/** Static, DB-free shell for loading.tsx files. Renders the DEFAULT nav config
 *  (top-level groups + a single Settings & Integration entry), so the skeleton
 *  matches the live sidebar's structure without any DB work. */
export function AppShellSkeleton({
  children,
  active,
  breadcrumb,
}: {
  children: ReactNode;
  active?: string;
  breadcrumb?: string;
}) {
  const activeKey = active ? ACTIVE_TO_KEY[active] ?? null : null;
  return (
    <div className="flex min-h-screen bg-bg text-fg">
      <aside className={SIDEBAR}>
        <Link href="/" className="flex items-center gap-2 mb-3">
          <Image src="/icon.svg" alt="Shepherding" width={28} height={28} unoptimized className="shrink-0" />
          <span className="font-semibold tracking-tight">Shepherding</span>
        </Link>
        <div className="px-2 mb-5 h-8 rounded bg-bg-elev-2/40" />
        {DEFAULT_NAV_CONFIG.groups.map((group, i) => (
          <div key={group.id} className={i === 0 ? "" : "mt-7"}>
            <div className="text-xs text-muted uppercase tracking-wider mb-2 px-2">{group.label}</div>
            <ul className="space-y-0.5">
              {group.mode === "drill" ? (
                <li>
                  <span className="px-2 py-1.5 rounded flex items-center justify-between text-fg">
                    <span>Open</span>
                    <span aria-hidden className="text-subtle">›</span>
                  </span>
                </li>
              ) : (
                group.items.map((it) => {
                  if (it.kind !== "page") return null;
                  const def = PAGE_REGISTRY[it.pageKey];
                  if (!def) return null;
                  const isActive = it.pageKey === activeKey;
                  return (
                    <li key={it.pageKey}>
                      <Link
                        href={def.href}
                        className={`px-2 py-1.5 rounded flex items-center transition-colors ${
                          isActive ? "bg-bg-elev-2 text-fg font-medium" : "text-fg hover:bg-bg-elev-2"
                        }`}
                      >
                        {def.defaultLabel}
                      </Link>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        ))}
      </aside>
      <main className="flex-1 min-w-0">
        {breadcrumb && <div className="px-5 md:px-7 pt-5 text-xs text-muted">{breadcrumb}</div>}
        {children}
      </main>
    </div>
  );
}
