// Shared, client-safe nav-section definitions for builder pages. Kept out of
// lib/builder.ts because that module is server-only, but the editor (a client
// component) needs the list too. The `value`s are group ids the sidebar
// resolves (see nav-registry DEFAULT_NAV_CONFIG; "settings" folds into the
// Settings & Integration group via nav-config-db SECTION_TO_GROUP). Labels
// track the default group headings.
export const NAV_SECTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "Not in the nav" },
  { value: "dashboard", label: "Dashboard" },
  { value: "leadership", label: "Leadership" },
  { value: "pco", label: "PCO data" },
  { value: "next-steps", label: "Next steps" },
  { value: "mappings", label: "Maps" },
  { value: "settings", label: "Settings & Integration" },
  { value: "more", label: "More" },
];

export const NAV_SECTION_VALUES = new Set(NAV_SECTIONS.map((s) => s.value).filter(Boolean));
