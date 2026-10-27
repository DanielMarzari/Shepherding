/** The map's points, packed.
 *
 *  A map of the congregation is 25,834 dots. Sent as objects, each one
 *  repeats its ten key names, and the whole set came to about 4 MB of the
 *  page — most of what was left of /map's response after the road web moved
 *  off it. Sent as parallel arrays of numbers it is roughly a fifth of that,
 *  and the names are not in it at all: a dot needs a position and a few
 *  flags to be drawn, and a name only when somebody clicks it.
 *
 *  No server-only imports here — both the pages and the map components use
 *  these types, and the expand() below runs in the browser.
 */

/** Bit positions inside `flags`. Keep in step with expandPoints below. */
export const PT_MEMBER = 1;
export const PT_IN_GROUP = 2;
export const PT_IN_TEAM = 4;
export const PT_HOUSEHOLD = 8;
export const PT_PARENT = 16;
/** Classification in bits 5-6: 0 unknown, 1 known, 2 shepherded. */
export const PT_CLASS_SHIFT = 5;
/** Gender in bits 7-8: 0 unrecorded, 1 male, 2 female, 3 other. */
export const PT_GENDER_SHIFT = 7;

export interface CompactPoints {
  /** Latitude and longitude, to five decimals — about a metre. */
  lat: number[];
  lng: number[];
  flags: number[];
  /** 0 where no birth year is on file. */
  birthYear: number[];
  /** PCO ids, used to fetch a name when a dot is clicked. */
  ids: string[];
}

/** One point, in the shape the map components already work with. `name` is
 *  absent until a click fetches it. */
export interface MapPoint {
  personId: string;
  lat: number;
  lng: number;
  classification: string;
  isMember: boolean;
  inGroup: boolean;
  inTeam: boolean;
  hasHousehold: boolean;
  gender: string | null;
  birthYear: number | null;
  isParent: boolean;
}

const CLASSES = ["unknown", "known", "shepherded"];
const GENDERS = [null, "Male", "Female", "Other"];

export function expandPoints(c: CompactPoints): MapPoint[] {
  const out: MapPoint[] = new Array(c.lat.length);
  for (let i = 0; i < c.lat.length; i++) {
    const f = c.flags[i];
    out[i] = {
      personId: c.ids[i],
      lat: c.lat[i],
      lng: c.lng[i],
      classification: CLASSES[(f >> PT_CLASS_SHIFT) & 3] ?? "unknown",
      isMember: (f & PT_MEMBER) !== 0,
      inGroup: (f & PT_IN_GROUP) !== 0,
      inTeam: (f & PT_IN_TEAM) !== 0,
      hasHousehold: (f & PT_HOUSEHOLD) !== 0,
      isParent: (f & PT_PARENT) !== 0,
      gender: GENDERS[(f >> PT_GENDER_SHIFT) & 3] ?? null,
      birthYear: c.birthYear[i] || null,
    };
  }
  return out;
}

export function countPoints(c: CompactPoints): number {
  return c.lat.length;
}
