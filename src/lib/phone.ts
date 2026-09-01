/** Normalize a phone number to a stable match key: digits only, US
 *  10-digit form (a leading country-code 1 is dropped). Returns null when
 *  there aren't enough digits to be a real phone (extensions, junk). The
 *  SAME normalizer runs on both sides — PCO phone numbers at sync time and
 *  PushPay donor phones at import — so their keyed HMACs line up. */
export function normPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D+/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length < 10) return null;
  // Keep the last 10 digits (handles a stray leading country code we didn't
  // strip, or formatting artifacts).
  return digits.slice(-10);
}
