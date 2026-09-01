import type { ReactNode } from "react";

// A curated line-icon set for nav layers. Pure SVG (no hooks), so it renders in
// both server and client components. Unknown ids render nothing.
const PATHS: Record<string, ReactNode> = {
  layers: (<><path d="m12 2 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5" /><path d="m3 17 9 5 9-5" /></>),
  home: (<><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></>),
  people: (<><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M16 6a3 3 0 0 1 0 6M21 20a6 6 0 0 0-4-5.7" /></>),
  person: (<><circle cx="12" cy="7" r="3.2" /><path d="M5 21a7 7 0 0 1 14 0" /></>),
  heart: (<path d="M12 20s-7-4.5-9.5-9A5 5 0 0 1 12 6a5 5 0 0 1 9.5 5c-2.5 4.5-9.5 9-9.5 9Z" />),
  calendar: (<><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></>),
  chart: (<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />),
  map: (<path d="m9 4-6 3v13l6-3 6 3 6-3V4l-6 3-6-3zM9 4v13M15 7v13" />),
  mail: (<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>),
  gift: (<><rect x="3" y="8" width="18" height="4" rx="1" /><path d="M12 8v13M5 12v9h14v-9" /><path d="M12 8S10.5 3 8 3 5.5 6 8 6s4 2 4 2 2-2 4-2 2.5-3 0-3-4 5-4 5" /></>),
  shield: (<path d="M12 3l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V6z" />),
  wrench: (<path d="M14 7a4 4 0 0 1-5 5L4 17l3 3 5-5a4 4 0 0 0 5-5z" />),
  book: (<><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" /><path d="M19 3v18" /></>),
  flag: (<path d="M5 21V4h11l-2 4 2 4H5" />),
  star: (<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17.8 6.6 20l1-6.1L3.2 9.5l6.1-.9L12 3Z" />),
  compass: (<><circle cx="12" cy="12" r="9" /><path d="m15 9-2 5-5 2 2-5 5-2Z" /></>),
  church: (<path d="M4 21V9l8-5 8 5v12M9 21v-6h6v6M12 4V1M10 3h4" />),
  graph: (<><circle cx="6" cy="6" r="2.4" /><circle cx="18" cy="18" r="2.4" /><circle cx="18" cy="6" r="2.4" /><path d="M8 7l8 9M18 8.4v7.2" /></>),
  clipboard: (<><rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 4V3h6v1M9 10h6M9 14h4" /></>),
  bolt: (<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />),
};

/** Icon ids offered in the nav builder's picker (order shown). */
export const NAV_ICONS: Array<{ id: string; label: string }> = [
  { id: "layers", label: "Layers" },
  { id: "home", label: "Home" },
  { id: "people", label: "People" },
  { id: "person", label: "Person" },
  { id: "heart", label: "Care" },
  { id: "calendar", label: "Calendar" },
  { id: "chart", label: "Reports" },
  { id: "map", label: "Map" },
  { id: "mail", label: "Mail" },
  { id: "gift", label: "Giving" },
  { id: "shield", label: "Audit" },
  { id: "wrench", label: "Tools" },
  { id: "book", label: "Book" },
  { id: "flag", label: "Flag" },
  { id: "star", label: "Star" },
  { id: "compass", label: "Explore" },
  { id: "church", label: "Church" },
  { id: "graph", label: "Network" },
  { id: "clipboard", label: "Tasks" },
  { id: "bolt", label: "Activity" },
];

export function NavIcon({
  id,
  size = 16,
  className,
}: {
  id: string | undefined;
  size?: number;
  className?: string;
}) {
  const p = id ? PATHS[id] : null;
  if (!p) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {p}
    </svg>
  );
}
