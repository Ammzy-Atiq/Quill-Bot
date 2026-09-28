# AGENTS.md — QUILL GUARD Website (build spec)

> You are the **website-agent**. Your job is to build the QUILL GUARD website in this folder
> (`apps/website`). The Discord bot is built in parallel by the **bot-agent** in `apps/bot`.
> Read the root [`AGENTS.md`](../../AGENTS.md) first (product, rules, contracts), then this file
> end to end. When you finish a milestone, update the status board in the root `AGENTS.md` (§2)
> and add a changelog entry (§11).
>
> QUILL GUARD is made by **Atiq Ur Rahman** — credit him in the footer and the About section.

---

## 0. Start here

### 0.1 First-session checklist
1. Read root `AGENTS.md` §1–§9, then this file.
2. Tooling: Node ≥ 22, `corepack enable` (pnpm 10), Docker (or hosted Postgres 16 + Redis 7).
3. From the **repo root**:
   ```bash
   pnpm install
   docker compose up -d postgres redis
   cp .env.example .env            # fill DATABASE_URL, REDIS_URL, secrets (openssl rand -base64 32)
   pnpm db:migrate                 # creates all tables (shared with the bot)
   ```
4. Scaffold Next.js **into this folder without deleting** `AGENTS.md`, `CLAUDE.md`, `README.md`:
   run `pnpm dlx create-next-app@latest` into a temporary directory (TypeScript, App Router,
   Tailwind, `src/` directory, import alias `@/*`, **no ESLint** — the repo lints with Biome;
   check `--help` for the current flag names), then copy the generated files into `apps/website/`
   without overwriting the three files above. Delete any `pnpm-lock.yaml`, `pnpm-workspace.yaml`
   or `.git` the generator created inside this folder — the repo root owns those.
5. In `apps/website/package.json`: `"name": "@quill/website"`, `"private": true`, `"type": "module"`,
   dependencies `"@quill/shared": "workspace:*"`, `"@quill/db": "workspace:*"`,
   `"@quill/core": "workspace:*"`, `"drizzle-orm": "0.45.3"`, `"ioredis": "6.0.0"`, `"zod": "4.6.5"`
   (same versions as the rest of the repo), scripts `dev`, `build`, `start`, `typecheck`.
6. `pnpm install` at the root → `pnpm --filter @quill/website dev` → <http://localhost:3000>.
7. `pnpm check` (Biome + typecheck + Vitest) must stay green — Biome also lints your files and
   Vitest already runs `apps/website/**/*.test.ts`.
8. Mark the *Website* row 🚧 **website-agent** in root `AGENTS.md` §2 and commit on your branch (§0.3).

### 0.2 What already exists for you

| You need | Status | Where |
|---|---|---|
| Verification link token (sign/verify) | ✅ | `signVerificationToken` / `verifyVerificationToken` — `@quill/shared/contracts` |
| Alt/evasion scoring | ✅ | `scoreIdentityLink`, `evaluateVerification` — `@quill/core/verification` |
| Normalizer for the landing-page demo (browser-safe) | ✅ | `normalize`, `foldText` — `@quill/core/normalizer` |
| Red-team scenarios (optional landing demo) | ✅ | `SCENARIOS`, `simulate` — `@quill/core/antinuke` |
| Config schemas, defaults, parse/validate, path edits, labels | ✅ | `@quill/shared/config` |
| Redis channel names, message schemas, key builders | ✅ | `REDIS_CHANNELS`, `*Message`, `redisKeys` — `@quill/shared/redis` |
| Crypto (AES-GCM secrets, HMAC hashes, IP prefix, masking) | ✅ | `@quill/shared/crypto` (server-only) |
| Brand tokens | ✅ | `BRAND` — `@quill/shared/brand`; logo in `assets/brand/` |
| DB schema + repositories (`guildRepo`, `trust`, `cases`, `banRepo`, `riskRepo`, `automodRepo`, `securityRepo`) | ✅ | `@quill/db` (+ `@quill/db/schema`) |
| Shared **verification repository** (`verificationRepo`, signatures in §6) | ⏳ bot-agent, lands before you need it (milestone 2) | `@quill/db` |
| Commands manifest for `/commands` | ✅ regenerated every bot phase | `apps/bot/commands.manifest.json` |
| Bot reacts to `quill:config:invalidate` / `quill:trust:invalidate` | ✅ | dashboard edits apply instantly |
| Bot "Verify" button that sends members to your site | ⏳ bot Phase 5 | meanwhile: `pnpm verify:link <guildId> <userId>` (§0.4) |
| Bot applies `quill:verification:completed` (roles / review card / block) | ⏳ bot Phase 5 | meanwhile watch the channel (§0.4) — build against the contract |
| Bot applies `quill:verification:review` decisions | ⏳ bot Phase 5 | same |
| Anti-Nuke / Anti-Raid data (incidents, security events, snapshots, emergency state) | 🚧 bot Phase 4 — tables and formats are final | root `AGENTS.md` §7 |

### 0.3 Ownership & parallel-work rules

