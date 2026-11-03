# TG Helper 2.0 — native Cloudflare Worker migration

## Architecture

- One module Worker entry point: `src/index.ts`.
- `GET /` and `GET /health` are health checks.
- `POST /telegram` validates Telegram's `X-Telegram-Bot-Api-Secret-Token` before handing the request to grammY's `cloudflare-mod` adapter.
- The same Worker exports `scheduled()`; Wrangler triggers it every five minutes.
- D1 is bound as `env.DB`. All runtime persistence uses prepared SQL statements in `src/db/client.ts`; no Prisma client or Node.js compatibility flag is required.
- Multi-statement writes use `DB.batch()` so D1 rolls back the whole operation if a statement fails.
- `webhook_dedup` is an internal D1 ledger for Telegram `update_id` idempotency. It is not part of the six-table Neon data import and is cleaned up after seven days.

## Local setup

1. Install dependencies with Node.js 22 or newer.
2. Create a local `.dev.vars` file (ignored by Git) containing:
   ```dotenv
   TELEGRAM_BOT_TOKEN=your-test-bot-token
   TELEGRAM_WEBHOOK_SECRET=your-local-webhook-secret
   CRON_SECRET=your-local-cron-secret
   ALLOWED_TELEGRAM_IDS=123456789
   ```
3. Keep the placeholder `database_id` in `wrangler.jsonc` for local development. Replace it with the actual D1 database ID before any remote migration or deployment.
4. Apply the schema locally:
   ```powershell
   npm run db:migrate:local
   ```
5. Type-check and start the Worker:
   ```powershell
   npm run typecheck
   npm run dev
   ```

## Cloudflare configuration

Create the intended D1 database with `npx wrangler d1 create tg-helper` (or select an existing empty target), then replace the all-zero `database_id` in `wrangler.jsonc` with the returned ID. Configure these Worker secrets in Cloudflare:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `CRON_SECRET`

Configure `ALLOWED_TELEGRAM_IDS` as a Worker variable containing comma-separated numeric Telegram user IDs. An empty allowlist denies all users.

Set the secrets using the Cloudflare dashboard or `npx wrangler secret put <SECRET_NAME>`. Set `ALLOWED_TELEGRAM_IDS` as a non-secret Worker variable. Only after a backup and verified data import, apply the D1 migration remotely and deploy:

```powershell
npm run db:migrate:remote
npm run deploy
```

The scheduled trigger is in the same Worker configuration. There is no separate cron Worker. After deployment and smoke tests, register Telegram's webhook at `https://<worker-host>/telegram` with `secret_token` set to the exact `TELEGRAM_WEBHOOK_SECRET` value. Do not change the production webhook before the data-import and rollback gates above are complete.

## Data migration and cutover safety

The migration branch must not be pointed at production traffic until the existing Neon data is imported and reconciled. The master prompt refers to local migration utilities under `tg-helper-migration/`; use those existing utilities from the trusted local project folder and do not commit their exports or SQL snapshots. Those files are not part of the current GitHub `main` tree, so they cannot be executed through the repository connector alone.

Before production cutover:

1. Take a separate Neon backup.
2. Run the existing export and D1 conversion tools locally; keep snapshot and generated SQL files out of Git.
3. Apply the D1 schema and import only into the intended empty target database.
4. Compare row counts for all six tables, run `PRAGMA foreign_key_check`, and inspect representative records including voice file IDs and session drafts.
5. Test authorization, notes, saved items, time zones, repeat reminders, shift cycles, retry handling, and scheduled dispatch with a non-production bot.
6. Pause old writes/cron for the final snapshot, complete the import, and only then change Telegram's webhook to `/telegram`.
7. Keep the previous Vercel/Neon deployment available for at least seven stable days after cutover.

No D1 database has been created or migrated remotely, no production secrets have been set, and no Telegram webhook has been changed by the code edits in this branch.
