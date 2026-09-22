# Database schema

Start here. The app keeps everything in one SQLite file. This page covers what
each of its 97 tables holds, which ones can be rebuilt and which cannot, the
naming rules, the traps, and how to change the schema without wedging a deploy.
Row counts come from the production copy of 2026-09-22, with every migration
through [0097] applied. The four tables [0098] adds are marked, and their row
counts are what that migration writes from the 16,574 gifts already stored.
[0099] adds no tables: it moves every giving surface off the emptied
`pushpay_donors` and onto those gifts, rewriting 22 stored builder queries and
adding one block to each of two pages (so `builder_blocks` is 509 after it).

For a table's exact columns, ask the database (`.schema pco_people` in the
sqlite3 CLI, or the column list in the Page Builder's SQL editor) rather than
the migration that created it. Some tables have been altered more than twenty
times since.

## 1. Orientation

- **One file, two connections.** [getDb()][db.ts] opens it in WAL mode with
  `foreign_keys = ON` and a 10 s busy timeout, and applies pending migrations
  at boot. Page Builder queries run on a second, read-only connection
  ([builder.ts]). Production is `/var/www/apps/shepherdly/shepherdly.db`
  (`DATABASE_PATH`, about 470 MB); with no `DATABASE_PATH` the app creates
  `./shepherding.db`. To browse production, copy it on the host (Backups,
  below) and download the copy. The `sqlite_*` tables a viewer also lists are
  SQLite's own (AUTOINCREMENT counters, planner statistics): don't edit them.
- **Tenant key.** 91 of the 97 tables have `org_id INTEGER NOT NULL REFERENCES
  organizations(id) ON DELETE CASCADE`, and nearly every index leads with it.
  Six tables have no `org_id`: `_migrations`, `organizations`, `users`,
  `sessions`, `geocode_cache`, `weather_daily`. Production has one organization
  (id 1), but every query still filters by `org_id`. Builder SQL gets the org
  bound as `:orgId` ([runBuilderQueryForOrg][builder.ts]).
- **Person identity** is `pco_people(org_id, pco_id)`: Planning Center's person
  id, stored as TEXT. Every `person_id` and `*_person_id` column holds a
  `pco_id`. These columns also point at people, although their names don't say
  so: `pco_check_ins.checked_in_by_id` / `checked_out_by_id`,
  `pco_households.primary_contact_id`, `pco_calendar_events.owner_id`,
  `duplicate_pairs.person_a` / `person_b`, `shepherd_assignments.target_id`
  when `target_kind = 'person'`, and `pushpay_donors.candidate_ids` (a JSON
  array). `pco_people` holds everyone PCO has, about half of them inactive,
  plus system accounts: when counting by hand, filter on `status` and on
  `pco_sync_settings.excluded_membership_types`.
- **Foreign keys are few and deliberate.** `org_id` → `organizations` ON DELETE
  CASCADE everywhere ([0095] added the missing ones). The four tables of
  hand-entered person data point at `pco_people(org_id, pco_id)` ON DELETE
  RESTRICT ([0094]), so deleting a person someone has written about fails
  instead of orphaning the notes. `builder_blocks` / `builder_page_versions` →
  `builder_pages` CASCADE; `memberships` / `sessions` → `users` CASCADE;
  `organizations.created_by` → `users` RESTRICT. **Mirror tables declare no
  keys between themselves:** `pco_group_memberships.group_id` →
  `pco_groups.pco_id` and similar are joins by convention, so a mirror row can
  name a person or group that isn't there.
- **Keys are enforced only on connections that turn them on.** The app and the
  deploy's migrate step do. The sqlite3 CLI, Python and most SQLite viewers
  start with `foreign_keys` off: there, deleting a person silently orphans
  their notes, and deleting a parent row cascades nowhere. Before any hand
  edit run `PRAGMA foreign_keys = ON;`, and afterwards `PRAGMA
  foreign_key_check;`.
- **Private data.** Names are plaintext (`first_name`, `last_name`, `nickname`,
  `legal_first_name`). Birthdate and address live in `pco_people.enc_pii`
  (AES-256-GCM JSON). Congregation emails and phones synced from PCO are stored
  only as keyed HMACs (`pco_person_emails`, `pco_person_phones`,
  `constant_contact_contacts.email_hash`). Also encrypted: form answers
  (`pco_form_submissions.enc_data`), PushPay donors' name, email and phone
  (`pushpay_donors.enc`), and secrets (`*_enc`). Plaintext on purpose: app
  logins' `users.email`, and the pastoral `care_assignments.note`. All of it
  uses `ENCRYPTION_KEY` ([encryption.ts]); under a different key the encrypted
  values can't be read and the hashes no longer match each other.
- **Where to look:**
  - [db.ts]: pragmas, `prepareCached`, the boot-time migration runner.
  - [pco-sync.ts] (`runSync`) and `src/lib/pco-sync-*.ts`: write the `pco_*`
    mirrors. [pco.ts] handles credentials, `getSyncSettings` and
    `SYNC_ENTITIES`.
  - [constant-contact-sync.ts]: the Constant Contact mirrors and their rollups.
  - [dashboard-refresh.ts]: the snapshot tables (`person_activity` and friends).
  - `src/lib/*-read.ts`: what each page reads (`people-read.ts`,
    `care-read.ts`, `retention-read.ts`, …).
  - [builder.ts], [builder-seeds.ts], `mir-seeds.ts`, [mir-metrics.ts]: the
    Page Builder, its seeded pages and their SQL templates.
  - [cron route]: the 15-minute tick (host crontab → `/api/sync/cron`), which
    decides what runs when.
  - [pushpay-import.ts], [attendance-import.ts], `scripts/`: imports and
    one-time backfills.

## 2. Table census, by lifecycle

The question a table name can't answer is what losing the table costs. Every
table appears exactly once below.

### Synced mirrors (43): rebuild by syncing again, except `pco_people`

A lost table refills on the next sync. Delete a resource's `pco_sync_cursor`
row (`resetSyncCursor`; for people, the Full re-sync button on /pco) to force
a full re-fetch. When their table is empty the sync pulls the whole history of
plans (with their series), worship plan items, and group events with their
attendance. Only calendar data older than 3 years needs
`scripts/backfill-calendar.mjs` again. The other `scripts/backfill-*.mjs` were
one-time fills for new columns; they matter only when a child table (plan
items, attendances) is lost while its parent still has rows. **Never truncate
and re-sync `pco_people`:** it keeps people PCO no longer returns, and owned
rows point at them (§4). Most mirrors have `synced_at` (when we last wrote the
row; not `pco_person_phones`, `constant_contact_activity`,
`constant_contact_list_memberships` or `constant_contact_campaign_lists`).
`pco_created_at` / `pco_updated_at` are Planning Center's own.

