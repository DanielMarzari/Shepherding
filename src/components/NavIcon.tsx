import type { ReactNode } from "react";

// Line-icon set for nav layers. Pure SVG (no hooks) so it renders in both
// server and client components. Unknown ids render nothing. PATHS is the full
// render map; NAV_ICONS (below) is the curated list the picker offers.
const PATHS: Record<string, ReactNode> = {
  gear: (<><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>),
  sliders: (<><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" /><circle cx="15" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="18" r="2" /></>),
  home: (<><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></>),
  people: (<><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M16 6a3 3 0 0 1 0 6M21 20a6 6 0 0 0-4-5.7" /></>),
  person: (<><circle cx="12" cy="7" r="3.4" /><path d="M5 21a7 7 0 0 1 14 0" /></>),
  community: (<><circle cx="9" cy="8" r="2.8" /><circle cx="16.5" cy="10" r="2.4" /><path d="M3 19a6 6 0 0 1 11-3.2M21 19a4.4 4.4 0 0 0-5-3.6" /></>),
  "user-plus": (<><circle cx="9" cy="8" r="3.2" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M18 8v6M15 11h6" /></>),
  heart: (<path d="M12 20s-7-4.5-9.5-9A5 5 0 0 1 12 6a5 5 0 0 1 9.5 5c-2.5 4.5-9.5 9-9.5 9Z" />),
  handshake: (<><path d="M8 13 5.2 10.2a2 2 0 0 1 2.8-2.8L11 10.4M16 13l2.8-2.8a2 2 0 0 0-2.8-2.8L13 10.4" /><path d="m8 13 2 2a1.2 1.2 0 0 0 1.7 0l.5-.5.6.6a1.2 1.2 0 0 0 1.7 0L16.5 13" /><path d="M2.5 9.5v4M21.5 9.5v4" /></>),
  calendar: (<><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></>),
  clock: (<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>),
  "chart-bar": (<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />),
  "chart-pie": (<><circle cx="12" cy="12" r="9" /><path d="M12 12V3M12 12l7.8 4.5" /></>),
  "chart-line": (<><path d="M4 4v16h16" /><path d="m4 15 4-4 4 3 7-8" /></>),
  grid: (<><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>),
  table: (<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M3 15h18M9 4v16M15 4v16" /></>),
  list: (<><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="3.6" cy="6" r="1.1" /><circle cx="3.6" cy="12" r="1.1" /><circle cx="3.6" cy="18" r="1.1" /></>),
  map: (<path d="m9 4-6 3v13l6-3 6 3 6-3V4l-6 3-6-3zM9 4v13M15 7v13" />),
  pin: (<><path d="M12 21s-6-5.5-6-10a6 6 0 0 1 12 0c0 4.5-6 10-6 10Z" /><circle cx="12" cy="11" r="2.3" /></>),
  globe: (<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.6 2.6 2.6 15 0 18M12 3c-2.6 2.6-2.6 15 0 18" /></>),
  compass: (<><circle cx="12" cy="12" r="9" /><path d="m15 9-2 5-5 2 2-5 5-2Z" /></>),
  route: (<><circle cx="6" cy="19" r="2.5" /><circle cx="18" cy="5" r="2.5" /><path d="M8.5 19H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5" /></>),
  funnel: (<path d="M3 5h18l-7 8v6l-4-2v-4L3 5Z" />),
  target: (<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.4" /></>),
  mail: (<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>),
  bell: (<><path d="M18 9a6 6 0 1 0-12 0c0 6-2 8-2 8h16s-2-2-2-8Z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>),
  megaphone: (<><path d="M4 10v4h3l10 5V5L7 10H4Z" /><path d="M18 9a4 4 0 0 1 0 6" /></>),
  gift: (<><rect x="3" y="8" width="18" height="4" rx="1" /><path d="M12 8v13M5 12v9h14v-9" /><path d="M12 8S10.5 3 8 3 5.5 6 8 6s4 2 4 2 2-2 4-2 2.5-3 0-3-4 5-4 5" /></>),
  money: (<><circle cx="12" cy="12" r="9" /><path d="M12 7v10M14.6 9.3c-.6-.8-1.6-1.3-2.7-1.3-1.7 0-2.9.9-2.9 2.2 0 3 5.6 1.5 5.6 4.5 0 1.3-1.3 2.2-3 2.2-1.2 0-2.4-.5-3-1.4" /></>),
  shield: (<path d="M12 3l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V6z" />),
  "shield-check": (<><path d="M12 3l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V6z" /><path d="m9 12 2 2 4-4" /></>),
  wrench: (<path d="M14 7a4 4 0 0 1-5 5L4 17l3 3 5-5a4 4 0 0 0 5-5z" />),
  sync: (<><path d="M3 12a9 9 0 0 1 15.5-6.3M21 4v5h-5" /><path d="M21 12a9 9 0 0 1-15.5 6.3M3 20v-5h5" /></>),
  database: (<><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>),
  folder: (<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />),
  clipboard: (<><rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 4V3h6v1M9 10h6M9 14h4" /></>),
  checklist: (<><path d="M9 6h11M9 12h11M9 18h11" /><path d="m3 5.5 1 1 2-2M3 11.5l1 1 2-2M3 17.5l1 1 2-2" /></>),
  book: (<><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" /><path d="M19 3v18" /></>),
  bookmark: (<path d="M6 3h12v18l-6-4-6 4Z" />),
  flag: (<path d="M5 21V4h11l-2 4 2 4H5" />),
  star: (<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17.8 6.6 20l1-6.1L3.2 9.5l6.1-.9L12 3Z" />),
  tag: (<><path d="M3 12V4h8l9 9-8 8-9-9Z" /><circle cx="7.5" cy="8" r="1.3" /></>),
  church: (<path d="M4 21V9l8-5 8 5v12M9 21v-6h6v6M12 4V1M10 3h4" />),
  cross: (<path d="M10 3h4v5h5v4h-5v9h-4v-9H5V8h5V3Z" />),
  network: (<><circle cx="6" cy="6" r="2.4" /><circle cx="18" cy="18" r="2.4" /><circle cx="18" cy="6" r="2.4" /><path d="M8 7l8 9M18 8.4v7.2" /></>),
  share: (<><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="m8.2 10.9 7.6-3.7M8.2 13.1l7.6 3.7" /></>),
  bolt: (<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />),
  search: (<><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>),
  layers: (<><path d="m12 2 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5" /><path d="m3 17 9 5 9-5" /></>),
  sprout: (<><path d="M12 20v-8" /><path d="M12 12C8.5 12 6 9.5 6 6c3.5 0 6 2.5 6 6Z" /><path d="M12 12c0-3 2-5 6-5 0 3.5-2.5 5-6 5Z" /></>),
};

/** Icons offered in the nav builder's picker — Dan's chosen set (order shown). */
export const NAV_ICONS: Array<{ id: string; label: string }> = [
  { id: "gear", label: "Settings" },
  { id: "sliders", label: "Filters" },
  { id: "home", label: "Home" },
  { id: "people", label: "People" },
  { id: "person", label: "Person" },
  { id: "calendar", label: "Calendar" },
  { id: "heart", label: "Care" },
  { id: "user-plus", label: "New person" },
  { id: "clock", label: "Time" },
  { id: "chart-bar", label: "Bar chart" },
  { id: "chart-pie", label: "Pie chart" },
  { id: "chart-line", label: "Trend" },
  { id: "grid", label: "Dashboard" },
  { id: "pin", label: "Location" },
  { id: "map", label: "Map" },
  { id: "list", label: "List" },
  { id: "table", label: "Table" },
  { id: "compass", label: "Explore" },
  { id: "route", label: "Pathway" },
  { id: "funnel", label: "Pipeline" },
  { id: "target", label: "Goals" },
  { id: "mail", label: "Email" },
  { id: "globe", label: "Outreach" },
  { id: "gift", label: "Giving" },
  { id: "database", label: "Data" },
  { id: "megaphone", label: "Announce" },
  { id: "checklist", label: "Checklist" },
  { id: "bookmark", label: "Bookmark" },
  { id: "flag", label: "Flag" },
  { id: "network", label: "Relationships" },
  { id: "cross", label: "Cross" },
  { id: "star", label: "Favorite" },
  { id: "bolt", label: "Activity" },
  { id: "search", label: "Search" },
  { id: "layers", label: "Layers" },
  { id: "sprout", label: "Growth" },
  { id: "church", label: "Church" },
  { id: "money", label: "Donations" },
  { id: "bell", label: "Alerts" },
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
