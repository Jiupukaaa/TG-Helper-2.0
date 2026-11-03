export type SqlValue = string | number | null | ArrayBuffer | ArrayBufferView;

let database: D1Database | undefined;

export function setDB(db: D1Database): void {
  database = db;
}

export function getDB(): D1Database {
  if (!database) throw new Error("D1 binding is not initialized for this Worker invocation.");
  return database;
}

export function statement(query: string, ...values: SqlValue[]): D1PreparedStatement {
  return getDB().prepare(query).bind(...values);
}

export async function all<T>(query: string, ...values: SqlValue[]): Promise<T[]> {
  const result = await statement(query, ...values).all<T>();
  return result.results;
}

export async function first<T>(query: string, ...values: SqlValue[]): Promise<T | null> {
  return statement(query, ...values).first<T>();
}

export async function run(query: string, ...values: SqlValue[]): Promise<D1Result> {
  return statement(query, ...values).run();
}

export async function batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
  return getDB().batch(statements);
}