**Planning Center (34 tables).** [pco-sync.ts] `runSync` writes them on the
schedule in `pco_sync_settings`, covering the entities enabled in
`pco_sync_entities`.

| Table | Rows | A row is |
|---|--:|---|
| `pco_people` | 34,668 | A PCO person. Some columns are computed here, not by PCO: `is_minor`, `birth_year` (`refreshIsMinor`), `is_parent` (`refreshIsParent`), `last_check_in_at`, `last_form_submission_at`. `last_activity_at` is dead (§4). |
| `pco_person_emails` | 25,095 | One (person, HMAC of the lowercased email). No plaintext. |
| `pco_person_phones` | 28,218 | One (person, HMAC of the normalized phone). |
| `pco_person_fields` | 1,094 | A custom-field value. Today only `field_name = 'Baptism'`, with the date in `value_on`. |
| `pco_forms` | 3 | A form whose submissions are synced. |
| `pco_form_fields` | 63 | A question on one of those forms. |
| `pco_form_submissions` | 2,475 | One submission. The answers are encrypted in `enc_data`. |
| `pco_households` | 6,550 | A household. `primary_contact_id` is a person. |
| `pco_household_memberships` | 19,470 | A person in a household. `pending` is PCO's flag. |
| `pco_lists` | 9 | A PCO People List. `refreshed_at` is when PCO last rebuilt it. |
| `pco_list_memberships` | 213 | A person on a list. |
| `pco_registration_signups` | 931 | A Registrations signup (the Discover courses live here). `is_archived` is 0/1. |
| `pco_registration_attendees` | 43,351 | An attendee of a signup. `person_id` can be null. |
| `pco_group_types` | 20 | A group type. |
| `pco_groups` | 338 | A group. `archived_at` is set once it folds. |
| `pco_group_memberships` | 3,400 | A *current* member of a group, with a `role`. The sync replaces each group's set, so leavers vanish and `archived_at` is always NULL (§4). `last_attended_at` is computed (`refreshLastAttended`). |
| `pco_group_events` | 13,101 | One group meeting. |
| `pco_event_attendances` | 109,395 | A person's attendance at a *group meeting*. `event_id` is a `pco_group_events.pco_id`. |
| `pco_group_applications` | 1,569 | A request to join a group. |
| `pco_check_in_events` | 107 | A Check-Ins event (a service, a class). Has no date. |
| `pco_check_in_locations` | 616 | A room or folder. Folders nest via `parent_id`. |
| `pco_check_ins` | 276,610 | One check-in. `kind` is Regular / Guest / Volunteer. `person_id` is null for 872. `event_time_starts_at` is the occurrence's UTC start. `location_id` is the first location only. |
| `pco_service_types` | 48 | A Services service type. |
| `pco_plans` | 5,153 | One service plan. `sort_date` is **local time** and includes ~100 scheduled future plans (the last in 2035), so always bound it above (§3). `series_title` / `series_id` hold the sermon series. |
| `pco_plan_people` | 64,465 | A person scheduled on a plan, with team, position name and `status` (C/U/D). |
| `pco_plan_items` | 18,652 | An order-of-service item (song, sermon, announcement). `duration_seconds` is PCO's `length`. |
| `pco_teams` | 153 | A serving team. |
| `pco_team_positions` | 715 | A position on a team. |
| `pco_team_memberships` | 5,803 | A *current* member of a team roster, replaced per team like group memberships. `last_served_at` is computed (`refreshLastServed`) and can be in the future (§3). |
| `pco_calendar_events` | 6,260 | A Calendar event. Has no date. `owner_id` is a person. |
| `pco_calendar_event_instances` | 33,412 | One dated occurrence of an event: what the facilities reports count. |
| `pco_calendar_resources` | 90 | A room or piece of equipment. |
| `pco_calendar_resource_bookings` | 104,372 | A resource booked for an occurrence. |
| `pco_calendar_resource_requests` | 29,639 | A room or setup request, with its `approval_status`. |

**Constant Contact (6).** [constant-contact-sync.ts] `runCcSync` writes them on
the schedule in `constant_contact_sync_settings`. The first run is a deep
sync; after that each run looks back about 3 months. A full refresh resets the
cursor.

| Table | Rows | A row is |
|---|--:|---|
| `constant_contact_contacts` | 18,044 | A contact. `email_hash` uses the same HMAC as `pco_person_emails`. `relinkContacts` sets `person_id` on every sync (12,057 matched). |
| `constant_contact_activity` | 234,314 | One tracking event (open / click / bounce / optout) per campaign activity, contact, type and link. Its `MAX(rowid)` is the rollups' watermark. |
| `constant_contact_lists` | 72 | A mailing list. |
| `constant_contact_list_memberships` | 23,678 | A contact on a list. |
| `constant_contact_campaigns` | 4,928 | An email campaign. `stat_*` are Constant Contact's summary counts. `campaign_activity_id` is the key the tracking rows use. |
| `constant_contact_campaign_lists` | 288 | A list a campaign activity was sent to. |

**Other outside sources (3).**

| Table | Rows | A row is |
|---|--:|---|
| `spotify_tracks` | 5 | A track the church released, from the Spotify API (`syncSpotifyCatalogue`, the Sync button on /spotify). `album_type` uses Spotify's word. |
| `geocode_cache` | 15,502 | The US Census geocoder's answer for one address, keyed by `addr_hash` (HMAC of the normalized address). `ok = 0` caches a miss. Rebuilding it means ~15k live lookups, 120 ms apart. |
| `weather_daily` | 2,334 | One day's high, low, precipitation, rain and snow for Trexlertown, PA, from the Open-Meteo archive. `loadWeatherForWeeks` fetches missing days when /attendance renders. |

### Derived (17): rebuild by running code

These cost only time to lose: each refills at its next build, listed below.
To refill an emptied snapshot or retention table sooner, press Refresh (an
admin button on the home page and on /pco). The self-heal compares only
`pco_people.synced_at` with the last build, so it won't notice.

**Dashboard snapshot.** [dashboard-refresh.ts] rebuilds these whole at the end
of every successful `runSync` (and of a failed one if any rows landed), when an
admin presses Refresh (`launchRefresh`), and whenever the cron's self-heal
(`healStaleSnapshots`) finds `pco_people` rows synced after the latest ok
`dashboard_refresh_runs` row's `source_synced_through`. The sync builds
`person_activity` with `rebuildPersonActivity`; Refresh and the self-heal use
`rebuildPersonActivityAsync`, and the two differ (§4).

