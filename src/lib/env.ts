export interface RuntimeEnv {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  CRON_SECRET: string;
  ALLOWED_TELEGRAM_IDS?: string;
}

let currentEnv: RuntimeEnv | undefined;

export function setRuntimeEnv(value: RuntimeEnv): void {
  currentEnv = value;
}

function required(name: "TELEGRAM_BOT_TOKEN" | "TELEGRAM_WEBHOOK_SECRET" | "CRON_SECRET"): string {
  const value = currentEnv?.[name];
  if (!value || value.trim() === "") {
    throw new Error("Missing required Worker secret: " + name);
  }
  return value;
}

export const env = {
  get TELEGRAM_BOT_TOKEN(): string {
    return required("TELEGRAM_BOT_TOKEN");
  },
  get TELEGRAM_WEBHOOK_SECRET(): string {
    return required("TELEGRAM_WEBHOOK_SECRET");
  },
  get CRON_SECRET(): string {
    return required("CRON_SECRET");
  },
  get ALLOWED_TELEGRAM_IDS(): bigint[] {
    const raw = currentEnv?.ALLOWED_TELEGRAM_IDS?.trim() ?? "";
    if (raw === "") return [];
    return raw.split(",").map((value) => value.trim()).filter(Boolean).map((value) => BigInt(value));
  },
};

export function isAllowedTelegramId(id: bigint): boolean {
  const allowed = env.ALLOWED_TELEGRAM_IDS;
  return allowed.length > 0 && allowed.includes(id);
}
