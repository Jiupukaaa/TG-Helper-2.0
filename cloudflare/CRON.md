# Scheduler

The five-minute scheduler is integrated into the single Worker through `triggers.crons` in `wrangler.jsonc` and the `scheduled()` export in `src/index.ts`. Do not deploy a separate cron Worker. See `cloudflare/README.md` for setup and cutover requirements.
