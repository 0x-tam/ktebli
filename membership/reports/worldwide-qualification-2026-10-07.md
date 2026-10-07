# Worldwide catalogue qualification — 2026-10-07

## Isolated child branch

- Asserted `INGEST_DATABASE_URL` host equals `MEMBERSHIP_EXPECTED_DB_HOST` before import; credentials and endpoint were not recorded here.
- Reimported the refreshed, HTML-entity-decoded bounded Grants.gov artifact using the membership ingestion role. Importer accepted all 20 records; no rows were deleted.
- Readback confirmed 20 Grants.gov records, all 20 `detail_status=verified`, all 20 with `locations.scope=unknown`, and one matching source-run coverage row marked `incomplete` with expected total 847. This preserves uncertainty and does not claim a complete feed.
- The source checkpoint covered 2 pages and ended at offset 20 (`page_limit_reached`). SAM.gov was not selected because no API key was configured.

Artifact: `/private/tmp/ktebli-worldwide-grants-batch/opportunities.json`
SHA-256: `60c410a73837bf774f6854a21a1b4202e6faa96e9ca00fa53392e21fc3fda405`

Checkpoint: `/private/tmp/ktebli-worldwide-grants-batch/coverage.json`
SHA-256: `2b98484b7d26c0b4e76234deabd125a15108bd6b8fe877189ac00cff6bf844c0`

## Local verification

- `npm run typecheck`
- `npm test` — 26 tests passed
- `npm run lint`
- `npm run format:check`
- `node --test crawler/test/worldwide.test.mjs` — 8 tests passed
- `MEMBERSHIP_TEST_PG_SOCKET=/private/tmp/ktebli-membership-pg/socket npm run test:db` — passed on disposable `membership_test`
- `MEMBERSHIP_TEST_PG_SOCKET=/private/tmp/ktebli-membership-pg/socket npm run test:catalogue-runner` — 3 tests passed

No production migration, deployment, or commit was performed. The isolated PostgreSQL integration ran migrations 001–005; the separate child-branch migration trial was reported by the parent before this import qualification.
