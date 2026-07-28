# Page design references

Snapshots of the original hand-coded pages, kept as the design spec while the
app's pages are rebuilt out of Page Builder widgets (see the builder-remodel
initiative). These files are **archived, not compiled** — `reference/` is
excluded from `tsconfig.json` and ESLint, and lives outside `src/app` so nothing
here is a route.

- `pages/` — the original `page.tsx` (and closely-coupled components) for each
  route before it was overridden to render its editable builder page in place.
  The live route now lives at the same path under `src/app/(app)/…` and renders
  the seeded builder page; edit it in-app (admin → Edit) or adjust its seed in
  `src/lib/builder-seeds.ts`.
- `screenshots/` — authenticated screenshots of each page's original design.

## Converted pages

| Route | Original design | Builder seed | Status |
|-------|-----------------|--------------|--------|
| `/checkins` | `pages/checkins.tsx` | `builder-seeds.ts` → `checkins` | ✅ overridden |

_Next Campus Planner is intentionally excluded from the remodel._