| Table | Rows | Built by | A row is |
|---|--:|---|---|
| `person_activity` | 34,668 | `rebuildPersonActivity`, `classifyPersonActivity` | One per person: latest activity of each kind, active group and team counts, `in_worship_lane` / `in_community_lane` / `in_serving_lane`, and `classification` (shepherded / active / present / inactive) under `pco_sync_settings.activity_months`. |
| `group_summary` | 112 | `rebuildGroupSummary` | One per active (non-archived) group: members, leaders, 30-day joins and leaves, attendance %, `state` (growing / steady / paused). |
| `org_snapshot` | 1 | `rebuildOrgSnapshot` | Org-wide counts by classification and lane. `activity_months` records which window built them. |
| `lane_transitions` | 4 | `rebuildLaneTransitions` | Lane moves (`from_state` → `to_state`) replayed over every person's history, so one person can count more than once. |
| `duplicate_pairs` | 7,217 | `rebuildDuplicatePairs` ([audit-read.ts]) | Two people who may be the same person: confidence high / low, `reasons` as JSON. |
| `duplicate_pairs_meta` | 1 | same | Build time and algorithm `version`. If it differs from `CURRENT_DUP_VERSION`, the pairs are rebuilt on the next read. |

**Retention.** `refreshRetentionReturns` ([retention-read.ts]) runs from Refresh
and the self-heal, and from the cron after each successful sync. It does *not*
run at the end of `runSync`. Its ~2-minute scan runs in a child
`/usr/bin/sqlite3 -readonly` (`SQLITE3_BIN`).

| Table | Rows | A row is |
|---|--:|---|
| `retention_engagement` | 10,992 | One per person: first and last month with dated activity, as `year * 12 + month - 1` (24312 is January 2026). |
| `retention_returns` | 11 | Per calendar year, the number of returns: a month of activity after a gap longer than `activity_months`. One person can return more than once. |

**Email rollups.** `refreshCcEngagement` ([constant-contact-sync.ts], [0091])
runs at the end of every `runCcSync`, and from the cron whenever
`isCcEngagementStale` sees the activity watermark move.

| Table | Rows | A row is |
|---|--:|---|
| `constant_contact_engagement` | 6,277 | One per contact: opens, clicks, bounces, optouts. |
| `constant_contact_link_clicks` | 281 | One per clicked URL. |
| `constant_contact_engagement_snapshot` | 1 | Org totals, opens by weekday, and `activity_watermark_rowid`. |

**Giving rollups.** `refreshPushpayGiving` ([pushpay-import.ts], [0098]) rebuilds
both from `pushpay_transactions`, inside the transaction of every Transactions
import and every dataset removal — so they commit with the gifts or not at all.
`isPushpayGivingStale` is the backstop the cron can call: it compares the org's
gift count and latest `imported_at` with the watermark in the snapshot, and
catches anything that wrote to `pushpay_transactions` without rebuilding (the
old code in a deploy window, a hand edit). The build SQL is the same text as
the migration's first build; keep them in step.

| Table | Rows | A row is |
|---|--:|---|
| `pushpay_payer_summary` | 1,668 | **What every giving surface now counts** ([0099]). One per PushPay payer: `person_id` and `is_linked`, first and last gift date, gift count, `recurring_gifts` / `other_gifts`, and `funds` (a sorted JSON array of fund names). NEVER an amount. A gift whose export row had no Payer ID is its own payer, keyed `tx:<transaction id>`. A payer whose gifts name different people takes the one on the most recently imported gift that names anyone. |
| `pushpay_giving_snapshot` | 1 | One per org: payers, linked payers, gifts, the span of gift dates, and the `source_rows` / `source_written_at` watermark the staleness check reads. One row even with no gifts, so "built, and empty" is not "never built". |

**Map.** Background runners, started by the cron after a successful sync and by
the admin buttons on /map. They call outside services.

| Table | Rows | Built by | A row is |
|---|--:|---|---|
| `person_geo` | 34,627 | `geocodePending` (`startGeocodeRun`), via `geocode_cache` | One per person: home `lat` / `lng`, `status` (ok 25,755 / noaddr 7,372 / nomatch 1,500). `tract_geoid` and `county_geoid` are set by `refreshGeoAssignments` on every cron tick. |
| `person_drive_from_church` | 25,696 | `computeDrivesPending` (`startDriveRun`) | OSRM driving miles and minutes from the church to a geocoded home. Recomputed when `person_geo`'s coordinates change. Needs `OSRM_URL` ([osrm-setup.md]). |
| `road_network` | 12,188 | `buildMeshPending` (`startMeshRun`) | One road stretch (`road_key` = name + rounded endpoints) as a JSON polyline. Rows are only ever added. |
| `road_network_routed_people` | 8,040 | same | A home already folded into `road_network`. Failures are recorded too and never retried. To rebuild the road web, delete both tables' rows for the org. |

### Imported by hand (5): rebuild only from the original files

None of the source files are kept in this repo.

| Table | Rows | A row is, and how it is (re)loaded |
|---|--:|---|
| `attendance_weekly` | 280 | One Sunday's totals from the quarterly "Worship and Activities Attendance" .xlsx files (22 so far, 2021 Q1–2026 Q2), uploaded on /attendance (`importAttendanceFile`). Re-uploading upserts. `exception_reason` comes from the sheet and keeps storm and closure Sundays out of averages. |
| `attendance_service` | 2,418 | Per Sunday × room (center / chapel / kids / student) × service time, from the same files. Re-importing replaces that Sunday's rows. |
| `pushpay_donors` | 0 | **Emptied on 2026-09-22 at Dan's request**: the Transactions export, whose Payer ID is PushPay's stable donor key, is the giving source from here on. The 6,423 rows it held (65 hand-matched) are saved as `/home/ubuntu/backups/pushpay_donors-before-delete-20260922T1620Z.sql` (names, emails and phones still encrypted). **Nothing reads this table any more except the import and the /audit/pushpay reconciliation over it** ([pushpay-import.ts]), plus the junk filter's "don't delete a giver" check: [0099] moved the Giving page, the Give lane, the MIR Finance and Small Groups blocks and the membership audit onto `pushpay_payer_summary` / `pushpay_transactions`, and [giving-sql.ts] holds what each of PushPay's donor stages became and why. Otherwise: one row of PushPay's "All Donors" CSV, uploaded on /pushpay (`enc` holds encrypted name, email and phone), matched to a person. `match_status` is matched / manual / ambiguous / unmatched; `candidate_ids` are the people offered in review. `donor_key` is the row's position in the CSV, so it changes between uploads. **Re-uploading the CSV replaces every row but carries each manual match to the new row that is the same donor**, or sends it back to review when it can't tell (§4). `rematchDonors` re-runs matching in place and keeps manual matches. Removing the newest All Donors upload on /pushpay empties this table, because that upload *is* the set ([0098]). |
| `pushpay_transactions` | 16,574 | One gift from PushPay's Transactions CSV (/pushpay): date, source, fund, and never an amount. `match_source` says where `person_id` came from, tried in this order: `your_id` ("Your ID", which *is* the PCO person id), `donor_manual` (a donor someone matched by hand on the All Donors list, recognised by the same rule a re-upload uses, §4), `donor_match` (name, email and phone matching), or `unmatched`. Gifts imported before 2026-09-22 never have `donor_manual`; importing that export again re-resolves them. Rows upsert by `transaction_id`, so every export window adds history. `first_upload_id` is the `pushpay_uploads` row that inserted the gift and never changes; `last_upload_id` is the one that last wrote its values, and moves on every re-supply ([0098]). They are **value provenance only** — which files a gift is in, and so whether a removal may delete it, is `pushpay_transaction_uploads` (§4). Either column is NULL once the upload it named has been removed, or on a gift the old code wrote during the 0098 deploy. Rebuilding needs every export ever loaded (today's rows span 2026-01-01 to 2026-09-16). |
| `sermons` | 429 | One Sunday message from Sermon Lab, a separate app on the host: `transcript` plus classification (`topic`, `summary`, `next_steps`, `themes`). To rebuild, `scripts/import-sermons.mjs` loads the classified rows from `db/seed-data/sermons.json`, which has no transcripts; then `scripts/backfill-sermon-transcripts.mjs` copies them from Sermon Lab's database (`SERMON_LAB_DB`). `scripts/sync-sermons-from-lab.mjs` is meant to add new sermons, unclassified, from a Wednesday host cron, but none has arrived since 2026-08-02: check that cron. A sermon classified later lives only here until it is added to the JSON. |

