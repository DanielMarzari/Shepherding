-- First-gift date per donor, for the "new givers over time" chart. The standard
-- PushPay "All Donors" export only carries the LAST gift date, so this stays
-- NULL until an export that includes a "First Gift - Date" column (or a gifts /
-- transactions export) is imported. Nullable ISO 'YYYY-MM-DD'.
ALTER TABLE pushpay_donors ADD COLUMN first_gift_date TEXT;