| Path | Owner | What the website-agent may do |
|---|---|---|
| `apps/website/**` | **website-agent** | everything |
| `apps/bot/**`, `packages/core/**` | bot-agent | read and import only; report bugs under root §10 *Open issues* |
| `packages/shared/**` | shared | **additive** changes only (new exports, new fields *with defaults*); contract changes → root §8 + an *Open issues* note for the bot-agent |
| `packages/db/src/schema/**`, `packages/db/migrations/**` | bot-agent | request schema changes under *Open issues* (both apps run the same migrations) |
| `packages/db/src/repositories/**` | bot-agent | use them; put **website-only** queries in `apps/website/src/server/db/` (import `schema` from `@quill/db/schema` and operators from `drizzle-orm`) |
| root `.env.example` | shared | add/maintain a `# ── Website ──` section |
| root `AGENTS.md` | shared | update the *Website* row in §2, append §11 entries, add *Open issues* |
| `vitest.config.ts`, `biome.json`, `pnpm-workspace.yaml` | shared | small additive edits only |
| `pnpm-lock.yaml` | generated | never hand-edit; on a merge conflict take either side and run `pnpm install` |

**Git:** work on your own branch (e.g. `website/main`, feature branches off it) created from the
integration branch (currently `claude/intelligent-franklin-7wwval`; `main` once merged). Merge the
integration branch into yours regularly; never rebase or force-push shared branches.

### 0.4 Dev helpers
- **Verification link without the bot button:** `pnpm verify:link <guildId> <userId> [ttlMinutes]`
  prints `${WEBSITE_URL}/verify/<token>` signed with `VERIFY_TOKEN_SECRET` from the root `.env`.
- **Watch bot ↔ website messages:** `docker compose exec redis redis-cli PSUBSCRIBE 'quill:*'`.
- **Inspect the database:** `pnpm db:studio`.
- **Real end-to-end:** create a Discord test application + test server, fill `DISCORD_*` in `.env`,
  `pnpm commands:deploy --dev`, `pnpm dev:bot` (the bot writes the `guilds` rows you need).
  Without the bot, seed a row: `INSERT INTO guilds (id, name, owner_id) VALUES ('<gid>', 'Test', '<you>');`
  and `INSERT INTO guild_settings (guild_id, config) VALUES ('<gid>', '{"verification":{"enabled":true,"verifiedRoleId":"<roleId>"}}');`

---

## 1. What the website is for

1. **Verification** — the most important part. Members arrive from a Discord "Verify" button,
   authorise with Discord OAuth2 (`identify` + `guilds.join`), get a privacy-preserving device /
   network fingerprint, are checked for **alt accounts and ban/punishment evasion**, and are then
   verified in the server (roles applied by the bot, or added to the server by the website).
2. **Marketing site** — explain QUILL GUARD (AutoMod, Verification, Anti-Nuke, Risk Engine),
   "Add to Discord" button, commands reference, FAQ.
3. **Dashboard** — server admins log in with Discord and edit the same settings the bot's slash
   commands edit (config is shared through Postgres + Redis), review flagged verifications, and
   browse cases, anti-nuke incidents, snapshots and the whitelist.
4. **Legal** — privacy policy (what the fingerprint stores and for how long), terms, and a
   self-service **data deletion** page.

---

## 2. Stack & setup

| Concern | Choice |
|---|---|
| Framework | **Next.js (App Router, latest stable)**, React Server Components, Route Handlers for APIs |
| Language | TypeScript, strict, ESM. Import shared code from the workspace packages (§6). |
| Styling | Tailwind CSS v4, CSS variables from the brand tokens; dark theme only |
| Fonts | `next/font/google`: **Sora** (headings, 600/700) + **Inter** (body) |
| Data | `@quill/db` (Drizzle, Postgres), `ioredis` (publish events, rate limits, caches), `@quill/shared`, `@quill/core` |
| Auth (dashboard) | Discord OAuth2 (`identify guilds`), encrypted session cookie (`iron-session` or JWE via `jose`) |
| Captcha | Cloudflare Turnstile (optional but recommended; skip when keys are missing) |
| Fingerprint | `@fingerprintjs/fingerprintjs` (open-source) + coarse browser signals |
| Hosting | Vercel / Railway / Docker. Postgres + Redis must be reachable. |

**Next.js configuration**
- `next.config.ts` → `transpilePackages: ['@quill/shared', '@quill/db', '@quill/core']`
  (the workspace packages are published as TypeScript source). If server bundling complains
  about `pg` or `ioredis`, add them to `serverExternalPackages`.
- Every route/handler that touches the DB, Redis, crypto or the bot token runs on the **Node.js
  runtime** (`export const runtime = 'nodejs'`), never Edge, and lives in files marked
  `import 'server-only'`.
- Create **one** DB handle and **one** Redis client per server process (module singletons,
  cached on `globalThis` in dev so hot reload does not leak connections):
  `createDb(process.env.DATABASE_URL, { max: 5, applicationName: 'quill-website' })`.
  On serverless hosts use the provider's **pooled** connection string.
- The repo root uses TypeScript 7 for `pnpm typecheck`. If Next.js needs the classic compiler
  API, add `typescript@5.9.x` to **this** package's devDependencies only.
- **Client components** may only import browser-safe entry points: `@quill/shared/config`,
  `/actions`, `/brand`, `/constants`, `/wordlists`, `/redis` and `@quill/core/*`. The root
  `@quill/shared`, `@quill/shared/contracts`, `@quill/shared/crypto` and `@quill/db` are **server-only**.
- Vercel monorepo: project root `apps/website`, enable "Include files outside the root
  directory", install command `pnpm install` (runs at the repo root).

