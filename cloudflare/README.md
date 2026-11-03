# Cloudflare migration workspace

This directory is the isolated Cloudflare migration workspace for TG Helper 2.0.

## Status

- [x] Migration branch `feat/cloudflare` created from `main`.
- [x] Initial audit committed.
- [x] D1 schema migration authored from the current Prisma models.
- [x] Prisma schema switched to SQLite and D1 adapter added.
- [x] Reminder claim logic adapted to SQLite-compatible conditional updates.
- [x] Shift writes no longer rely on interactive Prisma transactions; compensating operations are used.
- [x] OpenNext and a separate five-minute cron Worker scaffolded.
- [x] GitHub Actions checks added for Prisma validation, TypeScript, and the Cloudflare build.
- [ ] CI/build results not yet inspected; no local build has been run in this environment.
- [ ] D1 database has not been created or migrated remotely.
- [ ] Neon data export/import and reconciliation have not been run.
- [ ] Worker has not been deployed; Telegram webhook and production traffic have not been changed.

## Important safety boundary

The SQL migration creates an empty D1 schema. It does not copy data from Neon. Do not point the production bot at D1 until the import is complete and verified. Keep the existing Vercel/Neon deployment available during testing and for at least seven stable days after a verified cutover.

## Framework/runtime compatibility

The source app originally used Next.js 14.2.5 and Prisma 5/PostgreSQL. This branch updates the project to Next.js 14.2.35, Prisma 6.19, `@prisma/adapter-d1`, and the OpenNext Cloudflare adapter. Current Cloudflare guidance says Next.js 14 support has ended; this is a known compatibility risk and must be resolved before production deployment, either by verifying the existing adapter build or migrating to the current supported Cloudflare Next.js path.

## D1 schema

Apply locally after dependencies are installed:

```powershell
npm run d1:migrate:local
```

After creating the D1 database in the intended Cloudflare account and replacing the placeholder `database_id` in `wrangler.jsonc`, apply remotely only when ready:

```powershell
npm run d1:migrate:remote
```

The remote command changes the Cloudflare database. Do not run it until the target account/database and backup/import plan are confirmed.

## Runtime variables and secrets

Configure these in the Cloudflare dashboard as Worker secrets/variables, not in source control:

- `TELEGRAM_BOT_TOKEN` (secret)
- `TELEGRAM_WEBHOOK_SECRET` (secret)
- `ALLOWED_TELEGRAM_IDS` (variable; comma-separated Telegram numeric IDs)
- `CRON_SECRET` (secret)

The main Worker uses the D1 binding named `DB`. The cron Worker has its own config at `cloudflare/wrangler.cron.jsonc`, runs every five minutes (UTC), and calls `POST {TG_HELPER_URL}/api/cron/reminders`. Configure the cron Worker's `TG_HELPER_URL` and the same `CRON_SECRET` in both Workers.

Do not deploy the scheduler until the app Worker is deployed, D1 data is imported and verified, and production cutover is approved: it can send real Telegram messages.

## Data migration and cutover

1. Take a normal Neon backup first.
2. On a trusted local machine, set `SOURCE_DATABASE_URL` in the shell (never commit it) and run `npm run data:export-neon`. This creates a consistent, read-only JSON snapshot under `.migration/`.
3. Run `npm run data:prepare-d1-import` to generate `.migration/d1-import.sql`; review the row counts before importing.
4. Confirm the target D1 database is empty, then import with `npx wrangler d1 execute tg-helper-db --remote --file=.migration/d1-import.sql` only after the remote database has been created and its ID is configured.
5. Import preserves primary keys, Telegram IDs, timestamps, reminder statuses, repeat metadata, shift metadata, session drafts, and Telegram file IDs. The export and generated SQL may contain private notes and must stay local.
6. Compare row counts and validate foreign keys and representative records in D1.
4. Run tests against a non-production bot/token and the local/preview Worker.
5. Verify notes, voice notes, saved media, time zones, recurring reminders, shift reminders, retry logic, and authorization.
6. Only after the above succeeds, plan webhook and scheduler cutover.
7. Keep the old Vercel/Neon deployment available for at least seven stable days after cutover.

No production resources, secrets, database data, or Telegram webhook have been changed by the branch edits so far.
