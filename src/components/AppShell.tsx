import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { getSession } from "@/lib/auth";
import { SearchBar } from "./SearchBar";
import { UserMenu } from "./UserMenu";
import { GalleryHub } from "./GalleryHub";
import { buildHubSections } from "@/lib/hub-sections";
import { getPinnedKeys } from "@/lib/nav-config-db";

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
  /** Set false on pages that render the hub themselves (Home, Settings,
   *  Settings > Navigation, See more) — they already show the navigation, so
   *  wrapping them again would nest one hub inside another. */
  rail?: boolean;
}) {
  const session = await getSession();
  const name = session?.user.name ?? "";
  const useHub = rail && session?.orgId != null;
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
      <main>
        {useHub ? (
          // Every page opens INSIDE the hub, exactly like the home page: the
          // floating rail of layers on the left, this page's content in the
          // detail pane on the right. `active` names the page in the rail, and
          // it's selected by default because it's the first entry.
          <div className="px-5 md:px-7 py-7">
            <GalleryHub
              sections={buildHubSections(session!.orgId!)}
              pinned={getPinnedKeys(session!.orgId!, session!.user.id)}
              homeLabel={active}
              homeContent={children}
            />
          </div>
        ) : (
          children
        )}
      </main>
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
      <main className="px-5 md:px-7 py-7">
        {/* Mirror the hub's shape so the page doesn't jump when it loads. */}
        <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-0 rounded-xl border border-border-soft overflow-hidden">
          <div className="bg-bg-elev-2/40 border-b md:border-b-0 md:border-r border-border-soft p-2.5 md:p-3" />
          <div className="p-4 md:p-5 min-w-0">{children}</div>
        </div>
      </main>
    </div>
  );
}
