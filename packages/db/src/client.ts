import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

export type Database = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Database;
  pool: pg.Pool;
  close: () => Promise<void>;
}

export interface CreateDbOptions {
  /** Max pool connections per process (shards each open their own pool). */
  max?: number;
  /** Enable TLS (most managed Postgres hosts: Neon, Supabase, Render...). Auto-enabled for `sslmode=require`. */
  ssl?: boolean;
  applicationName?: string;
}

export function createDb(connectionString: string, options: CreateDbOptions = {}): DbHandle {
  const wantsSsl = options.ssl ?? /sslmode=(require|verify-full|verify-ca)/.test(connectionString);
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: options.applicationName ?? 'quill-guard',
    ...(wantsSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}
