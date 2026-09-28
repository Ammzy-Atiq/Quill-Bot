import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client.js';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

/** Applies all pending migrations. Safe to run on every deploy. */
export async function runMigrations(
  databaseUrl: string,
  migrationsFolder = MIGRATIONS_FOLDER,
): Promise<void> {
  const handle = createDb(databaseUrl, { max: 1, applicationName: 'quill-migrate' });
  try {
    await migrate(handle.db, { migrationsFolder });
  } finally {
    await handle.close();
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  runMigrations(url)
    .then(() => {
      console.log('✔ migrations applied');
    })
    .catch((error: unknown) => {
      console.error('✖ migration failed', error);
      process.exit(1);
    });
}