**Environment** (add a `# ── Website ──` section to the root `.env.example`):

| Var | Purpose |
|---|---|
| `DATABASE_URL`, `REDIS_URL` | Same databases as the bot |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | OAuth2 |
| `DISCORD_TOKEN` | Bot token — server-side only: membership checks, guild channels/roles, `PUT /guilds/{g}/members/{u}` |
| `VERIFY_TOKEN_SECRET` | Verifies bot-issued verification links (shared with the bot) |
| `ENCRYPTION_KEY` | Encrypts OAuth tokens (`encryptSecret(parseEncryptionKey(ENCRYPTION_KEY))`) — shared with the bot/worker |
| `HASH_PEPPER` | HMAC pepper for IP/device hashes (`hmacHash`) — never rotate casually (breaks alt matching) |
| `WEBSITE_URL` | Public base URL, e.g. `https://quillguard.xyz` |
| `SESSION_SECRET` | ≥ 32 chars, dashboard/verification cookies and OAuth `state` HMAC |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Optional captcha |
| `IP_INTEL_PROVIDER`, `IP_INTEL_API_KEY` | Optional VPN/proxy/ASN lookup (e.g. ipinfo, proxycheck). Without it `isProxy=false`. |

Discord developer portal → OAuth2 → Redirects must contain
`${WEBSITE_URL}/api/verify/callback` and `${WEBSITE_URL}/api/auth/callback`.

---

## 3. Brand & design system

Logo: [`assets/brand/quill-logo.webp`](../../assets/brand/quill-logo.webp) (copy to `public/`,
also export a 512px PNG and a favicon). Tokens: [`assets/brand/brand.md`](../../assets/brand/brand.md)
and `BRAND` from `@quill/shared/brand` — **import them, don't re-type hex codes**.

- **Background** `ink #000712`; cards `surface #0A1220` with 1px `line #1B2536` borders, 16px radius.
- **Accent gradient** gold `#F2AC2B` → amber `#D98A1A` → ember `#B4550A` at 135°: primary buttons,
  the logo glow, focus rings, key numbers. Text stays `#F4F1EA` / muted `#8C96A8`.
  Status colours: success `#3FB67B`, danger `#E5484D`.
- Subtle radial glow of the gradient behind the hero logo (low opacity), faint grid/noise texture ok.
- Motion: 150–250 ms ease-out; respect `prefers-reduced-motion`.
- Accessibility: WCAG AA contrast, visible focus, keyboard navigable, semantic landmarks, alt text.
- Tone: calm, precise, protective. Product name in caps: **QUILL GUARD**.
- Mobile first; everything works at 360px width.

Reusable components to create: `Button` (primary gradient / secondary outline / ghost / danger),
`Card`, `Badge` (on/off/shadow states), `Toggle`, `Field` (label + help + error), `Select`,
`ChannelPicker` / `RolePicker` (from guild data), `Steps` (verification progress), `Toast`,
`EmptyState`, `CodeBlock`, `Logo`, `DiscordPreview` (mimics a Components V2 container — **no
coloured side bar** — for the template editor).

---

## 4. Pages & routes

```
src/app/
  page.tsx                          Landing
  commands/page.tsx                 Commands reference (from apps/bot/commands.manifest.json)
  privacy/page.tsx                  Privacy policy
  terms/page.tsx                    Terms of service
  data/page.tsx                     Self-service data deletion (Discord login → delete)
  verify/[token]/page.tsx           Verification start (consent + captcha + fingerprint)
  verify/result/page.tsx            Result (pass / under review / denied / error)
  dashboard/page.tsx                Server picker
  dashboard/[guildId]/page.tsx      Overview (module status, recent incidents, flagged reviews)
  dashboard/[guildId]/[module]/page.tsx   automod | risk | antinuke | antiraid | verification | logging | messages
  dashboard/[guildId]/whitelist/page.tsx  Anti-Nuke whitelist + extra owners (owner / extra owner)
  dashboard/[guildId]/reviews/page.tsx    Flagged verifications
  dashboard/[guildId]/cases/page.tsx      Cases (read-only)
  dashboard/[guildId]/incidents/page.tsx  Anti-Nuke / Anti-Raid incidents + timeline (read-only)
  dashboard/[guildId]/backups/page.tsx    Snapshots list (read-only; restore happens in Discord)
  api/verify/session/route.ts       POST create/resume session from token
  api/verify/fingerprint/route.ts   POST store fingerprint for session
  api/verify/authorize/route.ts     GET redirect to Discord OAuth (verification)
  api/verify/callback/route.ts      GET OAuth callback → evaluate → finish
  api/auth/login/route.ts           GET dashboard login redirect
  api/auth/callback/route.ts        GET dashboard OAuth callback
  api/auth/logout/route.ts          POST
  api/dashboard/[guildId]/config/route.ts     GET / PATCH config
  api/dashboard/[guildId]/trust/route.ts      GET / PUT / DELETE whitelist + extra owners
  api/dashboard/[guildId]/reviews/route.ts    GET list / POST decision
  api/dashboard/[guildId]/guild/route.ts      GET channels + roles (cached) for pickers
  api/data/delete/route.ts          POST delete my data
```

