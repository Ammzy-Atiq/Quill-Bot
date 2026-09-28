import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MIGRATIONS_FOLDER, runMigrations } from '@quill/db';

/**
 * Migrations live in packages/db/migrations. The production bundle copies them to
 * dist/migrations (see tsup.config.ts), so prefer that when it exists.
 */
export function resolveMigrationsDir(): string {
  if (process.env.MIGRATIONS_DIR) return process.env.MIGRATIONS_DIR;
  const bundled = fileURLToPath(new URL('./migrations', import.meta.url));
  if (existsSync(bundled)) return bundled;
  return MIGRATIONS_FOLDER;
}

export async function migrate(databaseUrl: string): Promise<void> {
  await runMigrations(databaseUrl, resolveMigrationsDir());
}
