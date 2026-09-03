<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Every page must be editable from Navigation

The home hub is built **only** from the org's nav config (`src/lib/hub-sections.ts`),
which is what `/settings/navigation` edits. Nothing else may render a hub layer —
a hardcoded section list is invisible to the editor, so it can't be renamed,
reordered, re-iconed or removed.

Adding a page? Give it one entry in `PAGE_REGISTRY` (`src/lib/nav-registry.ts`)
with its `href`, `defaultLabel`, the `active=` string it passes in
`activeAliases`, and the `description` shown on its hub card. That entry is all
it takes to be assignable to any layer from the editor. Optionally seed it into
a group in `DEFAULT_NAV_CONFIG` — and if you add a *new group* there, add its id
to `V2_GROUP_IDS` (and bump `NAV_CONFIG_VERSION`) so orgs with a saved layout
inherit it instead of never seeing it.