### Owned (22): typed in by people, so back these up

| Table | Rows | A row is |
|---|--:|---|
| `care_assignments` | 3 | A person on a shepherd's care roster, with a note (/care-map, `scripts/assign-roster.mjs`). One shepherd per person. The app deletes rows itself (§4). |
| `shepherd_assignments` | 79 | A shepherd over a group, group type, team, service type, team position, person, membership type, shepherd team or reference list (`target_kind` + `target_id`; `target_id` has no key) (/shepherd-map). |
| `shepherd_known_people` | 1,731 | An "I know them" mark from a /know session (`source = 'know'`) or /present session (`'present'`) ([shepherd-intake.ts]). |
| `org_wide_access` | 0 | The /shepherd-map "sees the whole org" switch. Records intent only (§4). |
| `builder_pages` | 52 | A Page Builder page. `nav_section` / `more_section` place it in the nav. `seed_revision` is set on the 48 seeded from code; the unedited ones come back from code (§4), so the hand work is in the other 8. |
| `builder_blocks` | 507 | One widget on a page (509 after [0099]). `config` is JSON holding its SQL (246 blocks, 248 after [0099]) or named source, title and layout. |
| `builder_page_versions` | 27 | An Undo snapshot, keeping the last 10 per page. `snapshot` embeds each block's config as a JSON string inside JSON. |
| `builder_theme` | 0 | The org's SQL-editor color theme. |
| `nav_config` | 1 | The org's navigation as NavConfig JSON (/settings/navigation). |
| `nav_pins` | 13 | A page a user pinned, keyed by its href (`page_key`). `user_id` has no key to `users`. |
| `pco_sync_settings` | 1 | The PCO sync schedule **and** the org's business parameters (§4). |
| `pco_sync_entities` | 8 | Per-entity sync switches. A missing row means the default in `SYNC_ENTITIES` (§4). |
| `constant_contact_sync_settings` | 1 | The Constant Contact sync schedule. |
| `map_settings` | 1 | `second_campus_max_hours` for the campus planner. |
| `perf_suggestion_status` | 10 | The admin's verdict on each performance suggestion (/settings/performance). A missing row means the catalog default in `perf-suggestions.ts`. |
| `pco_credentials` | 1 | PCO app id, secret and webhook secret. |
| `constant_contact_credentials` | 1 | Constant Contact keys plus the OAuth refresh token the sync rotates. If it is lost, reconnect on /constant-contact. |
| `spotify_credentials` | 1 | Spotify client id, secret and artist. |
| `integration_credentials` | 0 | One row per secret field for a provider that has no sync yet (§3). |
| `organizations` | 1 | The tenant. Deleting a row cascades to 87 tables. |
| `users` | 4 | A login: `email`, `password_hash`, `name`. |
| `memberships` | 4 | A user's `role` (admin / member) in an org. |

In every credential table, `*_enc` values are encrypted and `*_last4` is kept in
plaintext only so the page can show which key is stored.

### App bookkeeping (10): mostly safe to lose, but never `_migrations`, `pushpay_uploads` or `pushpay_transaction_uploads`

