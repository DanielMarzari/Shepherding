import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { CHURCH, countPendingGeo, getMemberGeoPoints } from "@/lib/geocode";
import { MemberMap } from "./member-map";
import { GeocodeButton } from "./geocode-button";

const LEGEND: Array<{ label: string; color: string }> = [
  { label: "Faith Church", color: "#ef4444" },
  { label: "Shepherded", color: "#5dc8a8" },
  { label: "Active", color: "#3b82f6" },
  { label: "Present", color: "#f59e0b" },
];

export default async function MapPage() {
  const session = await requireOrg();
  const points = getMemberGeoPoints(session.orgId);
  const pending = countPendingGeo(session.orgId);
  const isAdmin = session.role === "admin";

  return (
    <AppShell active="See more" breadcrumb="See more › Map">
      <div className="px-5 md:px-7 py-7 space-y-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Member map</h1>
            <p className="text-muted text-sm mt-1 max-w-2xl">
              Where your people live, anchored on {CHURCH.name} (
              {CHURCH.address}). Addresses are geocoded with the free US
              Census geocoder and cached — coordinates stay on the server and
              are only shown to signed-in staff.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap text-xs text-muted">
            <span>{points.length.toLocaleString()} plotted</span>
            {pending > 0 && (
              <span className="text-subtle">· {pending.toLocaleString()} not geocoded yet</span>
            )}
            <span className="mx-1 w-px h-3 bg-border-soft" />
            {LEGEND.map((l) => (
              <span key={l.label} className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full"
                  style={{ background: l.color }}
                />
                {l.label}
              </span>
            ))}
          </div>
          {isAdmin && <GeocodeButton pending={pending} />}
        </div>

        {points.length === 0 ? (
          <Card className="p-10 text-center text-sm text-muted">
            No addresses geocoded yet.{" "}
            {isAdmin
              ? "Click “Geocode” above to start placing your active members on the map."
              : "An admin needs to run geocoding first."}
          </Card>
        ) : (
          <MemberMap church={CHURCH} points={points} />
        )}

        {pending > 0 && isAdmin && (
          <p className="text-xs text-subtle max-w-2xl">
            Geocoding runs in batches of 150 to stay friendly to the free
            Census API — click again to keep going until everyone&apos;s
            placed. Only active adults are geocoded.
          </p>
        )}
      </div>
    </AppShell>
  );
}
