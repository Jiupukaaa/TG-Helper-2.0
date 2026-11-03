# TG Helper 2.0 — Cloudflare migration audit

## Status

- Migration branch: `feat/cloudflare`
- Base branch: `main`
- Production resources, secrets, database contents, and Telegram webhook have not been changed.
- This document records the initial source inventory and the current native Worker migration direction.

## Original implementation observed on `main`

- Next.js 14 App Router / TypeScript application.
- grammY Telegram webhook at `src/app/api/telegram/webhook/route.ts`.
- Reminder dispatch endpoint at `src/app/api/cron/reminders/route.ts`.
- Prisma 5.x with PostgreSQL/Neon and historical PostgreSQL migrations.
- GitHub Actions workflow at `.github/workflows/trigger-reminders.yml`.
- Features include text and voice notes, reminders and recurrence, timezone handling, work shifts/cycles, calendar, and saved links/photos/GIFs.

## Architecture required by the master prompt

- One native Cloudflare Module Worker at `src/index.ts`.
- Telegram webhook at `POST /telegram`, with the secret header validated before grammY's `cloudflare-mod` adapter.
- The same Worker handles `scheduled()` every five minutes and an optional authenticated `POST /internal/run-reminders` endpoint.
- D1 binding `DB`; prepared SQL statements and `DB.batch()` replace Prisma in runtime.
- No Next.js runtime, OpenNext adapter, Prisma client, separate cron Worker, or `nodejs_compat` flag.
- D1 schema is defined in `cloudflare/migrations/0001_initial.sql`.

## Current branch progress

- [x] `feat/cloudflare` created from `main`; changes remain isolated to this branch.
- [x] Native Worker entry point, D1 query helpers, domain types, and Worker-bound secrets implemented.
- [x] Notes, saved items, reminders, sessions, and shifts moved to SQL queries.
- [x] Shift creation/update operations use atomic D1 batches; reminder claiming uses one conditional `UPDATE ... RETURNING`.
- [x] Single Worker cron trigger added to `wrangler.jsonc`.
- [x] Prisma and Next.js dependencies removed from `package.json`; legacy wrapper files are retired or excluded.
- [x] CI workflow added for TypeScript checking and Wrangler dry-run bundling.
- [ ] Type-check and Worker dry-run results still need verification.
- [x] D1 migration SQL and core insert/claim/cascade statements passed manual SQLite smoke checks in an isolated local database.
- [ ] Wrangler local D1 migration and Worker runtime tests still need to run.
- [ ] Neon data export/import, row-count reconciliation, and foreign-key validation remain outstanding.
- [ ] No Cloudflare database has been created or migrated remotely; no production webhook has been switched.

## Initial migration risks

1. D1 is SQLite-based, so PostgreSQL SQL and Prisma persistence cannot be reused directly.
2. Telegram file IDs, UTC timestamps, repeat metadata, and session JSON must survive the data transfer.
3. Reminder claiming must remain atomic and retry-safe under concurrent webhook and scheduled invocations.
4. The D1 schema and all foreign keys must be validated before production traffic moves.
5. A consistent Neon export must be taken after old writes are paused for final cutover; an earlier snapshot can become stale while the bot continues running.
6. Secrets, database URLs, data snapshots, and generated import SQL must never be committed.

## Verification and cutover rules

- Keep all migration changes on `feat/cloudflare`; do not merge into `main` as part of implementation.
- Do not create, alter, or delete production Cloudflare resources or production database data without explicit confirmation and a verified backup.
- Use the existing local tools under `tg-helper-migration/` for Neon export and D1 conversion; do not recreate or commit their snapshots. Those files are not in the GitHub `main` tree available through the repository connector.
- Test access control, notes, voice notes, saved media, time zones, repeat reminders, shift cycles, retry handling, and scheduled dispatch using a non-production bot.
- Do not switch the Telegram webhook or production traffic until data import, row-count reconciliation, `PRAGMA foreign_key_check`, and smoke tests pass.
- Keep the old Vercel/Neon deployment available for at least seven stable days after a verified cutover.
- Report unrun checks honestly; a GitHub commit is not evidence that the Worker builds or works at runtime.
