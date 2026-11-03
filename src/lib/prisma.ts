import { getCloudflareContext } from "@opennextjs/cloudflare";
import { PrismaD1 } from "@prisma/adapter-d1";
import { PrismaClient } from "@prisma/client";

type RuntimeEnv = {
  DB?: ConstructorParameters<typeof PrismaD1>[0];
};

let d1Binding: RuntimeEnv["DB"];
let d1Client: PrismaClient | undefined;
let localClient: PrismaClient | undefined;

/**
 * Resolve the client lazily because Cloudflare bindings only exist in a request
 * context. A client is cached per warm Worker isolate/binding, not globally
 * before the request context is available.
 *
 * D1 does not support interactive transactions; callers must not rely on
 * Prisma $transaction semantics in production.
 */
async function resolvePrismaClient(): Promise<PrismaClient> {
  try {
    const context = await getCloudflareContext({ async: true });
    const db = (context.env as RuntimeEnv).DB;

    if (db) {
      if (!d1Client || d1Binding !== db) {
        d1Binding = db;
        d1Client = new PrismaClient({
          adapter: new PrismaD1(db),
          log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
        });
      }
      return d1Client;
    }
  } catch (error) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "Cloudflare D1 binding is unavailable. Ensure the request runs in Workers and wrangler.jsonc binds the database as DB.",
        { cause: error },
      );
    }
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("Cloudflare D1 binding DB was not found in the Worker environment.");
  }

  // Local Next.js development uses the SQLite file URL in prisma/schema.prisma.
  localClient ??= new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
  return localClient;
}

/**
 * Preserve the existing prisma.model.method call sites while resolving the
 * request-scoped D1 binding lazily. This avoids rewriting every bot service
 * solely to pass a Cloudflare binding through the call graph.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property: string | symbol) {
    if (typeof property !== "string") return undefined;

    if (property.startsWith("$")) {
      return (...args: unknown[]) =>
        resolvePrismaClient().then((client) =>
          Reflect.apply((client as unknown as Record<string, (...args: unknown[]) => unknown>)[property]!, client, args),
        );
    }

    return new Proxy({}, {
      get(_delegate, method: string | symbol) {
        if (typeof method !== "string") return undefined;
        return (...args: unknown[]) =>
          resolvePrismaClient().then((client) => {
            const delegate = (client as unknown as Record<string, Record<string, (...args: unknown[]) => unknown>>)[property];
            return Reflect.apply(delegate[method]!, delegate, args);
          });
      },
    });
  },
});
