/** Route-level skeleton that paints on every navigation INTO an /(app)
 *  route — including the home page — while the server component for
 *  that page does its data fetching. Without this, the user stares at
 *  the OLD page until the new one is fully rendered, since better-
 *  sqlite3 is synchronous and queries don't yield to React's streaming
 *  scheduler.
 *
 *  We intentionally don't try to mirror the destination route's exact
 *  shape — that's what per-page Suspense fallbacks are for. This is the
 *  "something is happening" placeholder for the initial navigation. */
export default function AppRouteLoading() {
  return (
    <div className="flex min-h-screen bg-bg text-fg">
      <aside className="w-56 shrink-0 border-r border-border-soft px-4 py-5 hidden md:block" />
      <main className="flex-1 px-5 md:px-7 py-7">
        <div className="animate-pulse">
          <div className="h-3 w-32 bg-bg-elev-2 rounded mb-3" />
          <div className="h-7 w-56 bg-bg-elev-2/70 rounded mb-2" />
          <div className="h-3 w-80 bg-bg-elev-2/50 rounded mb-7" />
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            {Array.from({ length: 5 }, (_, i) => (
              <div
                key={i}
                className="rounded-[10px] bg-bg-elev border border-border-soft p-4 h-24"
              />
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-3">
            <div className="lg:col-span-2 rounded-[10px] bg-bg-elev border border-border-soft h-72" />
            <div className="rounded-[10px] bg-bg-elev border border-border-soft h-72" />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {Array.from({ length: 3 }, (_, i) => (
              <div
                key={i}
                className="rounded-[10px] bg-bg-elev border border-border-soft h-56"
              />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