### 4.1 Landing (`/`)
1. **Hero:** logo mark with gradient glow, "QUILL GUARD", tagline *"Advanced server security —
   AutoMod, Verification & Anti-Nuke."*, buttons **Add to Discord** (invite URL:
   `https://discord.com/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&scope=bot%20applications.commands&permissions=8`)
   and **Open dashboard**.
2. **Three pillars** cards (AutoMod, Verification, Anti-Nuke) + a Risk Engine strip.
3. **Live normalizer demo** — a text box; on input run `normalize()` from `@quill/core/normalizer`
   in the browser and show `variants[0].c1` / `.compact`, e.g. `ｆ.u.c.k` → `fuck`, `fцck` → `fuck`,
   `fuuuuck` → `fuck`. (Use a harmless example word in the placeholder.)
4. **How verification works** — 4 steps: Verify button → Discord authorise → privacy-safe
   fingerprint → access granted; "alts and ban evaders are stopped"; SSO note.
5. **Anti-Nuke** section — Olympus-style owner/extra-owner model, per-action whitelist, strict or
   threshold detection, instant punishment + revert, emergency mode, snapshots, red-team
   simulation (optionally an interactive demo with `SCENARIOS` + `simulate()`). **Honest wording:**
   recovery depends on Discord's API; deleted messages, kicked members and vanity URLs cannot be
   restored automatically.
6. **FAQ** — Is my IP stored? (No — only a one-way keyed hash), why Administrator permission,
   what is SSO, how to appeal, how to delete my data.
7. **Footer** — © QUILL GUARD · Made by **Atiq Ur Rahman** · Privacy · Terms · Commands · Support.

### 4.2 Commands (`/commands`)
Read `apps/bot/commands.manifest.json` at build time (regenerated by the bot-agent with
`pnpm commands:manifest`). Shape: `{ generatedAt, commands: [{ module, permission, permissionLabel,
subcommandPermissions, name, description, options: [...] }] }` (`options` is Discord's command JSON:
type 1 = subcommand, 2 = subcommand group). Group by `module`, show each subcommand, its options
and the required permission label (subcommand overrides win). Add a search box.

### 4.3 Verification — the critical flow

The bot sends members to `${WEBSITE_URL}/verify/<token>`. The token is created by
`signVerificationToken({ guildId, userId }, secret)` and must be checked with
`verifyVerificationToken(token, VERIFY_TOKEN_SECRET)` (15-minute TTL). `simple` mode is handled
entirely by the bot (button → role); the website only serves `oauth` mode.

**Sequence (all server-side unless noted):**

1. **Open link** `/verify/[token]` → `verifyVerificationToken`. Invalid/expired → friendly error
   page ("Press Verify again in Discord").
2. Load the `guilds` row + `parseGuildConfig(guildRepo.getGuildSettings().config).config`. If
   `verification.enabled` is false or `mode !== 'oauth'` → error page. Show the server name and
   icon (icon: `GET /guilds/{id}` with the bot token, cached 10 min in Redis).
3. **Create session** — insert `verification_sessions` (`guildId`, `userId`, `nonce = payload.n`
   (UNIQUE → token reuse fails), `expiresAt = now + 15 min`). Store the session id in an
   httpOnly, SameSite=Lax, Secure cookie `qg_vs`.
4. **Consent screen** — explain exactly what is collected: Discord ID/username, a hashed network
   identifier, hashed device identifier, coarse browser signals; retention (180 days); link to
   privacy policy. If `config.verification.backup.enabled`: an **unchecked** checkbox
   "Allow {server} to re-add me to its backup server if the server is attacked" → `backupConsent`.
5. **Captcha** — Turnstile widget if keys exist; verify server-side in step 6.
6. **Fingerprint (client)** — load FingerprintJS OSS, get `visitorId`; collect coarse signals:
   `timezone`, `language`, `platform`, `screenBucket` (e.g. `1920x1080`), `colorDepth`,
   `hardwareConcurrency`, `deviceMemory`, `touch`, `browserFamily`. `POST /api/verify/fingerprint`
   with `{ visitorId, signals, turnstileToken, backupConsent }`.
   **Server:** verify captcha; read client IP (`cf-connecting-ip` → `x-real-ip` → first
   `x-forwarded-for`); compute
   `ipHash = hmacHash(ip, HASH_PEPPER)`, `ipPrefixHash = hmacHash(ipPrefix(ip), HASH_PEPPER)`,
   `deviceHash = hmacHash(visitorId, HASH_PEPPER)`; optional IP intel → `asn`, `country`, `isProxy`.
   **Never store or log the raw IP or visitorId.** Keep the pending fingerprint on the session
   in Redis (`redisKeys.verifySession(sessionId)`, 15 min TTL).
7. **Authorize** — `GET /api/verify/authorize` redirects to
   `https://discord.com/oauth2/authorize?response_type=code&client_id=…&scope=identify%20guilds.join&redirect_uri=${WEBSITE_URL}/api/verify/callback&state=<sessionId>.<hmac>&prompt=consent`.
   `state` = session id + HMAC(SESSION_SECRET) and must match the `qg_vs` cookie.
