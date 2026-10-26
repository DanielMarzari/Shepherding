/** The congregation vocabulary, in one place.
 *
 *  `person_activity.classification` stores four values. What the app SHOWS
 *  is three, because two of the stored four answer the same pastoral
 *  question:
 *
 *    shepherded  →  Shepherded   in a group or team context
 *    active      →  Known        not shepherded, but we can see them
 *    present     →  Unknown      the only trace is a staff edit to their record
 *    inactive    →  Unknown      nothing at all inside the activity window
 *
 *  The stored four are kept deliberately. "present" and "inactive" are the
 *  difference between "somebody touched this record" and "nothing has
 *  happened", which is diagnostic even though it is not worth a separate
 *  word on screen — and the falling-through-the-cracks list depends on it
 *  (`classification != 'inactive'` is what makes somebody still-on-a-roster
 *  but lapsed findable). Collapsing at the storage layer would throw that
 *  away for a cosmetic gain.
 *
 *  No file should hard-code these words again. Import from here.
 */

/** What is written to person_activity.classification. */
export type Classification = "shepherded" | "active" | "present" | "inactive";

/** What a person is called on screen. */
export type ConnectionBand = "shepherded" | "known" | "unknown";

export const CLASSIFICATIONS: Classification[] = [
  "shepherded",
  "active",
  "present",
  "inactive",
];

/** Most connected first. Every band is reachable and the three together
 *  cover every stored value, so nobody falls outside the vocabulary. */
export const CONNECTION_BANDS: ConnectionBand[] = [
  "shepherded",
  "known",
  "unknown",
];

export const BAND_OF: Record<Classification, ConnectionBand> = {
  shepherded: "shepherded",
  active: "known",
  present: "unknown",
  inactive: "unknown",
};

export const BAND_LABEL: Record<ConnectionBand, string> = {
  shepherded: "Shepherded",
  known: "Known",
  unknown: "Unknown",
};

/** One line each, for legends and tooltips. Written so a ministry leader
 *  reading it cold knows what the word is claiming. */
export const BAND_DESCRIPTION: Record<ConnectionBand, string> = {
  shepherded:
    "In a group or team where somebody is responsible for them — or a volunteer reporting to staff.",
  known:
    "Not in a group or team, but active enough elsewhere in the church that we can see them.",
  unknown:
    "No activity inside the activity window, or activity below the threshold that counts as engagement.",
};

/** Band for a stored classification. Unrecognised or missing values read as
 *  unknown rather than throwing: a person with no snapshot row yet is
 *  genuinely unknown to us, which is the honest answer. */
export function bandOf(cls: string | null | undefined): ConnectionBand {
  if (!cls) return "unknown";
  return BAND_OF[cls as Classification] ?? "unknown";
}

export function bandLabel(cls: string | null | undefined): string {
  return BAND_LABEL[bandOf(cls)];
}

/** Which stored values roll up into a band — for SQL `IN (…)` and for
 *  filtering a list that still carries the four-value field. */
export const CLASSIFICATIONS_IN_BAND: Record<ConnectionBand, Classification[]> =
  {
    shepherded: ["shepherded"],
    known: ["active"],
    unknown: ["present", "inactive"],
  };
