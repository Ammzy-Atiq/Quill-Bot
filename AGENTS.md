# AGENTS.md — QUILL GUARD

> **Read this first.** This file is the single source of truth for every AI agent (and human)
> working in this repository. It explains the product, the architecture, the file layout, the
> data formats and the rules that let several agents work in parallel without breaking each
> other. **Keep it current:** when you finish work, update the *Status board* and *Changelog*.
>
> Product: **QUILL GUARD** — an advanced Discord security bot.
> Creator: **Atiq Ur Rahman**. Credit him in user-facing "about"/footer places.

---

## 1. What we are building

QUILL GUARD protects Discord servers with three pillars tied together by one shared **Risk Engine**:

| Pillar | One-liner |
|---|---|
| **AutoMod** | A **normalizer** that sees through Unicode tricks, spacing, repetition, leetspeak and homoglyphs, feeding a curated **2000+ term** categorized word list plus detectors for spam, scams (MrBeast/Elon/crypto/free-Nitro, compromised accounts), advertising/links, harassment, toxicity and **AI analysis using the server's own API key (BYOK)**. Custom server policies, words, severities and messages. |
| **Verification** | Members verify on the QUILL **website** with Discord OAuth2 (`identify` + `guilds.join`). The website builds a privacy-preserving **fingerprint** (hashed IP / network / device signals) to catch **alt accounts, ban evasion and punishment evasion**. Verified users can be re-added to a backup server if the main one is nuked (`guilds.join`). **SSO:** verify once, trusted in every QUILL server that opts in. |
| **Anti-Nuke** | Modelled on the **Olympus** bot: owner + **extra owners**, **per-user per-action whitelist**, strict (instant) or threshold detection from the audit-log gateway event, punishment (ban/kick/strip/quarantine), **revert** of the destructive action, **emergency mode** (strip dangerous permissions, restore later), threat levels, anti-betray monitoring of trusted users, snapshots & recovery, hardening audit, red-team simulation. Plus **Anti-Raid** (join spikes, raid mode). |
| **Risk Engine** | One decaying risk score per member per server. Every violation adds points; a configurable ladder escalates warn → timeout → kick → ban. Verification signals (alt suspicion, verified status) change how fast risk grows. |

Every bot message uses **Discord Components V2** (containers, text displays, sections, separators,
media galleries, action rows) **with no accent colour / side bar**. Never classic embeds.

---

## 2. Status board