8. **Callback** `GET /api/verify/callback?code&state`:
   1. Validate `state` (HMAC + cookie). Exchange `code` at `POST https://discord.com/api/v10/oauth2/token`.
   2. `GET https://discord.com/api/v10/users/@me` with the access token. **The returned `id` must
      equal the session `userId`**, otherwise fail ("You authorised a different Discord account").
   3. Upsert `oauth_grants` (`accessTokenEnc`/`refreshTokenEnc` via `encryptSecret`, `scopes`, `expiresAt`).
   4. Insert a `fingerprints` row (hashes only + coarse signals + asn/country/isProxy).
   5. **Find linked accounts:** other `userId`s in `fingerprints` (last 180 days) sharing
      `deviceHash`, `ipHash` or `ipPrefixHash`. For each, compute confidence with
      `scoreIdentityLink(signals, { isProxy, lastSeenDaysAgo })` and upsert `identity_links`
      (`userA < userB` lexicographically — always order the pair).
   6. For each linked account load its standing **in this guild**: `guild_bans` row → banned;
      active `cases` of type `ban|timeout|quarantine|kick` in the last 30 days → punished.
      If `config.verification.network.shareSignals`, also count bans in other guilds that opted in.
   7. **Evaluate** with `evaluateVerification({ userId, accountCreatedAt, config: config.verification,
      whitelisted, isProxy, linked })` → `{ verdict: 'pass'|'flag'|'block', confidence, reasons,
      linkedUserIds }`. `whitelisted` = user in `verification.whitelistUserIds` (roles in
      `whitelistRoleIds` need the member's roles via the bot token). Account creation date comes
      from the snowflake: `(BigInt(id) >> 22n) + 1420070400000n` ms.
   8. Persist: update `verification_sessions` (`status: 'completed'`, verdict, confidence,
      reasons, linkedUserIds, backupConsent, completedAt); upsert `guild_verifications`
      (`verified` for pass, `flagged` for flag, `denied` for block; `method: 'oauth'`,
      `sessionId`, `backupConsent`); upsert `verified_identities` on pass (bump
      `verificationCount`, `lastVerifiedAt`).
   9. **Add to guild if needed:** if verdict is `pass` and the member is not in the guild
      (`GET /guilds/{g}/members/{u}` with the bot token → 404), call
      `PUT /guilds/{g}/members/{u}` with `{ access_token, roles: [verifiedRoleId] }` → `addedToGuild = true`.
   10. **Publish** `REDIS_CHANNELS.verificationCompleted` with a `VerificationCompletedMessage`
       `{ sessionId, guildId, userId, verdict, reasons, confidence, linkedUserIds, addedToGuild,
       method: 'oauth' }` — `VerificationCompletedMessage.parse()` it before publishing. The bot
       applies roles, review cards or blocks.
   11. Redirect to `/verify/result?s=<sessionId>`.
9. **Result page** shows the guild's template (`messages.templates.verification_success |
   verification_flagged | verification_blocked`, falling back to `DEFAULT_TEMPLATES`; fill
   `{server}`, `{user}`, `{reason}`), with a button back to Discord
   (`https://discord.com/channels/<guildId>`).

**Errors to handle gracefully:** expired token, reused token, OAuth denied (`error=access_denied`),
wrong account, Discord API errors (retry with backoff on 429 honouring `retry_after`), user at the
server limit (`PUT` returns error code 30001), verification disabled mid-flow, captcha failure.

**SSO** needs no website work: the bot auto-verifies members who already have a recent
`verified_identities` row when the guild opts in (`verification.sso.accept`).

### 4.4 Dashboard
- **Login:** `/api/auth/login` → Discord OAuth `identify guilds` → `/api/auth/callback` → session
  cookie `{ userId, username, avatar, accessToken(encrypted), expiresAt }`.
- **Server picker:** the user's guilds (`GET /users/@me/guilds`) where they are the owner or have
  Manage Server (`BigInt(permissions) & 0x20n`) **or** are an extra owner (`trust_entries`),
  intersected with `guilds` rows where `leftAt IS NULL`. Others show an "Add QUILL" button.
- **Authorization on every API call** — recompute server-side, never trust the client. Levels
  mirror the bot (`apps/bot/src/framework/permissions.ts`):
  `owner` = `guilds.ownerId` · `extra_owner` = `trust_entries(kind='extra_owner')` ·
  `manager` = Administrator/Manage Server via the member's roles (`GET /guilds/{g}/members/{u}` +
  `GET /guilds/{g}/roles` with the bot token; OR the role permission bitfields) or a role in
  `general.managerRoleIds` · `moderator` = Kick/Ban/Moderate/Manage Messages or `general.modRoleIds`.
  Cache the computed level for 60 s in Redis. Required levels:
  - AutoMod, Risk, Anti-Raid, Verification, Logging, Messages: **manager**.
  - Anti-Nuke settings, whitelist, backups, emergency info: **owner or extra owner**.
  - Adding/removing **extra owners**: **owner only**.
  - Cases, incidents (read): **moderator**; reviews (decide): **manager**.
- **Guild data for pickers:** `GET /guilds/{g}/channels` and `/roles` with the bot token, cached
  60 s in Redis (`quill:web:guild:<id>:channels|roles`). Honour Discord rate limits.
- **Config API:** `GET` returns `{ config: parseGuildConfig(raw).config, raw, version }`
  (`version` 0 = no row yet). `PATCH` body `{ version, changes: [{ path: (string|number)[], value?: unknown }] }` →
  apply with `setAtPath` / `unsetAtPath` (value omitted = reset to default) → `validateGuildConfig`
  → `guildRepo.saveGuildSettings({ guildId, config, expectedVersion: version, updatedBy })`
  (`ConfigVersionConflictError` → HTTP 409, the UI reloads) → `guildRepo.recordConfigChange(…,
  source: 'dashboard')` per change → publish `REDIS_CHANNELS.configInvalidate`
  `{ guildId, version, source: 'dashboard' }`.