| Table | Rows | A row is |
|---|--:|---|
| `_migrations` | 100 | An applied migration file. A lost row re-runs that file on the next deploy or boot, which for most files fails the deploy; a lost table re-runs all 100. |
| `pco_sync_runs` | 158 | One sync attempt: trigger, status, changes, `warning` (the junk filter's "kept" note lands here), `details` JSON. `cleanupStaleSyncRuns` reaps a row left `running` by a dead process. |
| `pco_sync_cursor` | 6 | A fetch high-water mark per resource (`people`, `checkins:check_ins`, `groups:applications`, `form:<id>:submissions`). Deleting one forces a full re-fetch of that resource. |
| `constant_contact_sync_runs` | 10 | One Constant Contact sync attempt. |
| `constant_contact_sync_cursor` | 1 | Its high-water mark (`contacts`). |
| `dashboard_refresh_runs` | 7 | One snapshot rebuild: `triggered_by`, progress, and `source_synced_through` (`MAX(pco_people.synced_at)` at the start). The latest ok row is the only record of what the snapshots were built from ([0089], `getSnapshotFreshness`). With no rows, freshness reads "unknown" and the self-heal does nothing until the next sync or Refresh writes one. |
| `pushpay_import` | 1 | Counts from the last PushPay upload of either kind, overwritten by each, and now also rewritten from the newest upload left whenever one is removed ([0098]), so it can never name a file that has gone; a `donors` upload is skipped there while `pushpay_donors` is empty, so the card cannot print donor counts over an empty list. `kind` says which: `donors` (All Donors) or `transactions`; /pushpay reads it to label the counts, /audit/pushpay to tell whether anything has been imported (`getPushpayImport`). Before 2026-09-22 an All Donors upload left `kind` alone, so a row untouched since then can hold a stale `transactions` or NULL. `rematchDonors` rewrites the three match counts in place and leaves `kind`, `total` and `file_name`, so after a Transactions upload the row mixes the two. The per-file record is `pushpay_uploads`. |
| `pushpay_uploads` | 1 | **Not safe to lose.** One PushPay upload of either kind ([0098]): `kind`, `file_name`, `imported_at`, `total` rows in the file, how many were new (`inserted`), the match breakdown (`matched` / `ambiguous` / `unmatched`, and for transactions `by_your_id` / `by_donor_manual` / `by_donor_match`), and for transactions the file's `first_gift_on` and `last_gift_on`. Ids are AUTOINCREMENT and never reused, so an id always means the upload that had it. Losing this table strands every gift: nothing could ever be removed again. `is_backfilled = 1` marks the one synthetic row 0098 wrote for the 16,574 gifts that predate the table. The /pushpay Datasets card lists these newest first, with a Remove control per row. |
| `pushpay_transaction_uploads` | 16,574 | **Not safe to lose.** One `(gift, upload that carried it)` pair ([0098]) — the whole answer to which files a gift is in, and so to what a removal may delete. PushPay export windows overlap, so a gift has one row here per file that listed it; the importer writes a row for every row of the file, re-supplies included. This is a many-to-many fact and cannot live in columns on the gift: with three overlapping files all holding one gift, two columns can only remember two of them (§4). Losing this table makes every gift unremovable. |
| `sessions` | 1 | A login session. Deleting rows signs people out. |

### Backups

Nothing in this repo takes one. Copy the whole file, consistently: `sqlite3
-readonly shepherdly.db ".backup /tmp/copy.db"` or `VACUUM INTO`, never `cp`
while the app runs (recent writes sit in `shepherdly.db-wal`). The copy is only
partly readable without `ENCRYPTION_KEY` (a GitHub secret that the deploy writes
to `/var/www/apps/shepherdly/.env.production`), so keep the key somewhere else.
A partial restore can skip the mirrors (except `pco_people`) and the derived
tables, but not the owned tables, the imported-by-hand tables, `_migrations`,
`pushpay_uploads` or `pushpay_transaction_uploads` (without those two no gift
can ever be removed again).

## 3. Naming rules

These rules have to survive the next migration.

- **`_at` is a full ISO-8601 instant in UTC**, `YYYY-MM-DDTHH:MM:SS[.sss]Z`.
  All 169 `_at` columns hold that shape. Defaults are
  `strftime('%Y-%m-%dT%H:%M:%fZ','now')`; in code, `new Date().toISOString()`.
  Don't use `datetime('now')`: its space sorts below `T`, so text comparisons
  against stored values go wrong ([0090]).
- **`_on` is a calendar date, `YYYY-MM-DD`, on the church's (Eastern)
  calendar:** `sunday_on`, `preached_on`, `received_on`, `last_gift_on`,
  `first_gift_on`, `value_on`, `released_on` ([0093]).
- **Exceptions:**
  - `pco_plans.sort_date` keeps PCO's name. It holds the **local** service time
    with a nominal Z: `'2026-09-13T08:00:00Z'` is the 8 am service. Plans are
    scheduled years ahead, so bound it above by the church's date. By hand,
    `sort_date < '2026-09-23'` keeps every plan through 22 September: the value
    starts with its local date, so "before the next day" is exact and still
    uses the index. Code and stored SQL use `sort_date < ${TOMORROW}` from
    [mir-metrics.ts] (not exported: export it rather than copy it); [0090]
    explains why `date('now')` and `datetime('now')` get it wrong.
  - Its copies: `pco_team_memberships.last_served_at` is `MAX(sort_date)` over
    every plan, future ones included, so it is local time and, for ~950 rows,
    the next scheduled date. `person_activity.last_served_at` is local time
    but stops at now, and `person_activity.last_activity_at` can be that value.
  - `pco_check_ins.event_time_starts_at` is true UTC:
    `'2026-09-20T15:15:00Z'` is the 11:15 service. For the church's calendar
    day of a true-UTC column `x`, use this (`easternDate` in [mir-metrics.ts],
    also unexported):

    ```sql
    CASE WHEN date(x) >= date(strftime('%Y', x) || '-03-08', 'weekday 0')
          AND date(x) <  date(strftime('%Y', x) || '-11-01', 'weekday 0')
         THEN date(x, '-4 hours') ELSE date(x, '-5 hours') END
    ```
  - `weather_daily.date` is a local calendar date under a plain name.
- **New 0/1 flags start with `is_`:** `is_minor`, `is_parent`,
  `is_team_leader`. Our flags from before the rule keep their names
  (`enabled`, `ok`, `full_refresh`, `email_on_failure`,
  `one_active_one_inactive`), and a few read as predicates (`in_worship_lane`,
  `has_message`). Mirrored flags keep the vendor's word
  (`canceled`, `waitlisted`, `attended`, `open`, `verified`) unless it would
  read as a timestamp's sibling: PCO's `archived` is stored as `is_archived`
  because every other `archived*` column is `archived_at` ([0097]).
- **Vendor prefixes say where rows come from, not how they live:** `pco_`
  (Planning Center), `constant_contact_` (never `cc_` or `constantcontact_`,
  per [0092] and [0097]), `pushpay_`, `spotify_`. `pco_sync_settings`,
  `pco_credentials` and `pco_sync_runs` are ours. Outside data without a
  prefix: `sermons` (Sermon Lab), `weather_daily` (Open-Meteo), `geocode_cache`
  (US Census), `road_network` (OSRM).
- **Vendor field names are read as the vendor spells them and stored under
  ours.** The sync or importer uses the vendor's spelling, and the SQL uses
  ours, so grep for both:
  - PCO: `given_name` → `legal_first_name`, `archived` → `is_archived`,
    `length` → `duration_seconds`, `all_day_event` → `all_day`, event time
    `starts_at` → `event_time_starts_at`.
  - Constant Contact: its field names are the old column names in the rename
    table below (`opt_in_date` → `opted_in_at`, …).
  - PushPay CSV: "Last Gift - Date" (DD-Mon-YY) → `last_gift_on`,
    "Received On" → `received_on`, "Your ID" → `person_id`.
  - Ours, spelled two ways: six `pco_sync_settings` columns still say
    `checkin` (`excluded_checkin_events`, `sunday_checkin_events`, …) where
    table names say `check_in`.
- **Credentials have two tiers** ([0092]). A provider gets its own typed
  `<provider>_credentials` table once its sync works and has connection
  metadata worth keeping (`verified_at`, the account name, a rotating refresh
  token). Today those are `pco_credentials`, `constant_contact_credentials` and
  `spotify_credentials`. Until then its secrets go in `integration_credentials`,
  one row per field ([0086]; `INTEGRATIONS` in [integrations.ts];
  /settings/integrations), e.g. Subsplash, YouTube, App Store Connect. PushPay
  deliberately has no entry until someone builds an API sync.

**Renamed on 2026-09-21/22** ([0092], [0093], [0097]). A saved query or note
that uses an old name gets "no such table" or "no such column":

| Old | New |
|---|---|
| `cc_*`, `constantcontact_credentials` | `constant_contact_*` with the same suffix, except `cc_contact_activity` → `constant_contact_activity`, `cc_contact_lists` → `constant_contact_list_memberships`, `cc_contact_engagement` → `constant_contact_engagement` |
| `person_mesh` (`meshed_at`), `person_drive` | `road_network_routed_people` (`routed_at`), `person_drive_from_church` |
| `pco_checkin_events`, `pco_checkin_locations` | `pco_check_in_events`, `pco_check_in_locations` |
| `week_date`, `event_time_at`, `value_date` | `sunday_on`, `event_time_starts_at`, `value_on` |
| `opt_in_date`, `opt_out_date`, `last_sent_date`, `activity_time` | `opted_in_at`, `opted_out_at`, `last_sent_at`, `occurred_at` |
| `last_gift_date`, `first_gift_date` | `last_gift_on`, `first_gift_on` |
| `given_name`, `length`, `archived` | `legal_first_name`, `duration_seconds`, `is_archived` |
| `in_lane_wors`, `in_lane_comm`, `in_lane_serv`, `last_form_at` | `in_worship_lane`, `in_community_lane`, `in_serving_lane`, `last_form_submission_at` |
| `first_mi`, `last_mi` | `first_activity_month_index`, `last_activity_month_index` |

Dropped: `road_mesh`, `mir_docs`, `mir_team_members`, `attendance_sources`
([0096]); `pushpay_credentials`, `subsplash_credentials` ([0092]).

## 4. Gotchas

- **`pco_sync_settings` holds business parameters, not just the schedule**
  (`SyncSettings` in [pco.ts]). Three month windows with similar names:
  `activity_months` (11 today) is the "active" window for classification and
  retention; `activity_tracking_months` (6) is the "recent" window for joins,
  leaves and attendance change; `sync_threshold_months` (3) is how far back
  every sync re-fetches. Also here: `lapsed_weeks`, `lapsed_from_team_*`, the
  `excluded_*` lists, the `*_checkin_*` lists, `weekly_attendance` and
  `serving_interest_form_id`. Numbers built into the snapshot (classification,
  lanes) change only after the next refresh; everything else, stored builder
  SQL included, reads the row live.
- **`pco_sync_entities` does not list what syncs.** Registrations and Calendar
  have no row and sync by default. The `service_teams` and
  `sunday_attendance` rows are leftover keys nothing reads (`getSyncEntities`
  in [pco.ts]).
- **`pco_people` keeps people PCO no longer returns.** 108 were missing from
  the full fetch of 2026-09-22 (sync run 158), most likely merged or deleted
  in PCO. Nothing passes deletions on: there is no webhook route, and the junk
  filter below is the only code that deletes from `pco_people`. A `synced_at`
  older than the last full fetch shows which. They still get `person_activity`
  rows and count in dashboards, and owned rows point at some of them.
- **Memberships are current only, so every "leaves" number is 0.**
  `group_summary.left_30d`, `org_snapshot.departed_30d` and the downward
  `lane_transitions` read membership `archived_at`, which is never set: the
  sync replaces each group's and team's set, so a leaver just disappears.
- **The sync and Refresh build `person_activity` differently.** Only
  `rebuildPersonActivityAsync` (Refresh, self-heal) drops people with an
  excluded membership type; the sync's `rebuildPersonActivity` keeps them, so
  after a nightly sync 64 system accounts count in the dashboards.
- **Adding to a care roster deletes care rows.**
  `pruneShepherdedCareAssignments` ([care-read.ts]) hard-deletes the rows, and
  notes, of everyone who has since become shepherded, on every add from
  /care-map.
- **Re-uploading PushPay "All Donors" keeps a hand match only when it can
  recognise the donor.** (The table is empty since 2026-09-22; this applies if
  an All Donors export is uploaded again.) `importPushpay` replaces every
  `pushpay_donors` row and carries each hand match to the
  new row that is the same donor (`sameDonor`, `planHandMatches` in
  [pushpay-import.ts]). That means the name as the export spells it, with Jr
  and Sr counted, so a father never inherits his son's match, plus the same
  email or the same phone. The name alone is enough only when neither row has
  an email or a phone and the name, suffix aside, is on one row in each file.
  A row with the same email and phone as before keeps its match. A row whose
  email or phone changed keeps it only when no other row could be that donor
  and its new details don't belong to another person with that name in PCO.
  Otherwise the donor goes back to review (`ambiguous`, the hand-picked person
  first in `candidate_ids`), and these come back on every upload:
  - a hand match with no email and no phone whose name is on another row.
    Every row with that name that no earlier row accounts for goes to review
    with it (in an unchanged file, the other rows with no email or phone),
    including rows matched automatically, because nothing says which is theirs;
  - two same-name donors on one inbox that were hand-matched to different
    people;
  - a hand match whose row has an identical twin in the file.
  A hand match to a person missing from `pco_people` also goes to review, but
  that almost never happens: `pco_people` keeps people PCO merged away or
  deleted (above), and the junk filter spares anyone a PushPay row points at.
  So a match to a record PCO has since merged away carries to that stale
  record, as it would have without a re-upload. A hand match that no row in
  the new file can be is dropped and counted as not found. The /pushpay
  message gives the kept, review and not-found counts. Two limits: a
  same-name household member whose new row is identical to the hand-matched
  row (same email, same or no phone) takes the match when the donor's own row
  changed or left, since the All Donors export has no donor id to tell them apart (the
  Transactions export does: Payer ID); and a
  review row keeps no record that it was a hand match, so Re-match on
  /audit/pushpay (`rematchDonors`) may assign it automatically. Nothing records
  which old row a new row came from, so save `pushpay_donors` before an upload
  you want to audit. A Transactions import uses the same rule to reuse a hand
  match for a payer without a usable "Your ID" (`match_source =
  'donor_manual'`); where a re-upload would ask, the payer is matched by name
  instead.
- **Removing a PushPay dataset keeps the gifts another file also carried, and
  they keep whatever file wrote them last.** "Remove" on /pushpay
  (`removePushpayUpload`, [0098]) deletes the gifts that upload supplied and
  that **no other upload still supplies** — the supply rows in
  `pushpay_transaction_uploads`, not the two columns on the gift. A gift
  another file carried too stays, whether that file is older or newer, because
  it is still here and still says the gift happened. Once every upload that
  supplied a gift has been removed, the gift goes. The gifts that stay keep the
  `person_id`, `source` and `fund_name` they hold now, which is what
  `last_upload_id` names: where that is the upload being removed, its values
  survive it and no earlier version of the row is kept anywhere. The page
  counts those separately and says so before it asks.
- **Two columns cannot say which files a gift is in.** `first_upload_id` /
  `last_upload_id` were tried for this first and lost data. Export windows
  overlap, so three files C1 ⊂ C2 ⊂ C3 can all hold gift *x*; two columns
  remember only the first and last of them, and removing C1 and then C3 deleted
  *x* while C2, which also carried it, was still in the Datasets list. The
  supply table is the fix, and the columns now answer only "where did this
  row's values come from" — a removal blanks the ones that named it rather than
  crediting another file with its work.
- **An All Donors upload owns the whole donor set, so only the newest one can
  empty it.** Removing the newest `donors` upload deletes every
  `pushpay_donors` row. Removing an older one takes out its record alone (its
  donors were replaced when the next All Donors file landed); /pushpay marks it
  and says so. Gift rows are never touched by removing a donors upload —
  `match_source = 'donor_manual'` on a gift stays as it was resolved. Emptying
  the donor list also drops `pushpay_import` back to the newest *transactions*
  upload, or removes the row: summarising the previous All Donors file would
  print its donor counts over an empty list.
- **A gift written while a deploy is in flight belongs to no upload.** [0098]'s
  columns are nullable and its supply table is new, so the old code keeps
  working in the seconds between the migrate step and the pm2 restart. A gift
  it writes there has no supply row, is in no dataset, and no Remove will
  delete it — nor will anyone else's removal sweep it up, since a removal only
  touches gifts the upload being removed supplied. Re-uploading that file
  **does** adopt it: the supply row is written for every row of the file, not
  only for inserts. `SELECT COUNT(*) FROM pushpay_transactions t WHERE NOT
  EXISTS (SELECT 1 FROM pushpay_transaction_uploads l WHERE l.org_id = t.org_id
  AND l.transaction_id = t.transaction_id)` finds them.
- **9 `attendance_weekly` and 54 `attendance_service` rows are dated Fridays**
  between 2020-01-03 and 2020-02-28. All come from the "2021 Q1" file, whose
  headers carry the wrong year. Fix it with a corrected re-import, then delete
  the Friday rows by hand ([0093]).
- **"Remove" on /attendance deletes only the file's `attendance_weekly` rows**
  (`removeAttendanceImportAction`). Its `attendance_service` rows stay: about
  100 service rows from the 2020 Q1 and Q4 files have no weekly row.
- **The junk-name filter deletes people.** `refreshIsMinor` /
  `looksLikeNonPerson` ([pco-sync.ts]) removes people with no letter in either
  name, or with a placeholder first name and a letterless surname
  ("Guest" / "1"), together with their `PERSON_ROW_DELETES` rows. It never
  deletes anyone `HAS_OWNED_DATA_SQL` finds (care, shepherd or org-wide rows, or
  a PushPay link); those are kept with a sync warning. The sync also skips such
  people on the way in.
- **Mirror rows that name people missing from `pco_people` are expected.** A
  few absent person ids (placeholder serving slots) hold about 200
  `pco_plan_people` and `pco_team_memberships` rows. There is **deliberately
  no orphan sweep**: on 2026-09-21 the "orphans" included 146 real people that
  a 2026-09-03 filter fix never re-fetched (a cursor reset restored them;
  [0094]).
- **`person_geo` is computed once per person.** `geocodePending` only picks up
  people with no row, so an address changed in PCO isn't re-geocoded until that
  person's row is deleted.
- **`pco_people.last_activity_at` is dead.** No current code writes or reads
  it (its newest value is 2026-05-06); only its index remains. Use
  `person_activity.last_activity_at`.
- **`weather_daily` and `geocode_cache` have no `org_id`.** Weather covers one
  location (hard-coded in `weather-trexlertown.ts`) and has no location key;
  geocodes are shared by address hash.
- **`org_wide_access` records intent only.** `hasOrgWideAccess` has no callers;
  every user sees the whole org (`OrgAccessToggle.tsx` says so).
- **"Event" means three things.** `pco_event_attendances.event_id` is a group
  meeting. `pco_check_ins.event_id` is an undated `pco_check_in_events` row,
  whose occurrence is `event_time_starts_at`. A calendar event is undated too;
  its dated rows are `pco_calendar_event_instances`.
- **Stored SQL names tables and columns.** 246 `builder_blocks.config` values
  and the Undo `builder_page_versions.snapshot`s embed queries. A rename that
  doesn't rewrite them breaks saved pages silently (§5).
- **Giving is bounded by the loaded gift window, and carries no amounts.**
  `pushpay_transactions` holds whatever export windows have been imported
  (2026-01-01 to 2026-09-16 today) and no dollar figure at all, so every giving
  figure is a count of gifts or of people inside that span. Nobody who stopped
  giving before it opened has a row anywhere, which is why "lapsed" on the
  giving surfaces means "gave inside the window and then went quiet" and each
  surface prints the span from `pushpay_giving_snapshot`. The rules, and what
  replaced each PushPay donor stage, are in [giving-sql.ts] ([0099]).
- **Seeded builder pages are code until someone edits them.** A seeded page
  whose `builder_pages.updated_at` is within 5 s of `created_at` counts as
  pristine: `ensureSeededPage` ([builder-seeds.ts]) recreates it on visit if
  it is missing and replaces it when its seed changes. Touching `updated_at`
  from SQL freezes a page as "edited".

## 5. Changing the schema

These rules were learned the hard way.

1. **Only in a migration file**, `db/migrations/NNNN_name.sql`, numbered after
   the highest (0099). Files are applied in filename order and recorded by
   filename. Never `ALTER` by hand on the server or from a script. An
   out-of-band change makes the migration that later does the same thing fail
   ("duplicate column name"). The deploy's migrate step then stops before the
   pm2 restart, leaving the new build on disk and the old process running. If a
   script really must change the schema, it records the migration itself, as
   `scripts/backfill-sermon-transcripts.mjs` does for 0078. Hand edits to
   *data* on the server start with `PRAGMA foreign_keys = ON;` (§1).
2. **The runners `db.exec` the whole file with `foreign_keys = ON` and do not
   wrap it in a transaction.** There are two runners: the migrate step in
   [deploy.yml] (60 s lock wait) and `ensureMigrationsApplied` in [db.ts] at
   app boot, inside the 150 MB process. Each runner then does `INSERT OR IGNORE
   INTO _migrations`. So a file wraps and records itself (the [0094]+ pattern):

   ```sql
   PRAGMA foreign_keys = OFF;   -- only when rebuilding tables; ignored inside a transaction
   BEGIN IMMEDIATE;             -- take the write lock before the first read (0092)
   -- guard, changes, checks
   INSERT OR IGNORE INTO _migrations (filename) VALUES ('0098_example.sql');
   COMMIT;
   PRAGMA foreign_keys = ON;
   ```

   If a statement fails, `db.exec` throws with the transaction still open, and
   the deploy runner's exit rolls it back, so nothing is applied. Recording the
   file before `COMMIT` makes the change and its record commit together.
   Before that, a lock error on the runner's own insert left [0095] applied but
   unrecorded, and every later deploy failed. SQLite has no ASSERT, so
   preconditions ("this table is still empty": empty when written is not empty
   when run) use a guard: a TEMP table with BEFORE INSERT triggers that
   `RAISE(ROLLBACK, '…')` ([0092], [0094]–[0097]).
3. **Old code keeps serving for the seconds between migrate and the pm2
   restart.** Anything it runs against a renamed or dropped name fails with "no
   such table/column"; a sync caught there redoes its work on the next run.
   Write migrations so the old code fails loudly rather than writing wrong
   data, and say in the header what breaks.
4. **Rename = `ALTER TABLE … RENAME` plus rewriting stored SQL, in the same
   transaction.** RENAME changes only the schema: rows and rowids stay. With
   it:
   - `UPDATE builder_blocks SET config = replace(…)` and `UPDATE
     builder_page_versions SET snapshot = replace(…)`, after checking that no
     old name sits inside a longer identifier or in prose (a snapshot holds
     each config as a JSON string inside JSON).
   - Move the `sqlite_stat1` / `sqlite_stat4` rows to the new names: RENAME
     leaves them behind and DROP INDEX deletes them.
   - Recreate indexes whose names must change, since SQLite can't rename an
     index.
   - Leave `builder_pages` alone.

   In the same commit, update the code, the templates in [mir-metrics.ts]
   (fingerprinted, so they re-seed themselves), the revision of any
   hand-numbered seed in [builder-seeds.ts] whose SQL changed, and the rename
   table in §3. [0090] (text rewrite), [0093] (column renames) and [0097]
   (tables, columns, indexes, stats, guard) are the models. A rewrite that
   changes what a block *asks*, not just what it names, is [0099]: its SQL is
   generated from the seed templates so the two cannot drift, it sets only
   `$.sql` / `$.title` / `$.sub` so a hand-restyled block keeps its styling,
   and it rebuilds each Undo snapshot element by element (`json_each` →
   `json_set` → `json(…)` → `json_group_array`) so only the configs that named
   the old table are replaced.
5. **DROP TABLE on a parent cascades.** With foreign keys on, DROP first deletes
   every row and fires the ON DELETE actions. `DROP TABLE organizations` would
   empty 87 tables; dropping `pco_people` fails while the owned tables name
   anyone. Drop children first ([0096] dropped `mir_team_members` before
   `mir_docs`), and guard against rows that appeared after you looked.
6. **Adding a constraint (a foreign key, CHECK or NOT NULL) means rebuilding
   the table** by SQLite's
   [12-step procedure](https://www.sqlite.org/lang_altertable.html#otheralter).
   What bit us: turn `foreign_keys` off outside the transaction; write the new
   DDL as the old text plus the clause, character for character, against what
   `sqlite_master.sql` really holds (production's `pco_plan_items` and
   `sermons` carry the one-line text of the scripts that created them before
   their migrations did); copy with explicit columns *and rowid*
   (`constant_contact_activity`'s `MAX(rowid)` is the email rollups'
   watermark); restore `sqlite_sequence` and the planner stats; run `PRAGMA
   foreign_key_check` before `COMMIT`. The models are [0094] (four owned tables
   → `pco_people`) and [0095] (15 tables → `organizations`; ~105 MB rewritten
   in 2.6–4.5 s with the write lock held).
7. **A sampled ANALYZE misleads the planner.** Nearly every index leads with
   `org_id`, which has one value, so a 400-entry sample sees a handful of
   people and sends per-person lookups on a scan of the whole org (0.01 ms →
   13 ms). Keep `PRAGMA analysis_limit = 0` before any ANALYZE ([0088]).
   [db.ts] runs `optimize = 0x10002` at open and `optimize` after each sync; a
   rebuild should put the old stats back rather than re-analyze.
8. **A new mirrored column** (say, another PCO person attribute) needs:
   - A migration with `ALTER TABLE … ADD COLUMN`, nullable or with a DEFAULT.
     No rebuild, but still the wrapper in step 2, or a lock error on the
     runner's insert re-runs it as "duplicate column name".
   - The field in the matching `src/lib/pco-sync*.ts` upsert (`upsertPerson`
     for people), read under the vendor's spelling.
   - Personal values (birthdate, address and the like) in `enc_pii` via
     `encryptJson`, not in a plaintext column.
   - A backfill: the sync re-fetches only rows PCO changed recently (within
     `sync_threshold_months`), so existing rows stay empty. For people, press Full re-sync on /pco; otherwise write a
     one-time script modelled on `scripts/backfill-name-variants.mjs`.
9. **A new table needs:**
   - `org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE`,
     with indexes that lead with it.
   - `_at` / `_on` names and the `strftime` default.
   - If people type in rows that name a person: `FOREIGN KEY (org_id,
     person_id) REFERENCES pco_people(org_id, pco_id) ON DELETE RESTRICT`, and
     an entry in `HAS_OWNED_DATA_SQL` ([pco-sync.ts]).
   - If rows are per person and copied or computed from PCO: an entry in
     `PERSON_ROW_DELETES` there.
   - A line in this file.

   Measure on a production copy and put the timings and row counts in the
   header, as 0094–0097 do.

[0086]: migrations/0086_integration_credentials.sql
[0088]: migrations/0088_checkin_covering_index.sql
[0089]: migrations/0089_dashboard_refresh_watermark.sql
[0090]: migrations/0090_plan_date_upper_bound.sql
[0091]: migrations/0091_constant_contact_engagement.sql
[0092]: migrations/0092_retire_capture_only_credentials.sql
[0093]: migrations/0093_date_column_names.sql
[0094]: migrations/0094_owned_person_keys.sql
[0095]: migrations/0095_org_keys.sql
[0096]: migrations/0096_remove_dead_schema.sql
[0097]: migrations/0097_clear_names.sql
[0098]: migrations/0098_pushpay_uploads.sql
[0099]: migrations/0099_giving_on_transactions.sql
[db.ts]: ../src/lib/db.ts
[builder.ts]: ../src/lib/builder.ts
[builder-seeds.ts]: ../src/lib/builder-seeds.ts
[mir-metrics.ts]: ../src/lib/mir-metrics.ts
[encryption.ts]: ../src/lib/encryption.ts
[pco.ts]: ../src/lib/pco.ts
[pco-sync.ts]: ../src/lib/pco-sync.ts
[constant-contact-sync.ts]: ../src/lib/constant-contact-sync.ts
[dashboard-refresh.ts]: ../src/lib/dashboard-refresh.ts
[audit-read.ts]: ../src/lib/audit-read.ts
[retention-read.ts]: ../src/lib/retention-read.ts
[care-read.ts]: ../src/lib/care-read.ts
[pushpay-import.ts]: ../src/lib/pushpay-import.ts
[giving-sql.ts]: ../src/lib/giving-sql.ts
[attendance-import.ts]: ../src/lib/attendance-import.ts
[shepherd-intake.ts]: ../src/lib/shepherd-intake.ts
[integrations.ts]: ../src/lib/integrations.ts
[cron route]: ../src/app/api/sync/cron/route.ts
[deploy.yml]: ../.github/workflows/deploy.yml
[osrm-setup.md]: ../docs/osrm-setup.md
