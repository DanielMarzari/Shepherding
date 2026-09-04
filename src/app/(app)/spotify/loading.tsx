import { PageSkeleton } from "@/components/PageSkeleton";

export default function SpotifyLoading() {
  return (
    <PageSkeleton
      title="Spotify"
      active="Spotify"
      breadcrumb="Settings & Integration › Spotify"
      statCount={0}
      contentRows={0}
    >
      <div className="space-y-4 max-w-3xl">
        <div className="h-64 rounded-xl bg-bg-elev-2/40" />
        <div className="h-40 rounded-xl bg-bg-elev-2/40" />
      </div>
    </PageSkeleton>
  );
}