- **Forms:** hand-build the important fields; for the long tail you can drive generic forms from
  the zod schemas (`z.toJSONSchema(AutomodConfigSchema)` etc. in zod 4). Labels exist in
  `@quill/shared` (`DETECTOR_LABELS`, `WORD_CATEGORY_LABELS`, `ANTINUKE_ACTION_LABELS`,
  `LOG_CATEGORY_LABELS`, `TEMPLATE_VARIABLES`, …).
- **Module pages** (fields documented inline in `packages/shared/src/config/*.ts`):
  - **AutoMod:** master toggle; normalizer stage toggles; per-detector enable/shadow/response
    (delete, points multiplier, immediate action, notify); word categories with severity override;
    allowlist; links mode + domains; spam thresholds; custom words (`automodRepo.*CustomWord`) and
    policies (`automodRepo.*Policy`) — publish `REDIS_CHANNELS.wordlistInvalidate` after edits;
    AI section (provider/model/mode/limits). The AI **API key** is only set through the bot's
    `/ai key` modal — never read or display `ai_credentials` secrets (show "key set" only).
  - **Risk:** half-life, severity points, repeat window/multiplier, warning expiry, ladder editor
    (threshold + action).
  - **Anti-Nuke** (owner/extra owner): enable, mode (`strict`/`threshold`), punishment, bot-add
    action, per-action module table (enabled, limit, window, punishment override), revert,
    anti-betray (enabled, multiplier, monitor extra owners), threat thresholds, auto-emergency,
    emergency options (authorized users ≤ 5, protected roles, lock channels, pause invites),
    quarantine role, snapshot interval/retention, protected channels. Show a banner linking to
    the whitelist page: in strict mode every non-whitelisted protected action is punished.
  - **Whitelist & extra owners** (`/whitelist`): rows of `trust_entries`. Whitelist entry = user +
    `permissions` (subset of `ANTINUKE_ACTIONS`; "All" = every key). Use
    `trust.upsertWhitelist` / `trust.removeTrustEntry`; extra owners via `trust.addExtraOwner` /
    `trust.removeTrustEntry(…, 'extra_owner')` (owner only, max `antinuke.maxExtraOwners`, never
    bots). After every change publish `REDIS_CHANNELS.trustInvalidate` `{ guildId, origin: 'website' }`.
  - **Anti-Raid, Verification** (role pickers, evasion policy, SSO, backup consent), **Logging**
    (channel pickers per `LOG_CATEGORIES`), **Messages** (template editor with `DiscordPreview`).
- **Reviews:** list `guild_verifications` with `status='flagged'` joined with the session reasons
  and linked accounts. Approve / Deny / Ban → publish `REDIS_CHANNELS.verificationReview`
  (`VerificationReviewMessage` `{ guildId, userId, decision, reviewerId, reason? }`); the bot
  applies roles/bans and updates the row.
- **Cases:** read-only table (`cases`) with filters (user, type, source) and pagination.
- **Incidents:** `securityRepo.listIncidents` → list (number, module, actor, threat, status);
  detail page renders `incidents.summary` (format: root `AGENTS.md` §7 *Incident summary*) and
  the full event list from `securityRepo.incidentEvents`. Timeline texts are Discord markdown
  with mentions (`<@id>`, `<#id>`, `<@&id>`) — render them as chips, resolving names from the
  cached guild data when possible.
- **Backups:** `securityRepo.listSnapshots` (metadata only — never ship `data` to the browser).
  Restore is Discord-only (`/backup restore`): show the command with the snapshot id.
- **Emergency / raid status** (overview page): `securityRepo.getEmergency(guildId)` →
  `{ active, reason, automatic, startedAt }`; raid mode = Redis `redisKeys.raidMode(guildId)` →
  JSON `{ reason, by, startedAt, endsAt, incidentNumber }` or missing. Read-only: ending them
  happens in Discord (`/emergency end`, `/antiraid end`).

