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
| Core engine: normalizer, 2800+ word lists, matcher, risk engine, verification evaluator | ✅ | bot-agent | `evaluateVerification` / `scoreIdentityLink` ready for the website |
| AutoMod module (detectors, BYOK AI, policies, templates, risk ladder) | ✅ | bot-agent | `/automod` `/policy` `/ai` `/risk`, log cards with moderator buttons |
| Anti-Nuke + Anti-Raid engine (`packages/core`) | ✅ | bot-agent | trust model, strict/threshold, threat scoring, anti-betray, 8 red-team scenarios, join evaluation |
| Anti-Nuke + Anti-Raid services (`apps/bot`) | ✅ | bot-agent | audit-log mapping, punish, revert (incl. retroactive), live incident cards, emergency mode, snapshots + restore, raid mode |
| Anti-Nuke commands + events (`/antinuke /whitelist /extraowner /emergency /backup /antiraid /incident`) | ✅ | bot-agent | panel, audit, red-team simulate, whitelist panel, confirmations, live incident buttons, snapshot restore with progress |
| Shared verification repository (`verificationRepo` in `packages/db`) | ⏳ | bot-agent | **Next**; signatures in `apps/website/AGENTS.md` §6 |
| Verification (bot side), SSO, evasion, member backup job | ⏳ | bot-agent | Phase 5 |
| Moderation commands, `/messages`, native AutoMod sync | ⏳ | bot-agent | Phase 6 |
| Website (landing, verify flow, OAuth, fingerprint, dashboard) | ⏳ ready to start | website-agent | Spec: `apps/website/AGENTS.md` — begin with §0 *Start here* |

---

## 3. Repository map

