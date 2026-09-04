import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Card, CardHeader } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { DEFAULT_SPOTIFY_ARTIST_ID, getStoredSpotifyCreds } from "@/lib/spotify";
import { SpotifyCredentialsCard } from "./credentials-card";

export const dynamic = "force-dynamic";

export default async function SpotifyPage() {
  const session = await requireOrg();
  const creds = getStoredSpotifyCreds(session.orgId);

  return (
    <AppShell active="Spotify" breadcrumb="Settings & Integration › Spotify">
      <div className="px-5 md:px-7 py-7 space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Spotify</h1>
          <p className="text-muted text-sm mt-1">
            Connects the church&apos;s own music catalogue to the{" "}
            <Link
              href="/builder/mir-worship-original-music"
              className="text-accent hover:underline"
            >
              Worship &ndash; Original Music
            </Link>{" "}
            ministry impact report.
          </p>
        </div>

        <SpotifyCredentialsCard
          initial={creds}
          isAdmin={session.role === "admin"}
          defaultArtistId={DEFAULT_SPOTIFY_ARTIST_ID}
        />

        <Card>
          <CardHeader title="What this connection can and can't answer" />
          <div className="p-5 text-xs text-muted leading-relaxed space-y-3">
            <p>
              Spotify&apos;s API has two quite different halves, and only one of
              them is reachable with an app key. Worth knowing before anyone
              expects a number this can&apos;t produce.
            </p>
            <div>
              <span className="text-fg font-medium">This key can read:</span>{" "}
              the released catalogue &mdash; every album, EP, single and track.
              That answers{" "}
              <span className="text-fg">&ldquo;# songs released&rdquo;</span> and{" "}
              <span className="text-fg">&ldquo;# songs produced&rdquo;</span> on
              the report, and gives an authoritative title list to check the
              service-plan song matching against. Use{" "}
              <span className="text-fg">Sync catalogue</span> above after a new
              release.
            </div>
            <div>
              <span className="text-fg font-medium">
                This key cannot read a follower count.
              </span>{" "}
              Measured against this key on 4 Sep 2026: Spotify omits{" "}
              <code className="text-[11px]">followers</code>,{" "}
              <code className="text-[11px]">popularity</code> and{" "}
              <code className="text-[11px]">genres</code> from the artist
              response entirely &mdash; for every artist, not just ours &mdash;
              and returns 403 on top-tracks. That is how Spotify treats an app
              key in development mode. The page says &ldquo;not reported&rdquo;
              rather than showing a zero, because zero would be wrong.
            </div>
            <div>
              <span className="text-fg font-medium">Nothing here reads:</span>{" "}
              monthly listeners, stream counts, downloads or listener
              demographics &mdash; none are in the Web API at any tier. Monthly
              listeners and per-track play counts ARE public on the artist page
              (96 listeners and 33,797 plays when last checked); the rest live in
              Spotify for Artists, whose export is a manual CSV.
            </div>
            <p className="text-subtle">
              Credentials are used server-side only. The client-credentials flow
              reads public catalogue data and never touches a personal Spotify
              account, so the redirect URI the dashboard insists on at
              app-creation time is never used.
            </p>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
