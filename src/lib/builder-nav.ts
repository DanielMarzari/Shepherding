// Shared, client-safe nav-section definitions for builder pages. Kept out of
// lib/builder.ts because that module is server-only, but the editor (a client
// component) needs the list too. The `value`s must match the section keys the
// sidebar (components/AppShell.tsx) reads via nb(<key>).
export const NAV_SECTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "Not in the nav" },
  { value: "dashboard", label: "Dashboard" },
  { value: "leadership", label: "Leadership" },
  { value: "pco", label: "PCO data" },
  { value: "next-steps", label: "Next Steps Pathway" },
  { value: "mappings", label: "Data Mappings" },
  { value: "settings", label: "Settings" },
  { value: "more", label: "Other (near “See more”)" },
];

export const NAV_SECTION_VALUES = new Set(NAV_SECTIONS.map((s) => s.value).filter(Boolean));
