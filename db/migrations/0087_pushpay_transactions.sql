-- Individual gifts, not just a donor summary.
--
-- pushpay_donors holds ONE row per donor with last_gift_date and a stage. That
-- answers "who gives" and "when did they last give" and nothing else: no
-- frequency, no series over time, no way to tell a recurring gift from a cheque
-- in the plate, and no way to ask whether giving moved after a sermon. The
-- Finance report's "online vs check/cash" and "recurring gifts" Outputs, and
-- the giving outcome on the sermon page, were all blocked on exactly this.
--
-- The PushPay Transactions export carries one row per gift with a stable
-- Transaction ID, the date received, the channel it came through, and the fund.
-- It carries NO AMOUNT, which suits the church's own instruction that these
-- reports show giving without dollar figures.
--
-- NO PII IS STORED HERE. The export includes name, email, phone and address;
-- none of it is written to this table. Identity already lives, encrypted, in
-- pushpay_donors. All this table keeps is the link to a PCO person, resolved at
-- import time, plus the opaque PushPay payer id so a later import can re-match
-- a donor who could not be resolved the first time.
CREATE TABLE IF NOT EXISTS pushpay_transactions (
  org_id         INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  transaction_id TEXT NOT NULL,
  received_on    TEXT NOT NULL,   -- ISO 'YYYY-MM-DD'
  status         TEXT,            -- Success | Processing
  source         TEXT,            -- Recurring | Batch Entry | Web | Text Giving | Mobile | Kiosk
  payer_id       TEXT,            -- PushPay's donor id, opaque
  person_id      TEXT,            -- resolved pco_people.pco_id, or null
  match_source   TEXT,            -- your_id | donor_match | unmatched
  fund_name      TEXT,
  fund_code      TEXT,
  imported_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, transaction_id)
);
CREATE INDEX IF NOT EXISTS pushpay_tx_person ON pushpay_transactions(org_id, person_id, received_on);
CREATE INDEX IF NOT EXISTS pushpay_tx_date   ON pushpay_transactions(org_id, received_on);
CREATE INDEX IF NOT EXISTS pushpay_tx_payer  ON pushpay_transactions(org_id, payer_id);

-- Which export produced the last import, so the page can say so.
ALTER TABLE pushpay_import ADD COLUMN kind TEXT;