Legend: ✅ done · 🚧 in progress · ⏳ planned. Owners: **bot-agent** (this repo's Discord bot work),
**website-agent** (see `apps/website/AGENTS.md`).

| Area | Status | Owner | Notes |
|---|---|---|---|
| Monorepo, tooling, Docker, env | ✅ | bot-agent | pnpm workspaces, TS 7, Biome, Vitest, tsup |
| `packages/shared` config schemas + contracts + crypto | ✅ | bot-agent | Contract changes → §8 |
| `packages/db` schema + migrations + repositories | ✅ | bot-agent | 25 tables, Drizzle |
| Bot framework (sharding, router, permissions, V2 UI kit) | ✅ | bot-agent | |
| `/help` `/about` `/ping` `/setup` `/logs` `/case` | ✅ | bot-agent | |
| Core engine: normalizer, word lists, matcher, risk engine, verification evaluator | ⏳ | bot-agent | Phase 2 (website needs `evaluateVerification`) |
| AutoMod module (detectors, BYOK AI, policies, templates) | ⏳ | bot-agent | Phase 3 |
| Anti-Nuke + Anti-Raid + snapshots/recovery + worker jobs | ⏳ | bot-agent | Phase 4 |
| Verification (bot side), SSO, evasion, member backup job | ⏳ | bot-agent | Phase 5 |
| Moderation commands, `/messages`, native AutoMod sync | ⏳ | bot-agent | Phase 6 |
| Website (landing, verify flow, OAuth, fingerprint, dashboard) | ⏳ | website-agent | Spec: `apps/website/AGENTS.md` |

---

## 3. Repository map

```
Quill-Bot/
├─ AGENTS.md                ← you are here (master guide; keep updated)
├─ README.md                ← human quick-start
├─ .env.example             ← every environment variable, documented
├─ docker-compose.yml       ← postgres + redis (+ bot + worker)
├─ Dockerfile               ← production image for bot/worker
├─ assets/brand/            ← quill-logo.webp + brand.md (colour tokens)
├─ apps/
│  ├─ bot/                  ← Discord bot (discord.js v14) + worker   [bot-agent]
│  │  ├─ AGENTS.md          ← bot-specific conventions
│  │  ├─ src/index.ts       ← production entry: migrations + ShardingManager
│  │  ├─ src/shard.ts       ← one shard (dev entry too; `--dry-run` boot check)
│  │  ├─ src/worker.ts      ← BullMQ worker (REST-only jobs)
│  │  ├─ src/app.ts         ← App container (client, db, store, services)
│  │  ├─ src/framework/     ← command/component/event types, router, permissions, custom ids
│  │  ├─ src/ui/            ← Components V2 kit: Card, presets, respond helpers, limits
│  │  ├─ src/services/      ← guild config cache, trust, logs, cases
│  │  ├─ src/modules/       ← feature modules (general, logging, cases, automod, antinuke, …)
│  │  ├─ src/worker/        ← job handlers
│  │  ├─ scripts/           ← deploy-commands, export-manifest
│  │  └─ test/              ← bot tests
│  └─ website/              ← QUILL website (Next.js)                  [website-agent]
│     └─ AGENTS.md          ← FULL website build spec
└─ packages/
   ├─ shared/               ← zod config schemas, contracts, crypto, brand   (both sides)
   ├─ db/                   ← Drizzle schema, migrations, repositories      (both sides)
   └─ core/                 ← framework-free engine: normalizer, detectors, risk, anti-nuke scoring,
                               verification matcher (bot + website import it)
```

Workspace packages are consumed **as TypeScript source** (`exports` → `./src/*.ts`). Anything
that runs them (tsx, Vitest, tsup, Next.js `transpilePackages`) compiles them on the fly.

---

## 4. Architecture

```
                        ┌──────────── Discord ────────────┐
                        │ gateway events · REST · OAuth2   │
                        └──────┬───────────────▲───────────┘
             gateway (shards)  │               │ OAuth2 (identify, guilds.join)
┌──────────────────────────────▼──┐   ┌────────┴──────────────────────┐
│ apps/bot  (N shard processes)   │   │ apps/website (Next.js)         │
│  modules → services → core      │   │  verify flow · dashboard       │
└──────┬─────────────┬────────────┘   └──────┬──────────────┬──────────┘
       │ Drizzle     │ pub/sub, windows,     │ Drizzle      │ publish
       ▼             ▼ BullMQ queues          ▼              ▼
┌──────────────┐  ┌──────────────┐  ◄────────┘       ┌──────────────┐
│ PostgreSQL   │  │ Redis        │ ◄─────────────────│ apps/bot     │
│ (all state)  │  │ (hot state)  │  jobs             │ worker.ts    │
└──────────────┘  └──────────────┘ ─────────────────►└──────────────┘
```

**Key flows**

1. **Message → AutoMod:** `messageCreate` → exemptions → `core.normalize()` → detectors
   (words/spam/links/scam/harassment/toxicity/policies, AI only for borderline or when configured)
   → violations → `core.risk.decide()` → actions (delete/warn/timeout/…) → case + log card.
2. **Audit log → Anti-Nuke:** `guildAuditLogEntryCreate` (actor = `executorId`) → map to an
   `AntiNukeAction` → trust check (owner/extra owner/whitelist flag) → strict or threshold
   window (Redis) → threat level → punishment + revert → incident + log → maybe emergency mode.
3. **Verification:** member presses *Verify* → bot sends a signed link
   (`signVerificationToken`) → website: consent → captcha → fingerprint → Discord OAuth →
   `core` evasion matcher → DB rows → Redis `quill:verification:completed` → the shard owning the
   guild applies roles / review / block.
4. **Config:** stored **sparse** in `guild_settings.config` (JSONB), expanded with defaults by
   `parseGuildConfig`. Any writer bumps `version` and publishes `quill:config:invalidate`; every
   shard drops its cache.

**Scaling model:** shards are stateless apart from caches. Postgres = durable state; Redis = rate
windows, risk hot copies, pub/sub, BullMQ. The worker uses REST only. Start with
`ShardingManager` (process per shard); the design allows clustered sharding later.

---

## 5. Tech stack

| Concern | Choice |
|---|---|
| Runtime | Node.js ≥ 22, ESM everywhere |
| Language | TypeScript 7 (`tsc` for typecheck only), strict, `noUncheckedIndexedAccess` |
| Discord | discord.js **14.27** (Components V2 builders, `guildAuditLogEntryCreate`) |
| Database | PostgreSQL 16 + **Drizzle ORM** (`drizzle-kit` migrations, pure JS) |
| Cache / bus / jobs | Redis 7 + ioredis + **BullMQ** |
| Validation | **zod 4** (`.prefault({})` for nested defaults) |
| Logging | pino (JSON in prod, pretty in dev) |
| Tests | Vitest 5 |
| Lint/format | Biome 2 (`pnpm lint:fix`) |
| Build | tsup (bundles `@quill/*` into `apps/bot/dist`, copies migrations) |

---

## 6. Rules every agent must follow

### Code
- TypeScript strict, ESM, **relative imports end in `.js`**. Named exports only.
- Run `pnpm check` (Biome + typecheck + tests) before every commit. Fix, don't suppress.
- Framework-free logic (text processing, scoring, matching) goes in `packages/core` with unit tests.
  Discord glue stays in `apps/bot`.
- Don't add dependencies casually; pin exact versions for runtime deps.

### Discord UI — Components V2 only
- Build every message with `Card` (`apps/bot/src/ui/card.ts`) and send it through
  `reply` / `update` / `send` (`apps/bot/src/ui/respond.ts`). These set `MessageFlags.IsComponentsV2`,
  disable pings by default, and assert Discord limits.
- **Never** call `setAccentColor` (no side bar). **Never** send `content` or `embeds`.
- Limits: ≤ 40 components per message (nested count), ≤ 4000 characters of text in total.
- `deferReply` only accepts `Ephemeral`; the V2 flag is applied on the following `editReply` (handled by `reply`).
- Modals use `LabelBuilder` + `ModalBuilder.addLabelComponents` (≤ 5 top-level components).
- custom_id format: `qg:<module>:<action>[:arg…]` built with `cid()` / `lockedId()`; handlers are
  registered by `<module>:<action>`. Use `locked: true` so only the invoker can press panel buttons.

### Permissions (see `apps/bot/src/framework/permissions.ts`)
`everyone < moderator < manager < extra_owner < owner`.
Anti-Nuke, whitelist, extra owners, emergency mode and backups are **owner / extra owner only**
(Olympus model) — even Administrators can't change them. **Never add a developer/global override
command**: no hard-coded user IDs with power over other servers.

### Config
- Schemas + defaults: `packages/shared/src/config/*`. Stored sparse; edit with
  `setAtPath` / `unsetAtPath`, validate with `validateGuildConfig`, save with optimistic concurrency
  (`guildRepo.saveGuildSettings(expectedVersion)`), then publish `quill:config:invalidate`.
  In the bot use `app.configs.set/update/reset` which does all of this and writes `config_audit`.
- Adding a setting = add it to the zod schema **with a default**; nothing else needs migrating.

### Database
- Schema in `packages/db/src/schema/*.ts`; generate SQL with `pnpm db:generate`; apply with
  `pnpm db:migrate` (the bot also auto-migrates on start when `AUTO_MIGRATE=true`).
- Pre-1.0 the single `0000_init` migration may be regenerated; after the first production deploy
  migrations are **append-only**.
- Snowflakes are `varchar(20)`. Timestamps are `timestamptz`.

### Privacy & security (non-negotiable)
- **Never store raw IP addresses.** Store `hmacHash(ip, HASH_PEPPER)` and `hmacHash(ipPrefix(ip), …)`.
- OAuth tokens and BYOK API keys are encrypted with `encryptSecret` (AES-256-GCM, `ENCRYPTION_KEY`).
  Never log, display or return them (use `maskSecret` for display).
- Retention job (worker) deletes old security events, fingerprints and stale sessions.
- Users can delete their data (`/data delete` on the bot; website must offer the same).

---

## 7. Formats

### Guild config (`GuildConfig`, `packages/shared/src/config/index.ts`)
Top-level modules: `general`, `logging`, `risk`, `automod`, `antinuke`, `antiraid`, `verification`,
`messages`. Read the schema files for every field and default — they are documented inline.

### Moderation action (`ModAction`)
```ts
{ type: 'none' | 'warn' | 'quarantine' | 'strip_roles' | 'kick' | 'softban' }
{ type: 'timeout', durationSeconds: number }
{ type: 'ban', deleteMessageSeconds: number }
```

### Anti-Nuke action keys (also the whitelist flags)
`ban kick prune bot_add guild_update vanity_update member_role_update member_timeout channel_create
channel_delete channel_update role_create role_delete role_update webhook_create webhook_update
webhook_delete emoji_delete integration_create automod_rule_delete mention_everyone`

### Case
`cases` table: per-guild `case_number`, `source` (`manual|automod|risk|antinuke|antiraid|verification`),
`type` (`warn|timeout|untimeout|quarantine|unquarantine|strip_roles|kick|softban|ban|unban|delete|note`).

### Message templates
`{ title, body, footer, showThumbnail, imageUrl }` with variables `{user} {user.name} {user.id}
{server} {server.id}` plus per-template ones (`TEMPLATE_VARIABLES`). Defaults: `DEFAULT_TEMPLATES`.

---

## 8. Bot ↔ Website contracts

Defined in `packages/shared/src/contracts/`. **Changing a contract requires updating both sides and
this section in the same change.**

| Contract | Producer → Consumer | Definition |
|---|---|---|
| Verification link token | bot → website | `signVerificationToken` / `verifyVerificationToken` (HMAC, `VERIFY_TOKEN_SECRET`, 15 min TTL). URL: `${WEBSITE_URL}/verify/<token>` |
| `quill:verification:completed` | website → bot | `VerificationCompletedMessage` (verdict `pass|flag|block`, reasons, confidence, linked user ids) |
| `quill:config:invalidate` | anyone who writes config | `ConfigInvalidateMessage` |
| `quill:trust:invalidate` | anyone who writes trust entries | `TrustInvalidateMessage` |
| `quill:identity:revoked` | website → bot | user deleted data / revoked OAuth |
| Tables written by the website | website | `verification_sessions`, `guild_verifications`, `verified_identities`, `fingerprints`, `identity_links`, `oauth_grants` |
| Tables written by the bot | bot | everything else; the website may **read** them and may write `guild_settings` (dashboard) following §6 Config rules |
| Commands manifest | bot → website | `apps/bot/commands.manifest.json` (`pnpm commands:manifest`) |

---

## 9. Working in parallel (multi-agent rules)

1. **Own your area.** bot-agent: `apps/bot`, `packages/core`. website-agent: `apps/website`.
   `packages/shared` and `packages/db` are shared: additive changes are fine; breaking changes need
   a note in §8/§11 and matching updates on the other side.
2. **Small, focused commits** with clear messages. Never rewrite others' history.
3. **Before starting:** pull, read §2 and §11, pick an unowned ⏳ item, mark it 🚧 with your agent name.
4. **When done:** `pnpm check` green → update §2 and add a §11 entry → commit.
5. **Don't hand-edit generated files** (`packages/db/migrations/*`, `commands.manifest.json`).
6. If you find a bug in another agent's area, write it under *Open issues* (§10) instead of fixing
   it silently — unless it blocks you and the fix is tiny.

---

## 10. Commands & operations

```bash
pnpm install                      # install workspace
docker compose up -d postgres redis
cp .env.example .env              # fill in Discord + secrets
pnpm db:migrate                   # or let the bot auto-migrate
pnpm commands:deploy --dev        # register slash commands in DEV_GUILD_ID (instant)
pnpm dev:bot                      # run one shard with hot reload
pnpm dev:worker                   # run the worker
pnpm check                        # lint + typecheck + tests
pnpm --filter @quill/bot check:boot   # boot check without secrets (--dry-run)
TEST_DATABASE_URL=postgres://… pnpm test   # include DB integration tests
pnpm build && node apps/bot/dist/index.js   # production (sharded)
docker compose up -d --build      # full stack in Docker
```

**Hosting:** any Node 22 host + any Postgres + any Redis. E.g. VPS with docker-compose; or
Railway/Render/Fly for the bot & worker + Neon/Supabase (Postgres, add `?sslmode=require`) +
Upstash/Railway (Redis). Run **one** `node dist/index.js` (spawns shards) and **≥1**
`node dist/worker.js`.

**Discord application setup:** enable *Server Members* and *Message Content* privileged intents;
invite with the `bot` + `applications.commands` scopes and Administrator (anti-nuke must restore any
overwrite); put the QUILL role at the top of the role list; add the website's OAuth redirect URI.

### Open issues
- _none yet_

---

## 11. Changelog

- **Phase 1 — Foundation** (bot-agent): monorepo + tooling; shared config schemas/contracts/crypto;
  Drizzle schema (25 tables) + init migration + repositories with integration tests; bot framework
  (sharding manager, shard, worker skeleton + retention job, router, permission levels, custom ids,
  registry); Components V2 UI kit (`Card`, presets, limits, respond); services (config cache with
  pub/sub invalidation and audit, trust, logs, cases); commands `/help /about /ping /setup /logs /case`;
  Docker + compose; AGENTS.md files.
