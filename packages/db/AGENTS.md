# AGENTS.md — packages/db (PostgreSQL via Drizzle)

Shared by the bot and the website.

- Schema: `src/schema/*.ts` (grouped: `guilds`, `moderation`, `security`, `verification`).
  Every table/column has a doc comment — read them before writing queries.
- Change the schema → `pnpm db:generate` → commit the generated SQL in `migrations/`.
  Never hand-edit applied migrations. Pre-1.0 the init migration may be regenerated.
- Apply: `pnpm db:migrate` (or bot auto-migrate). Studio: `pnpm db:studio`.
- Repositories (`src/repositories/*.ts`) hold reusable queries; export them from `src/index.ts`
  as namespaces (`guildRepo`, `cases`, `trust`, …).
- Snowflakes: `varchar(20)`. Timestamps: `timestamptz`. JSONB columns are typed with `$type<>()`.
- Integration tests: `test/*.int.test.ts`, run with `TEST_DATABASE_URL=… pnpm test`.
- Privacy: `fingerprints` stores **hashes only**; `oauth_grants` and `ai_credentials` store
  **encrypted** secrets (`encryptSecret` from `@quill/shared`).
