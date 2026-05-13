/** Friendly relative-or-date formatter for the "Last event" column.
 *  Returns "—" for null/invalid input. */
export function formatLastEvent(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const ageMs = Date.now() - d.getTime();
  const day = 24 * 60 * 60 * 1000;
  if (ageMs < 7 * day) {
    const days = Math.max(0, Math.floor(ageMs / day));
    return days === 0 ? "today" : `${days}d ago`;
  }
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
