// Shared person-name matching: is this the same human? Used by the duplicate
// audit AND by PushPay donor matching, so "Liz" vs "Elizabeth" is judged the
// same way in both places.
//
// The rule that matters for donor matching: a name mismatch DISQUALIFIES a
// candidate outright, no matter how well the email or phone match. Families
// share an inbox and a phone number, so contact info alone will happily point
// at someone's kid. A nickname / spelling variant of the first name is the
// only allowed difference.
//
// Organizations are the one exception, at the bottom of this file: a church or
// business has no first name for that rule to run on, and no household inbox
// to be confused by either.

/** Levenshtein edit distance, capped early — only used on short first
 *  names so it's cheap. */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 2) return 3;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

export const NICKNAMES: Record<string, string[]> = {
  jon: ["john", "jonathan"],
  john: ["jon", "jonathan"],
  bob: ["robert", "rob"],
  rob: ["robert", "bob"],
  bill: ["william", "will"],
  will: ["william", "bill"],
  jim: ["james", "jimmy"],
  mike: ["michael"],
  tom: ["thomas"],
  dave: ["david"],
  dan: ["daniel", "danny"],
  chris: ["christopher", "christina", "christine"],
  matt: ["matthew"],
  joe: ["joseph"],
  steve: ["steven", "stephen"],
  ben: ["benjamin"],
  sam: ["samuel", "samantha"],
  kate: ["katherine", "kathryn", "katelyn"],
  liz: ["elizabeth"],
  beth: ["elizabeth"],
  becca: ["rebecca"],
};

/** Are two first names plausibly the same person (typo / nickname /
 *  one a prefix of the other)? */
export function firstNameSimilar(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a[0] === b[0] && (a.startsWith(b) || b.startsWith(a))) return true; // Jonathan / Jon
  if ((NICKNAMES[a] ?? []).includes(b) || (NICKNAMES[b] ?? []).includes(a)) return true;
  if (editDistance(a, b) <= 1) return true; // Jon / John, Sara / Sarah
  return false;
}


/** Normalize one name part for comparison. */
export function normNamePart(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[.,'`]/g, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Same person by name? Requires the last name to match exactly and the first
 *  name to be equal or a recognized nickname / spelling variant. */
export function sameNamePerson(
  aFirst: string | null | undefined,
  aLast: string | null | undefined,
  bFirst: string | null | undefined,
  bLast: string | null | undefined,
): boolean {
  const la = normNamePart(aLast);
  const lb = normNamePart(bLast);
  if (!la || la !== lb) return false;
  const fa = normNamePart(aFirst);
  const fb = normNamePart(bFirst);
  if (!fa || !fb) return false;
  return firstNameSimilar(fa, fb);
}

/** Full "first last" collapsed to one comparable string. Donors and PCO don't
 *  always split a name the same way — PushPay may send first="Mary",
 *  last="Ann-Matsko" where PCO has first="Mary Ann", last="Matsko". Same
 *  human, different field split, so compare the whole name too. */
export function fullNameKey(first: string | null | undefined, last: string | null | undefined): string {
  return normNamePart(`${first ?? ""} ${last ?? ""}`);
}

/** Words that only turn up in an organization's name. */
const ORG_TOKENS = new Set([
  "inc", "incorporated", "llc", "llp", "lp", "ltd", "corp", "corporation", "company", "co",
  "church", "chapel", "ministry", "ministries", "mission", "missions", "fellowship",
  "congregation", "parish", "diocese", "tabernacle", "temple", "synagogue", "assembly",
  "foundation", "trust", "fund", "endowment", "charity", "charities", "society",
  "association", "institute", "academy", "school", "college", "university",
  "partners", "holdings", "enterprises", "estate",
]);

/** Does a whole name read as an organization rather than a person? Three or
 *  more words is already unlike a person's name once the placeholder is gone
 *  ("way of life mission church inc"); a two-word name has to carry an
 *  organization word ("grace church"). */
export function looksLikeOrgName(name: string): boolean {
  const words = name.split(" ").filter(Boolean);
  if (words.length >= 3) return true;
  return words.some((w) => ORG_TOKENS.has(w));
}

/** Key an organization by its name alone, or null if this reads as a person.
 *
 *  Organizations live in the people table, and neither system has a real first
 *  name to put in the first-name field — PCO writes "_" and the PushPay export
 *  writes "Z" so the record sorts to the end. Those are sort placeholders, not
 *  given names, so requiring them to agree (the rule that keeps a donor off
 *  someone's kid) permanently disqualifies every organization. Drop any field
 *  that normalizes to at most one character and match on what's left, which is
 *  what lets PCO's "_ / Way of Life Mission Church Inc" line up with PushPay's
 *  "Z / Way of Life Mission Church Inc".
 *
 *  A placeholder field is required: "Grace" + "Church" is a person and must
 *  keep going through the normal first-name check. */
export function organizationKey(
  first: string | null | undefined,
  last: string | null | undefined,
): string | null {
  const parts = [normNamePart(first), normNamePart(last)];
  if (!parts.some((p) => p.length <= 1)) return null;
  const name = parts.filter((p) => p.length > 1).join(" ").trim();
  if (!name || !looksLikeOrgName(name)) return null;
  return name;
}
