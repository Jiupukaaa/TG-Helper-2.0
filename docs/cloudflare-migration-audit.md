# TG Helper 2.0 — Cloudflare migration audit

## Status

- Migration branch: `feat/cloudflare`
- Base branch: `main`
- Audit stage: initial repository inventory; implementation and runtime verification are not yet complete.
- Production resources and secrets have not been changed.

## Current implementation observed on `main`

- Next.js 14 App Router / TypeScript application.
- grammY Telegram bot webhook at `src/app/api/telegram/webhook/route.ts`.
- Reminder dispatch endpoint at `src/app/api/cron/reminders/route.ts`.
- Prisma 5.x with PostgreSQL provider and a set of historical Prisma migrations.
- Existing scheduled reminder workflow at `.github/workflows/trigger-reminders.yml`.
- Existing environment variables include Telegram bot token, webhook secret, allowed Telegram IDs, database URL and cron secret.
- README documents notes (including voice notes), reminders (including repeat rules), timezone handling, work shifts/cycles, calendar and saved links/photos/GIFs.

## Initial migration risks

1. D1 is SQLite-based; the current Prisma schema/migrations target PostgreSQL. A direct connection-string swap is not a valid migration.
2. Next.js 14 deployment compatibility on Cloudflare Workers must be established before choosing whether to adapt the Next.js runtime or implement a Worker-native entry point.
3. Voice notes and saved media must be checked for Telegram file-id persistence and must not depend on local filesystem storage.
4. Reminder scheduling must preserve timezone conversions, recurring reminder semantics, access control, and duplicate-send protections.
5. Existing user data must be exported and reconciled before any production cutover. No production database changes are authorized by this audit.
6. Environment variables and secrets must never be committed to the repository.

## Work plan

1. Complete source inventory and feature-to-code mapping.
2. Select and document a Cloudflare-compatible runtime and D1 data-access approach based on the actual schema and dependencies.
3. Implement D1 schema migrations and data-access changes without deleting existing functionality.
4. Add/update tests for access control, notes, reminder creation/dispatch, recurrence, timezone boundaries, shifts and saved items.
5. Verify type-check/build/tests in a reproducible environment and document any checks that cannot run.
6. Prepare a separate, reversible data migration and cutover checklist. Do not switch Telegram webhook or production traffic until backup, row-count reconciliation and smoke tests pass.

## Verification rules

- Keep all migration changes on `feat/cloudflare`.
- Do not merge into `main` as part of implementation.
- Do not create, alter, or delete production Cloudflare resources or production database data without explicit confirmation and a verified backup.
- Report unrun checks honestly; a GitHub commit is not evidence that the application builds or works at runtime.
