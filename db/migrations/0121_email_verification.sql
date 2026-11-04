-- Sign-ups prove they own a church email before they get in.
--
-- Until now anyone could create an account, see the organization on /orgs
-- and join it: no check of who they were. Sign-up now takes a
-- @faithchurchpa.com address and sends a link to it; the account exists
-- only once the link is used.
--
-- users.email_verified_at — when the address was proven. Accounts that
-- already have a membership are trusted as they are (it is how everybody
-- using the app today signed in) and stamped with their created_at. An
-- account with no membership never got in, is left unverified, and cannot
-- be joined to anything without signing up again.
--
-- pending_signups — one row per link sent. The name and password hash
-- travel with the link rather than sitting on a users row, so whoever
-- clicks proves the address AND sets the password they chose: a second
-- sign-up for the same address cannot swap its own password in under
-- somebody else's link. Only a SHA-256 of the token is stored. Rows go
-- when used, and expired ones are cleared on the next sign-up.
BEGIN IMMEDIATE;

ALTER TABLE users ADD COLUMN email_verified_at TEXT;

UPDATE users
   SET email_verified_at = created_at
 WHERE id IN (SELECT user_id FROM memberships);

CREATE TABLE IF NOT EXISTS pending_signups (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pending_signups_email ON pending_signups(email, created_at);

INSERT OR IGNORE INTO _migrations (filename) VALUES ('0121_email_verification.sql');
COMMIT;
