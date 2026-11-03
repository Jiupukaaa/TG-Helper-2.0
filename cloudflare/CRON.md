# Cloudflare reminder scheduler

This is a separate Worker so the app Worker can keep the OpenNext-generated entry point.

- Schedule: every 5 minutes (`*/5 * * * *`, UTC).
- Target: `POST {TG_HELPER_URL}/api/cron/reminders`.
- Authentication: Worker secret `CRON_SECRET`, matching the app Worker's secret.
- Configure `TG_HELPER_URL` in `cloudflare/wrangler.cron.jsonc` to the deployed app Worker URL.
- Set the secret with `npx wrangler secret put CRON_SECRET --config cloudflare/wrangler.cron.jsonc`.
- Deploy with `npm run cf:cron:deploy`.

Do not deploy the scheduler until the app Worker is deployed, D1 has been imported and verified, and the Telegram webhook/cutover plan is ready. The scheduler may send real Telegram messages.
