export interface Env {
  TG_HELPER_URL: string;
  CRON_SECRET: string;
}

export default {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const target = env.TG_HELPER_URL?.trim();
    const secret = env.CRON_SECRET?.trim();
    if (!target || !secret) {
      console.error("TG_HELPER_URL or CRON_SECRET is missing; reminder dispatch skipped.");
      return;
    }

    ctx.waitUntil((async () => {
      const baseUrl = target.replace(new RegExp("/+$"), "");
      const response = await fetch(baseUrl + "/api/cron/reminders", {
        method: "POST",
        headers: { Authorization: "Bearer " + secret },
      });
      if (!response.ok) {
        const body = (await response.text()).slice(0, 1000);
        throw new Error("Reminder endpoint returned HTTP " + response.status + ": " + body);
      }
      console.log("Reminder dispatch completed:", (await response.text()).slice(0, 1000));
    })());
  },
};
