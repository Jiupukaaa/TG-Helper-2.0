# Cloudflare migration workspace

This directory is the isolated Cloudflare migration workspace for TG Helper 2.0.

## Current status

- [x] Migration branch `feat/cloudflare` created from `main`.
- [x] Initial audit committed.
- [x] Initial D1 schema migration authored from the current Prisma models.
- [ ] Runtime adapter and framework compatibility not yet implemented.
- [ ] Migration SQL not yet applied to local or remote D1.
- [ ] Neon data export/import and reconciliation not yet run.
- [ ] Worker not yet deployed; Telegram webhook has not been changed.

## Important safety boundary

The SQL migration creates an empty D1 schema. It does not copy data from Neon. Do not point the production bot at D1 until the import is complete and verified. Keep the existing Vercel/Neon deployment available during testing and for at least seven stable days after a verified cutover.

## D1 schema

Apply locally after installing/configuring Wrangler:

```powershell
npx wrangler d1 migrations apply tg-helper-db --local
```

After creating the D1 database in the intended Cloudflare account and replacing the placeholder `database_id` in `wrangler.jsonc`, apply remotely only when explicitly ready:

```powershell
npx wrangler d1 migrations apply tg-helper-db --remote
```

The remote command changes the Cloudflare database. Do not run it until the target account/database and backup/import plan are confirmed.

## Framework/runtime

The source app is Next.js 14.2.5 and uses Prisma 5 with PostgreSQL. That is not compatible with this D1 binding as-is. The runtime must be migrated to a supported Cloudflare adapter, Prisma must be moved to a SQLite/D1-compatible setup, and code must be tested against D1's transaction and DateTime behavior before deployment.

Cloudflare currently recommends vinext for new Next.js-on-Workers migrations; OpenNext remains a documented option for maintaining existing Next.js applications. This branch currently has an OpenNext-shaped Wrangler entry point, but no claim is made that the current Next.js 14 app builds on it. Compatibility must be verified before treating the config as deployable.
