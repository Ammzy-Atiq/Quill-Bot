import type { CustomWordMatchMode } from '@quill/shared';
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import type { Database } from '../client.js';
import { aiCredentials, customPolicies, customWords, scamDomains, scamImageHashes } from '../schema/index.js';

export type CustomWordRow = typeof customWords.$inferSelect;
export type CustomPolicyRow = typeof customPolicies.$inferSelect;
export type AiCredentialRow = typeof aiCredentials.$inferSelect;

// ── custom words ─────────────────────────────────────────────────────────────
export async function listCustomWords(db: Database, guildId: string): Promise<CustomWordRow[]> {
  return db.select().from(customWords).where(eq(customWords.guildId, guildId)).orderBy(asc(customWords.term));
}

export async function addCustomWord(
  db: Database,
  input: { guildId: string; term: string; match: CustomWordMatchMode; severity: number; createdBy: string },
): Promise<CustomWordRow> {
  const [row] = await db
    .insert(customWords)
    .values(input)
    .onConflictDoUpdate({
      target: [customWords.guildId, customWords.term],
      set: { match: input.match, severity: input.severity },
    })
    .returning();
  return row!;
}

export async function removeCustomWord(db: Database, guildId: string, term: string): Promise<boolean> {
  const rows = await db
    .delete(customWords)
    .where(and(eq(customWords.guildId, guildId), eq(customWords.term, term)))
    .returning({ id: customWords.id });
  return rows.length > 0;
}

// ── custom policies ──────────────────────────────────────────────────────────
export async function listPolicies(db: Database, guildId: string): Promise<CustomPolicyRow[]> {
  return db
    .select()
    .from(customPolicies)
    .where(eq(customPolicies.guildId, guildId))
    .orderBy(asc(customPolicies.name));
}

export async function upsertPolicy(
  db: Database,
  input: {
    guildId: string;
    name: string;
    definition: Record<string, unknown>;
    createdBy: string;
    enabled?: boolean;
  },
): Promise<CustomPolicyRow> {
  const [row] = await db
    .insert(customPolicies)
    .values({ ...input, enabled: input.enabled ?? true })
    .onConflictDoUpdate({
      target: [customPolicies.guildId, customPolicies.name],
      set: { definition: input.definition, enabled: input.enabled ?? true },
    })
    .returning();
  return row!;
}

export async function setPolicyEnabled(db: Database, guildId: string, name: string, enabled: boolean) {
  const rows = await db
    .update(customPolicies)
    .set({ enabled })
    .where(and(eq(customPolicies.guildId, guildId), eq(customPolicies.name, name)))
    .returning({ id: customPolicies.id });
  return rows.length > 0;
}

export async function removePolicy(db: Database, guildId: string, name: string): Promise<boolean> {
  const rows = await db
    .delete(customPolicies)
    .where(and(eq(customPolicies.guildId, guildId), eq(customPolicies.name, name)))
    .returning({ id: customPolicies.id });
  return rows.length > 0;
}

// ── scam intelligence ────────────────────────────────────────────────────────
export async function listScamDomains(db: Database): Promise<string[]> {
  const rows = await db.select({ domain: scamDomains.domain }).from(scamDomains);
  return rows.map((r) => r.domain);
}

export async function addScamDomain(db: Database, domain: string, addedBy: string | null, source = 'guild') {
  await db.insert(scamDomains).values({ domain, addedBy, source }).onConflictDoNothing();
}

export async function removeScamDomain(db: Database, domain: string): Promise<boolean> {
  const rows = await db
    .delete(scamDomains)
    .where(eq(scamDomains.domain, domain))
    .returning({ d: scamDomains.domain });
  return rows.length > 0;
}

/** Global hashes + this guild's own hashes. */
export async function listScamImageHashes(db: Database, guildId?: string): Promise<string[]> {
  const rows = await db
    .select({ hash: scamImageHashes.hash })
    .from(scamImageHashes)
    .where(guildId ? or(isNull(scamImageHashes.guildId), eq(scamImageHashes.guildId, guildId)) : undefined);
  return rows.map((r) => r.hash);
}

export async function addScamImageHash(
  db: Database,
  input: { hash: string; label: string; guildId: string | null; addedBy: string | null },
) {
  await db.insert(scamImageHashes).values(input);
}

// ── BYOK AI credentials ──────────────────────────────────────────────────────
export async function getAiCredential(db: Database, guildId: string): Promise<AiCredentialRow | undefined> {
  return db.query.aiCredentials.findFirst({ where: eq(aiCredentials.guildId, guildId) });
}

export async function saveAiCredential(
  db: Database,
  input: {
    guildId: string;
    provider: string;
    model: string;
    baseUrl: string | null;
    apiKeyEnc: string;
    createdBy: string;
  },
): Promise<void> {
  await db
    .insert(aiCredentials)
    .values(input)
    .onConflictDoUpdate({
      target: aiCredentials.guildId,
      set: {
        provider: input.provider,
        model: input.model,
        baseUrl: input.baseUrl,
        apiKeyEnc: input.apiKeyEnc,
      },
    });
}

export async function deleteAiCredential(db: Database, guildId: string): Promise<boolean> {
  const rows = await db
    .delete(aiCredentials)
    .where(eq(aiCredentials.guildId, guildId))
    .returning({ g: aiCredentials.guildId });
  return rows.length > 0;
}
