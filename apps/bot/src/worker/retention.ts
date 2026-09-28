import { schema } from '@quill/db';
import { and, lt, sql } from 'drizzle-orm';
import type { WorkerContext } from './jobs.js';

const DAY = 24 * 60 * 60 * 1000;

/**
 * Data retention (privacy by design):
 * - security events older than 90 days
 * - fingerprints older than 180 days (hashed data only, but still minimised)
 * - expired, never-completed verification sessions older than 7 days
 * - guilds QUILL left more than 30 days ago: config + trust entries
 */
export async function runRetention({ db, logger }: WorkerContext) {
  const now = Date.now();
  const events = await db
    .delete(schema.securityEvents)
    .where(lt(schema.securityEvents.createdAt, new Date(now - 90 * DAY)))
    .returning({ id: schema.securityEvents.id });
  const prints = await db
    .delete(schema.fingerprints)
    .where(lt(schema.fingerprints.createdAt, new Date(now - 180 * DAY)))
    .returning({ id: schema.fingerprints.id });
  const sessions = await db
    .delete(schema.verificationSessions)
    .where(
      and(
        lt(schema.verificationSessions.expiresAt, new Date(now - 7 * DAY)),
        sql`${schema.verificationSessions.status} <> 'completed'`,
      ),
    )
    .returning({ id: schema.verificationSessions.id });
  const leftCutoff = new Date(now - 30 * DAY);
  await db.execute(sql`
    DELETE FROM guild_settings WHERE guild_id IN (SELECT id FROM guilds WHERE left_at IS NOT NULL AND left_at < ${leftCutoff})
  `);
  await db.execute(sql`
    DELETE FROM trust_entries WHERE guild_id IN (SELECT id FROM guilds WHERE left_at IS NOT NULL AND left_at < ${leftCutoff})
  `);
  const summary = { events: events.length, fingerprints: prints.length, sessions: sessions.length };
  logger.info(summary, 'retention cleanup done');
  return summary;
}