```
Quill-Bot/
├─ AGENTS.md                ← you are here (master guide; keep updated)
├─ CLAUDE.md                ← pointer for Claude Code (imports AGENTS.md); same in apps/website
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
│  │  ├─ src/services/      ← guild config cache, trust, logs, cases, moderation, risk
│  │  ├─ src/modules/       ← feature modules: core, general, logging, cases, moderation,
│  │  │                        automod (+ ai/), antinuke (mapping, service, revert, emergency,
│  │  │                        snapshots, serialize, cards), antiraid (service)
│  │  ├─ src/worker/        ← job handlers
│  │  ├─ scripts/           ← deploy-commands, export-manifest, verify-link (dev helper)
│  │  └─ test/              ← bot tests
│  └─ website/              ← QUILL website (Next.js)                  [website-agent]
│     └─ AGENTS.md          ← FULL website build spec
└─ packages/
   ├─ shared/               ← zod config schemas, contracts, crypto, brand   (both sides)
   ├─ db/                   ← Drizzle schema, migrations, repositories      (both sides)
   └─ core/                 ← framework-free engine (runs in Node + browsers): normalizer, 2800+ word
                               lists, Aho-Corasick matcher, detectors, risk engine, anti-nuke +
                               anti-raid scoring, red-team simulations, verification evaluator
                               (subpath exports: /normalizer /verification /antinuke)
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
2. **Audit log → Anti-Nuke:** `guildAuditLogEntryCreate` (actor = `executorId`) or an @everyone
   ping → `mapAuditEntry` → `AntiNukeAction` (+ "dangerous" flag) → decisions serialized per guild:
   trust (`resolveTrust`: owner > QUILL > extra owners > per-action whitelist; whitelisted users
   lose trust while emergency mode is on) → Redis windows (per action + threat window) →
   `evaluateAntiNuke` (strict/threshold, anti-betray, raid-mode tightening) → security event →
   incident (opened on punishment / high threat) with a live log card → punishment once per burst
   → revert queue (the event, and on the first punishment every earlier action of that actor in
   the window) → auto emergency mode at the configured threat level.
3. **Verification:** member presses *Verify* → bot sends a signed link
   (`signVerificationToken`) → website: consent → captcha → fingerprint → Discord OAuth →
   `core` evasion matcher → DB rows → Redis `quill:verification:completed` → the shard owning the
   guild applies roles / review / block.
4. **Config:** stored **sparse** in `guild_settings.config` (JSONB), expanded with defaults by
   `parseGuildConfig`. Any writer bumps `version` and publishes `quill:config:invalidate`; every
   shard drops its cache.

**Scaling model:** shards are stateless apart from caches. Postgres = durable state; Redis = rate
windows, risk hot copies, pub/sub, BullMQ. The worker uses REST only. Anti-Nuke state that must be
exact per burst (decision queue, live incidents, deleted-object copies) lives in the shard that owns
the guild — every guild event reaches the same shard — and is persisted to Postgres as it changes.
Snapshot restores also run in that shard (they need the live cache and old → new id mapping). Start with
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

### AutoMod pipeline (implemented)
`messageCreate`/`messageUpdate` → exemptions (users, roles, channels/categories, Manage Messages
bypass, owner) → `normalize()` → `runDetectors()` from `@quill/core` (words, spam, links, scam,
harassment, toxicity, custom policies) → optional **BYOK AI** second opinion (borderline messages
by default) → shadow-mode split → delete → **Risk Engine** (`evaluateRisk`) → strongest of
{detector immediate action, ladder step} executed by `ModerationService` (hierarchy-checked) →
case + DM (template) + short channel notice + AutoMod log card with History / Remove timeout /
Reset risk / Ban buttons. Burst protection: one full enforcement per member+reason per 4 s.

**Default risk ladder:** 10 warn · 25 timeout 10m · 45 timeout 1h · 70 timeout 1d · 110 ban.
Severity points 3/6/12/25/45; extra violations in the same message add 25%; repeats within
10 min ×1.5; half-life 24 h.

**BYOK AI** (`apps/bot/src/modules/automod/ai/`): Anthropic via the official `@anthropic-ai/sdk`
(default model `claude-opus-5`, structured JSON output, low effort, server-side refusal
fallbacks `fallbacks: "default"`; servers can pick a cheaper model such as `claude-haiku-4-5`),
OpenAI Moderation endpoint (`omni-moderation-latest`), any OpenAI-compatible API, Google Gemini.
Keys are AES-256-GCM encrypted in `ai_credentials`, per-minute + monthly caps in Redis.

### Anti-Nuke / Anti-Raid data (bot writes, website reads)

**Incident summary** — `incidents.summary` (JSONB), defined in
`apps/bot/src/modules/antinuke/types.ts` (`IncidentSummary`):
```ts
{
  trust: 'untrusted' | 'whitelisted' | 'extra_owner' | null,   // actor's trust when it happened
  threatScore: number,                                          // peak threat score
  counts: { [action: AntiNukeAction]: number },                 // protected actions in the incident
  punishment: null | { type: 'ban'|'kick'|'strip_roles'|'quarantine'|'alert', ok: boolean,
                       error: string|null, caseNumber: number|null, previousRoles: string[],
                       quarantineRoleId: string|null, bot: boolean },
  reverts: { reverted: number, failed: number, skipped: number },
  emergency: boolean,                                           // emergency mode was triggered
  timeline: Array<{ at: number /* epoch ms */, text: string /* Discord markdown, max 14, newest last */ }>,
  log: { channelId: string, messageId: string } | null,         // the live log card
  notes: string[],
  raid?: { reason: string, joins: number, actioned: number, action: string,   // module = 'antiraid'
           endsAt: number|null, endedAt: number|null, invitesPaused: boolean }
}
```
`incidents.status`: `open` (running, or QUILL could not punish) · `contained` (punished) ·
`resolved` (closed without punishment, or marked resolved). `incidents.threatLevel`: peak level.

**Security events** — `security_events`: one row per protected action by a non-owner.
`module` `antinuke|antiraid`; `action` = an `AntiNukeAction` key or `webhook_everyone_spam` /
`join_filtered`; `severity` 1–4 (= threat level rank + 1); `trust`; `details`
(`{ dangerous, count, limit, threat, raidMode }`); `response`
(`{ punish, punishment, revert, reason }`).

**Snapshot data** — `snapshots.data` (JSONB, `GuildSnapshotData` v1 in
`apps/bot/src/modules/antinuke/serialize.ts`): `{ version: 1, takenAt, guild: { name,
verificationLevel, explicitContentFilter, defaultMessageNotifications, afkChannelId, afkTimeout,
systemChannelId, description }, roles: [{ id, name, color, hoist, position, permissions (string
bitfield), mentionable, unicodeEmoji, members? }], channels: [{ id, type, name, parentId,
position, topic, nsfw, rateLimitPerUser, bitrate, userLimit, overwrites: [{ id, type: 0 role |
1 member, allow, deny }] }] }`. Kinds: `auto` (every `snapshotIntervalHours`, pruned to
`snapshotRetention`), `manual`, `pre_emergency`. Restores run in the bot (they need live guild state).

**Raid mode** — Redis key `redisKeys.raidMode(guildId)` (TTL = raid duration), JSON
`{ reason, by: userId|null, startedAt, endsAt, incidentNumber }`. Absent = no raid.

**Emergency mode** — `emergency_states` row per guild: `active`, `reason`, `automatic`,
`triggeredBy`, `startedAt`, `endedAt`; `previous` holds what QUILL changed (role permissions,
@everyone overwrites, invites paused) so `/emergency end` can restore it.

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
| `quill:verification:review` | website → bot | `VerificationReviewMessage` (approve / deny / ban a flagged member) |
| `quill:wordlist:invalidate` | anyone who edits custom words / policies | `WordlistInvalidateMessage` |
| `trust_entries` writes | bot + website | whitelist = user + action keys; extra owners are **owner-only**, max `antinuke.maxExtraOwners`, never bots; publish `quill:trust:invalidate` after every change |
| Anti-Nuke / Anti-Raid data | bot → website (read-only) | `incidents.summary`, `security_events`, `snapshots.data`, `emergency_states`, raid-mode key — formats in §7 |
| Dev verification links | bot tooling → website dev | `pnpm verify:link <guildId> <userId>` (same token as the bot's Verify button) |
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

**File ownership**

| Path | Owner | Others may |
|---|---|---|
| `apps/bot/**`, `packages/core/**` | bot-agent | read / import |
| `apps/website/**` | website-agent | read |
| `packages/db/src/schema/**`, `packages/db/migrations/**`, `packages/db/src/repositories/**` | bot-agent | website-only queries live in `apps/website/src/server/db/`; request schema changes under *Open issues* |
| `packages/shared/**` | shared | additive changes (new exports, new fields with defaults); contract changes → §8 + *Open issues* |
| `AGENTS.md`, `.env.example`, `vitest.config.ts`, `biome.json`, `pnpm-workspace.yaml` | shared | edit only your own rows/sections; keep edits small and additive |
| `pnpm-lock.yaml`, `commands.manifest.json`, `migrations/*` | generated | never hand-edit (lockfile conflict → take either side, run `pnpm install`) |

**Git workflow:** each agent works on its own branch (bot-agent: `claude/intelligent-franklin-7wwval`
until merged to `main`; website-agent: e.g. `website/main`). Merge the integration branch into your
branch regularly; never rebase or force-push a branch someone else pulls. `CLAUDE.md` files only
import the matching `AGENTS.md` — edit `AGENTS.md`, never duplicate content into them.

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
pnpm verify:link <guildId> <userId>   # dev: print a signed verification link for the website
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

- **Docs — ready for parallel website work** (bot-agent): `apps/website/AGENTS.md` gained §0
  *Start here* (setup checklist, what already exists, ownership, git workflow, dev helpers), a
  data-model cheat-sheet, the library API list, planned `verificationRepo` signatures, Discord API
  notes and anti-nuke dashboard pages; root §7 documents incident/snapshot/security-event/raid
  formats, §8 the new contracts, §9 file ownership. Added `CLAUDE.md` pointers,
  `pnpm verify:link`, `@quill/core` subpath exports (`/normalizer`, `/verification`, `/antinuke`,
  `sideEffects: false`) and the `apps/website/**/*.test.ts` Vitest glob.

- **Phase 4 — Anti-Nuke + Anti-Raid** (bot-agent, ✅): core engine (`resolveTrust`,
  `evaluateAntiNuke` strict/threshold with anti-betray + raid tightening, `assessThreat` with combo
  multipliers, 8 red-team `SCENARIOS` + `simulate()`, `evaluateJoin`); `securityRepo` (incidents,
  security events, snapshots, emergency state); bot services: audit-log mapping, `AntiNukeService`
  (per-guild serialized decisions, punish once per burst, retroactive revert, live incident cards,
  owner DM fallback, webhook @everyone spam), `Reverter` (unban, re-create channels/roles/emojis/
  AutoMod rules from cache → snapshot → audit data, roll back guild/channel/role/webhook edits,
  re-point config ids), `EmergencyService`, `SnapshotService` (scheduler + restore),
  `AntiRaidService` (join filters, raid mode, wave sweep). Commands: `/antinuke` (panel, enable,
  disable, mode, punishment, module, settings, protect, audit, simulate), `/whitelist` (Olympus-style
  per-action select + "All"), `/extraowner` (owner only, confirmed), `/emergency` (authorized users
  may start, only owners end), `/backup` (create, list, view, restore with safety snapshot +
  progress, delete), `/incident` (list, view, resolve + card buttons: ban, unban, give roles back,
  full log, resolve), `/antiraid`. Ban mirror syncs on join; initial snapshot on join. Tests:
  mapping, UI limits, and an end-to-end flow against Postgres (strict, threshold + retroactive
  revert, anti-betray + auto emergency, emergency strip/restore). Manifest regenerated
  (17 commands); Biome ignores the generated manifest.

- **Phase 3 — AutoMod** (bot-agent): core detectors (words with evasion bump, spam incl.
  cross-channel blasts, links/invites incl. obfuscated invites and masked links, scams with
  phishing/look-alike/homograph domains + scam phrases + perceptual image hashes + compromised
  account signals, harassment incl. targeting/threats/doxxing, toxicity, custom policies);
  bot pipeline + `ModerationService` + `RiskService` (Redis + Postgres); BYOK AI (Anthropic SDK,
  OpenAI moderation, OpenAI-compatible, Gemini); commands `/automod` (panel, test, toggle, shadow,
  response, normalizer, spam, words…, exempt…, links…, scam…), `/policy`, `/ai`, `/risk`;
  `guild_bans` mirror; end-to-end flow test against Postgres. Default risk ladder softened
  (timeouts before ban). `commands.manifest.json` regenerated.

- **Phase 2 — Core engine** (bot-agent): `normalize()` (NFKC, invisible chars, Zalgo/diacritics,
  homoglyphs incl. Cyrillic/Greek/emoji letters/small caps/upside-down, context-aware leetspeak,
  single-letter joining, repetition views); Aho-Corasick `WordMatcher` with collision-safe
  collapsing and span rules; **2807 built-in terms** in 10 categories and 14 languages with a
  validator (dictionary Scunthorpe check) and a false-positive corpus test; `evaluateRisk()`;
  `scoreIdentityLink()` + `evaluateVerification()` for the website. Word filter default
  `minSeverity` is now 2.

- **Phase 1 — Foundation** (bot-agent): monorepo + tooling; shared config schemas/contracts/crypto;
  Drizzle schema (25 tables) + init migration + repositories with integration tests; bot framework
  (sharding manager, shard, worker skeleton + retention job, router, permission levels, custom ids,
  registry); Components V2 UI kit (`Card`, presets, limits, respond); services (config cache with
  pub/sub invalidation and audit, trust, logs, cases); commands `/help /about /ping /setup /logs /case`;
  Docker + compose; AGENTS.md files.
