-- PCO stores three first-name forms and we only kept one. A person can be
-- first_name "John", given_name "Jung", nickname "Johnny" — all the same human.
-- PushPay sends whichever the donor typed, so matching on first_name alone
-- misses people (e.g. donor "Jung Cho" vs PCO's "John Cho", given_name "Jung").
-- Both stay plaintext like first_name/last_name (see migration 0074).
ALTER TABLE pco_people ADD COLUMN nickname TEXT;
ALTER TABLE pco_people ADD COLUMN given_name TEXT;
