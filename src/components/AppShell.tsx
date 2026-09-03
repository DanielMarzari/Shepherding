import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { getSession } from "@/lib/auth";
import { SearchBar } from "./SearchBar";
import { UserMenu } from "./UserMenu";
import { NavRail } from "./NavRail";

// There is no left sidebar anymore — navigation lives on the home hub (the
// See-More-style gallery) reached via the logo, and the account menu floats
// top-right on every page. AppShell is now just the slim top bar + content.

const TOPBAR =
  "sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border-soft bg-bg/90 backdrop-blur px-5 md:px-7 py-2.5";

function Brand({ breadcrumb }: { breadcrumb?: string }) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <Link href="/" className="flex items-center gap-2 shrink-0 group" title="Home">
        <Image src="/icon.svg" alt="Shepherding" width={26} height={26} unoptimized className="shrink-0" />
        <span className="font-semibold tracking-tight hidden sm:inline group-hover:text-accent transition-colors">
          Shepherding
        </span>
      </Link>
      {breadcrumb && breadcrumb !== "Home" && (
        <>
          <span className="text-border-soft select-none" aria-hidden>/</span>
          <span className="text-sm text-muted truncate">{breadcrumb}</span>
        </>
      )}
    </div>
  );
}

export async function AppShell({
  children,
  active,
  breadcrumb,
  rail = true,
}: {
  children: ReactNode;
  active: string;
  breadcrumb: string;
  /** Set false on pages that render the full GalleryHub themselves (Home,
   *  Settings) — they already show the navigation, so a rail would double up. */
  rail?: boolean;
}) {
  const session = await getSession();
  const name = session?.user.name ?? "";
  return (
    <div className="min-h-screen bg-bg text-fg" data-active={active}>
      <header className={TOPBAR}>
        <Brand breadcrumb={breadcrumb} />
        <div className="flex items-center gap-3 shrink-0">
          <SearchBar />
          {session ? (
            <UserMenu name={name} email={session.user.email} initials={initials(name)} />
          ) : (
            <div className="w-8 h-8 rounded-full bg-bg-elev-2 grid place-items-center text-xs font-medium">·</div>
          )}
        </div>
      </header>
      <div className="flex items-stretch">
        {rail && session?.orgId != null && <NavRail active={active} orgId={session.orgId} />}
        <main className="flex-1 min-w-0">{children}</main>
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

/** Static, DB-free shell for loading.tsx files — the top bar without the
 *  session-dependent bits. */
export function AppShellSkeleton({
  children,
  breadcrumb,
}: {
  children: ReactNode;
  active?: string;
  breadcrumb?: string;
}) {
  return (
    <div className="min-h-screen bg-bg text-fg">
      <header className={TOPBAR}>
        <Brand breadcrumb={breadcrumb} />
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-8 h-8 rounded-full bg-bg-elev-2/60" />
        </div>
      </header>
      <div className="flex items-stretch">
        {/* Reserve the rail's width so the page doesn't jump when it loads. */}
        <div className="shrink-0 w-44 lg:w-52 border-r border-border-soft bg-bg-elev-2/30 hidden md:block" />
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}
