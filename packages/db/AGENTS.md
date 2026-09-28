# AGENTS.md — packages/db (PostgreSQL via Drizzle)

Shared by the bot and the website.

- Schema: `src/schema/*.ts` (grouped: `guilds`, `moderation`, `security`, `verification`).
  Every table/column has a doc comment — read them before writing queries.
- Change the schema → `pnpm db:generate` → commit the generated SQL in `migrations/`.
  Never hand-edit applied migrations. Pre-1.0 the init migration may be regenerated.
- Apply: `pnpm db:migrate` (or bot auto-migrate). Studio: `pnpm db:studio`.
- Repositories (`src/repositories/*.ts`) hold reusable queries; export them from `src/index.ts`
  as namespaces:
  | Namespace | File | Covers |
  |---|---|---|
  | `guildRepo` | `guilds.ts` | guild rows, sparse settings + optimistic concurrency (`ConfigVersionConflictError`), counters, config audit |
  | `trust` | `trust.ts` | extra owners + per-action whitelist (`trust_entries`) |
  | `cases` | `cases.ts` | per-guild numbered cases, warnings |
  | `riskRepo` | `risk.ts` | persisted risk scores |
  | `automodRepo` | `automod.ts` | custom words, policies, scam domains / image hashes, encrypted AI credentials |
  | `banRepo` | `bans.ts` | `guild_bans` mirror (ban-evasion checks) |
  | `securityRepo` | `security.ts` | incidents, security events, snapshots (`latestSnapshot(…, before)`), emergency state |
  | `verificationRepo` | `verification.ts` | sessions, OAuth grants, fingerprints, alt candidates + identity links, standing, network bans, guild verifications, SSO identities, backup consent, data deletion (API: `apps/website/AGENTS.md` §6) |
- Owner: **bot-agent** (schema, migrations, repositories). The website keeps website-only
  queries in `apps/website/src/server/db/` and requests schema changes under root §10 *Open issues*.
- Snowflakes: `varchar(20)`. Timestamps: `timestamptz`. JSONB columns are typed with `$type<>()`.
- Integration tests: `test/*.int.test.ts`, run with `TEST_DATABASE_URL=… pnpm test`.
- Privacy: `fingerprints` stores **hashes only**; `oauth_grants` and `ai_credentials` store
  **encrypted** secrets (`encryptSecret` from `@quill/shared`).
