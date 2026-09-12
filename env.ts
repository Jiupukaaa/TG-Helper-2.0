// Central place to read & validate environment variables.
// Fails fast (at first use) with a clear error instead of a confusing
// downstream crash, and never logs the actual secret values.

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : fallback;
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
  get DATABASE_URL(): string {
    return required("DATABASE_URL");
  },
  get ALLOWED_TELEGRAM_IDS(): bigint[] {
    const raw = optional("ALLOWED_TELEGRAM_IDS", "");
    if (raw === "") return [];
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => BigInt(s));
  },
};

export function isAllowedTelegramId(id: bigint): boolean {
  const allowed = env.ALLOWED_TELEGRAM_IDS;
  // If the allowlist is empty, deny everyone by default rather than
  // silently allowing anyone — an unconfigured allowlist should not mean
  // "public bot".
  if (allowed.length === 0) return false;
  return allowed.includes(id);
}
