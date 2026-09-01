// Shared, framework-neutral types for the GalleryHub (used by the client
// component and by the server-side section builders for /more, /settings, and
// the home hub).

export interface GalleryLink {
  href: string;
  title: string;
  description: string;
  external?: boolean;
  /** Section label, filled in for search results so a card shows where it lives. */
  section?: string;
}

export interface GallerySection {
  id: string;
  label: string;
  blurb?: string;
  /** Optional nav-icon id (see components/NavIcon) shown in the rail. */
  icon?: string;
  links: GalleryLink[];
}
