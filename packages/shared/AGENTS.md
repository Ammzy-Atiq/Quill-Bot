# AGENTS.md — packages/shared (contracts)

Shared by the bot and the website. Everything here is a **contract**: breaking changes must be
reflected on both sides in the same change and noted in the root `AGENTS.md` (§8, §11).

- `src/config/*` — zod schemas + defaults for the per-guild config. Add fields **with defaults**;
  nested objects use `.prefault({})` so partial input still gets inner defaults.
  `parseGuildConfig` never throws (invalid modules fall back to defaults).
- `src/config/paths.ts` — `getAtPath` / `setAtPath` / `unsetAtPath` for sparse config edits.
- `src/contracts/` — Redis channels + payload schemas, verification token, queue names, Redis keys.
- `src/crypto.ts` — AES-256-GCM secrets, HMAC hashing (IPs), tokens, masking, IP prefixes.
- `src/actions.ts` — moderation actions, case types, anti-nuke action keys, dangerous permissions.
- `src/brand.ts` — colours and names (website + generated images).
- Node-only APIs are allowed in `crypto.ts` and `contracts/verification-token.ts` (server side).

**Browser-safe entry points** (no `node:` imports) — use these from `packages/core` and from
client components: `@quill/shared/config`, `@quill/shared/actions`, `@quill/shared/wordlists`,
`@quill/shared/constants`, `@quill/shared/brand`, `@quill/shared/redis`.
The root `@quill/shared` and `@quill/shared/contracts` / `@quill/shared/crypto` are **server-only**.