### 4.5 Data deletion (`/data`)
Discord login → confirm → delete the user's rows in `fingerprints`, `identity_links` (either side),
`oauth_grants` (also revoke the token at `POST https://discord.com/api/v10/oauth2/token/revoke`),
`verified_identities`, `verification_sessions`; set their `guild_verifications` to `revoked`;
publish `REDIS_CHANNELS.identityRevoked` `{ userId }`. Cases/bans stay (they belong to the
servers' moderation records) — say so on the page.

### 4.6 Privacy policy (must match reality)
What is collected (Discord ID/username, hashed IP, hashed network prefix, hashed device id, coarse
browser signals, ASN/country, OAuth tokens encrypted), why (verification, alt/ban-evasion
protection, member backup with explicit consent), retention (fingerprints 180 days, security events
90 days, sessions 7 days after expiry), sharing (only verdicts/links with servers you verify in;
cross-server signals only when both servers opt in), deletion (`/data` and the bot's `/data delete`),
contact.

---

## 5. Data model cheat-sheet

Drizzle property names (camelCase) → SQL columns are snake_case. Full definitions with comments:
`packages/db/src/schema/*.ts`. **Writer** = who inserts/updates; the website may read every table.

| Table | Key columns | Writer | Website use |
|---|---|---|---|
| `guilds` | `id`, `name`, `ownerId`, `memberCount`, `joinedAt`, `leftAt` | bot | picker, verify page, owner check |
| `guild_settings` | `guildId`, `config` (sparse JSON), `version`, `updatedBy` | bot + website | config API (§4.4 rules) |
| `config_audit` | `guildId`, `userId`, `source` (`bot`/`dashboard`), `path`, `oldValue`, `newValue` | bot + website | "recent changes" list |
| `trust_entries` | `guildId`, `userId`, `kind` (`extra_owner`/`whitelist`), `permissions` (action keys), `addedBy` | bot + website | whitelist page |
| `cases` | `guildId`, `caseNumber`, `userId`, `moderatorId`, `source`, `type`, `reason`, `details`, `points`, `durationSeconds`, `expiresAt`, `active`, `createdAt` | bot | cases page, evasion standing |
| `guild_bans` | `guildId`, `userId`, `reason`, `moderatorId` | bot (mirror of Discord bans) | evasion standing |
| `risk_scores` | `guildId`, `userId`, `score`, `updatedAt` | bot | optional "top risk" widget (decay with `decayScore`) |
| `custom_words`, `custom_policies` | per guild | bot + website | AutoMod pages (publish `wordlistInvalidate`) |
| `ai_credentials` | `guildId`, `provider`, `model`, encrypted key | bot only | show provider/model and "key set" — never the key |
| `incidents` | `id`, `guildId`, `incidentNumber`, `actorId`, `module`, `threatLevel`, `status`, `summary`, `startedAt`, `endedAt` | bot | incidents pages |
| `security_events` | `guildId`, `incidentId`, `module`, `action`, `actorId`, `targetId`, `severity`, `trust`, `details`, `response`, `createdAt` | bot | incident detail / audit trail |
| `snapshots` | `id`, `guildId`, `kind` (`auto`/`manual`/`pre_emergency`), `label`, `roleCount`, `channelCount`, `sizeBytes`, `createdAt` (+ `data`) | bot | backups page (metadata only) |
| `emergency_states` | `guildId`, `active`, `reason`, `automatic`, `triggeredBy`, `startedAt`, `endedAt` | bot | overview banner |
| `backup_servers`, `member_pull_jobs` | source/target guild, job counters | bot (Phase 5) | backups page |
| `verification_sessions` | `id` (uuid), `guildId`, `userId`, `nonce` (unique), `status`, `verdict`, `confidence`, `reasons`, `linkedUserIds`, `backupConsent`, `expiresAt`, `completedAt` | **website** | verify flow |
| `guild_verifications` | PK (`guildId`, `userId`), `status` (`verified`/`flagged`/`denied`/`revoked`), `method` (`oauth`/`simple`/`sso`/`manual`), `sessionId`, `reviewedBy`, `backupConsent` | **website** + bot (reviews, SSO, simple mode) | verify flow, reviews |
| `verified_identities` | `userId`, `firstVerifiedAt`, `lastVerifiedAt`, `verificationCount`, `clusterId` | **website** (bot reads for SSO) | verify flow |
| `fingerprints` | `userId`, `ipHash`, `ipPrefixHash`, `deviceHash`, `signals`, `asn`, `country`, `isProxy`, `createdAt` | **website** | alt matching |
| `identity_links` | PK (`userA` < `userB`), `confidence`, `signals`, `firstSeenAt`, `lastSeenAt` | **website** | alt graph, reviews |
| `oauth_grants` | `userId`, `accessTokenEnc`, `refreshTokenEnc`, `scopes`, `expiresAt`, `revokedAt` | **website** (worker refreshes) | guilds.join, deletion |

---

## 6. Library API you will call

```ts
// @quill/shared/contracts (server-only)
signVerificationToken({ guildId, userId, ttlSeconds? }, secret) → { token, payload }
verifyVerificationToken(token, secret) → { ok: true, payload: { v, gid, uid, n, exp } } | { ok: false, reason }
// @quill/shared/redis (browser-safe constants + zod schemas)
REDIS_CHANNELS.{configInvalidate, verificationCompleted, identityRevoked, wordlistInvalidate, trustInvalidate, verificationReview}
VerificationCompletedMessage, VerificationReviewMessage, ConfigInvalidateMessage, TrustInvalidateMessage,
IdentityRevokedMessage, WordlistInvalidateMessage   // zod schemas + types
VERIFICATION_REASON_CODES, redisKeys.{verifySession, raidMode, …}
// @quill/shared/crypto (server-only)
parseEncryptionKey(base64) → Buffer;  encryptSecret(plain, key) → string;  decryptSecret(payload, key)
hmacHash(value, pepper) → hex;  ipPrefix(ip) → '/24' or '/48' prefix;  maskSecret(s);  randomToken(bytes?);  safeEqual(a, b)
// @quill/shared/config (browser-safe)
parseGuildConfig(raw) → { config, invalidModules };  validateGuildConfig(raw) → { ok, config } | { ok: false, error }
getAtPath / setAtPath / unsetAtPath;  DEFAULT_GUILD_CONFIG;  GuildConfigSchema + per-module schemas;  DEFAULT_TEMPLATES
// @quill/core/verification
scoreIdentityLink(signals: ('device'|'ip'|'ip_prefix')[], { isProxy, lastSeenDaysAgo }) → 0..1
evaluateVerification({ userId, accountCreatedAt, config, whitelisted, isProxy,
  linked: [{ userId, confidence, bannedHere, punishedHere, networkBans }], now? }) → { verdict, confidence, reasons, linkedUserIds }
// @quill/db (server-only)
createDb(url, { max?, ssl?, applicationName? }) → { db, pool, close }
guildRepo.getGuildSettings(db, guildId) → { config, version }      // version 0 = no row
guildRepo.saveGuildSettings(db, { guildId, config, expectedVersion, updatedBy }) → newVersion  // throws ConfigVersionConflictError
guildRepo.recordConfigChange(db, { guildId, userId, source, path, oldValue, newValue })
trust.listTrustEntries / upsertWhitelist / addExtraOwner / removeTrustEntry / clearWhitelist
cases.listUserCases / countUserCases / getCase;   banRepo.bannedAmong(db, guildId, userIds)
securityRepo.listIncidents / getIncident(db, guildId, number) / incidentEvents / recentSecurityEvents
securityRepo.listSnapshots / getEmergency;   riskRepo.topRisk;   automodRepo.listCustomWords / listPolicies / getAiCredential
```

**`verificationRepo` (shared, bot-agent — lands before your milestone 2).** Planned signatures:
```ts
createSession(db, { guildId, userId, nonce, expiresAt }) → SessionRow | null      // null = nonce already used
getSession(db, id) → SessionRow | undefined
completeSession(db, id, { verdict, confidence, reasons, linkedUserIds, backupConsent })
failSession(db, id, status: 'expired' | 'failed')
upsertOAuthGrant(db, { userId, accessTokenEnc, refreshTokenEnc, scopes, expiresAt })
insertFingerprint(db, { userId, ipHash, ipPrefixHash, deviceHash, signals, asn, country, isProxy })
findLinkCandidates(db, { userId, ipHash, ipPrefixHash, deviceHash, sinceDays }) → [{ userId, signals, lastSeenAt }]
upsertIdentityLink(db, userX, userY, confidence, signals)                        // orders the pair itself
standingInGuild(db, guildId, userIds) → Map<userId, { banned, punished }>
setGuildVerification(db, { guildId, userId, status, method, sessionId?, reviewedBy?, backupConsent? })
touchVerifiedIdentity(db, userId)
deleteUserData(db, userId) → counts
```
If you reach milestone 2 first, pull; if it is still missing, implement exactly these signatures in
`packages/db/src/repositories/verification.ts`, export it as `verificationRepo`, and note it in §11.

---

## 7. Discord API notes
- Base URL `https://discord.com/api/v10`; bot calls use `Authorization: Bot ${DISCORD_TOKEN}`,
  user calls `Authorization: Bearer <access_token>`.
- Rate limits: respect `429` + `retry_after` and the `X-RateLimit-*` headers; cache guild data.
- `PUT /guilds/{g}/members/{u}` needs the bot in the guild with Create Instant Invite, and the
  `guilds.join` token of that user; `201` = added, `204` = already a member.
- Token refresh: `POST /oauth2/token` with `grant_type=refresh_token` (store the new pair
  encrypted, update `expiresAt`). The bot's worker refreshes grants for member backups.

---

## 8. Security checklist
- Validate every input with zod; never trust client-sent guild IDs/permissions.
- CSRF: OAuth `state` HMAC + cookie; dashboard mutations require same-origin + session.
- Cookies: `httpOnly`, `secure`, `sameSite=lax`, short TTL for verification (15 min).
- Rate limit verification + auth routes per IP hash (Redis `INCR` with TTL).
- Never log tokens, raw IPs, `visitorId`, API keys. Use `maskSecret` for display.
- Encrypt OAuth tokens (`encryptSecret`). Bot token only in server code.
- Honour Discord rate limits (429 + `retry_after`).
- Content Security Policy; no third-party trackers on verification pages.

## 9. Acceptance criteria
- [ ] `pnpm --filter @quill/website build` succeeds; `pnpm check` stays green.
- [ ] Lighthouse ≥ 90 (performance, accessibility, best practices) on `/`.
- [ ] Verification happy path works end-to-end against a test server: token → consent → captcha →
      fingerprint → OAuth → pass → `quill:verification:completed` published (and, once bot
      Phase 5 lands, the bot gives the role).
- [ ] Alt test: verify account A, ban A in the server, verify account B from the same browser →
      verdict `flag` (or `block` when `onMatch='block'`) with reason `alt_of_banned`.
- [ ] Reused/expired token and wrong-account flows show friendly errors.
- [ ] Dashboard: config change is visible in the bot immediately (cache invalidation), conflicting
      edits return 409, anti-nuke/whitelist pages are hidden/forbidden for non-owners, extra-owner
      changes are owner-only.
- [ ] No raw IP or token appears in the database or logs (grep the DB after a test run).
- [ ] Data deletion removes the user's fingerprint rows and revokes the OAuth grant.

## 10. Suggested milestones
1. Scaffold Next.js + Tailwind + brand system + landing + legal pages + commands page.
2. Verification flow (sessions, consent, Turnstile, fingerprint, OAuth, evaluation, publish, result).
3. Dashboard auth + server picker + config API + module pages + whitelist.
4. Reviews, cases, incidents, backups, data deletion, polish, accessibility pass.
