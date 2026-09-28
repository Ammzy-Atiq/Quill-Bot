# AGENTS.md — QUILL GUARD Website (build spec)

> You are the **website-agent**. Your job is to build the QUILL GUARD website in this folder
> (`apps/website`). The Discord bot is built by another agent in `apps/bot`. Read the root
> [`AGENTS.md`](../../AGENTS.md) first (product, rules, contracts), then this file end to end.
> When you finish a milestone, update the status board in the root `AGENTS.md` (§2) and add a
> changelog entry (§11).
>
> QUILL GUARD is made by **Atiq Ur Rahman** — credit him in the footer and the About section.

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
   browse cases / incidents.
4. **Legal** — privacy policy (what the fingerprint stores and for how long), terms, and a
   self-service **data deletion** page.

---

## 2. Stack & setup

| Concern | Choice |
|---|---|
| Framework | **Next.js (App Router)**, React Server Components, Route Handlers for APIs |
| Language | TypeScript, strict, ESM. Import shared code from workspace packages (below). |
| Styling | Tailwind CSS v4, CSS variables from the brand tokens; dark theme only |
| Fonts | `next/font/google`: **Sora** (headings, 600/700) + **Inter** (body) |
| Data | `@quill/db` (Drizzle, Postgres), `ioredis` (publish events), `@quill/shared`, `@quill/core` |
| Auth (dashboard) | Discord OAuth2 (`identify guilds`), encrypted session cookie (`iron-session` or JWE via `jose`) |
| Captcha | Cloudflare Turnstile (optional but recommended; skip when keys are missing) |
| Fingerprint | `@fingerprintjs/fingerprintjs` (open-source) + coarse browser signals |
| Hosting | Vercel / Railway / Docker. Postgres + Redis must be reachable. |

**Package setup**
- `apps/website/package.json` → name `@quill/website`, `"type": "module"`, depends on
  `@quill/shared`, `@quill/db`, `@quill/core` via `workspace:*`.
- `next.config.ts` → `transpilePackages: ['@quill/shared', '@quill/db', '@quill/core']`.
- Scripts: `dev`, `build`, `start`, `typecheck` (`tsc --noEmit`), `lint` (use repo Biome).
- The repo root uses TypeScript 7 for `pnpm typecheck`. If your Next.js version needs the
  classic compiler API, add `typescript@5.9.x` to **this** package's devDependencies only.
- Server-only modules (db, redis, crypto, bot token) must never be imported by client components
  (`import 'server-only'`).

**Environment** (add these to the root `.env.example` in the website section when you start):

| Var | Purpose |
|---|---|
| `DATABASE_URL`, `REDIS_URL` | Same as the bot |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | OAuth2 |
| `DISCORD_TOKEN` | Bot token — used server-side to check membership and `PUT /guilds/{g}/members/{u}` |
| `VERIFY_TOKEN_SECRET` | Verifies bot-issued verification links (shared with the bot) |
| `ENCRYPTION_KEY` | Encrypts OAuth tokens (`encryptSecret`) — shared with the bot/worker |
| `HASH_PEPPER` | HMAC pepper for IP/device hashes (`hmacHash`) — website only, never rotate casually |
| `WEBSITE_URL` | Public base URL, e.g. `https://quillguard.xyz` |
| `SESSION_SECRET` | ≥ 32 chars, dashboard/verification cookies |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Optional captcha |
| `IP_INTEL_PROVIDER`, `IP_INTEL_API_KEY` | Optional VPN/proxy/ASN lookup (e.g. ipinfo, proxycheck). Without it `isProxy=false`. |

Discord developer portal → OAuth2 → Redirects must contain:
`${WEBSITE_URL}/api/verify/callback` and `${WEBSITE_URL}/api/auth/callback`.

---

## 3. Brand & design system

Logo: [`assets/brand/quill-logo.webp`](../../assets/brand/quill-logo.webp) (copy to `public/`,
also export a 512px PNG and a favicon). Tokens: [`assets/brand/brand.md`](../../assets/brand/brand.md)
and `BRAND` from `@quill/shared` — **import them, don't re-type hex codes**.

- **Background** `ink #000712`; cards `surface #0A1220` with 1px `line #1B2536` borders, 16px radius.
- **Accent gradient** gold `#F2AC2B` → amber `#D98A1A` → ember `#B4550A` at 135°: primary buttons,
  the logo glow, focus rings, key numbers. Text stays `#F4F1EA` / muted `#8C96A8`.
- Subtle radial glow of the gradient behind the hero logo (low opacity), faint grid/noise texture ok.
- Motion: 150–250 ms ease-out; respect `prefers-reduced-motion`.
- Accessibility: WCAG AA contrast, visible focus, keyboard navigable, semantic landmarks, alt text.
- Tone: calm, precise, protective. Product name in caps: **QUILL GUARD**.
- Mobile first; everything works at 360px width.

Reusable components to create: `Button` (primary gradient / secondary outline / ghost / danger),
`Card`, `Badge` (on/off/shadow states), `Toggle`, `Field` (label + help + error), `Select`,
`ChannelPicker` / `RolePicker` (from guild data), `Steps` (verification progress), `Toast`,
`EmptyState`, `CodeBlock`, `Logo`.

---

## 4. Pages & routes

```
app/
  page.tsx                         Landing
  commands/page.tsx                Commands reference (from apps/bot/commands.manifest.json)
  privacy/page.tsx                 Privacy policy
  terms/page.tsx                   Terms of service
  data/page.tsx                    Self-service data deletion (Discord login → delete)
  verify/[token]/page.tsx          Verification start (consent + captcha + fingerprint)
  verify/result/page.tsx           Result (pass / under review / denied / error)
  dashboard/page.tsx               Server picker
  dashboard/[guildId]/page.tsx     Overview + module tabs
  dashboard/[guildId]/[module]/page.tsx   automod | risk | antinuke | antiraid | verification | logging | messages
  dashboard/[guildId]/reviews/page.tsx    Flagged verifications
  dashboard/[guildId]/cases/page.tsx      Cases (read-only)
  dashboard/[guildId]/incidents/page.tsx  Anti-nuke incidents & security events (read-only)
  api/verify/session/route.ts      POST create/resume session from token
  api/verify/fingerprint/route.ts  POST store fingerprint for session
  api/verify/authorize/route.ts    GET redirect to Discord OAuth (verification)
  api/verify/callback/route.ts     GET OAuth callback → evaluate → finish
  api/auth/login/route.ts          GET dashboard login redirect
  api/auth/callback/route.ts       GET dashboard OAuth callback
  api/auth/logout/route.ts         POST
  api/dashboard/[guildId]/config/route.ts   GET / PATCH config
  api/dashboard/[guildId]/reviews/route.ts  GET list / POST decision
  api/data/delete/route.ts         POST delete my data
```

### 4.1 Landing (`/`)
1. **Hero:** logo mark with gradient glow, "QUILL GUARD", tagline *"Advanced server security —
   AutoMod, Verification & Anti-Nuke."*, buttons **Add to Discord** (invite URL:
   `https://discord.com/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&scope=bot%20applications.commands&permissions=8`)
   and **Open dashboard**.
2. **Three pillars** cards (AutoMod, Verification, Anti-Nuke) + a Risk Engine strip.
3. **Live normalizer demo** — a text box; on input run `normalize()` from `@quill/core` in the
   browser (it is pure TS) and show the normalized/skeleton output, e.g. `ｆ.u.c.k` → `fuck`,
   `fцck` → `fuck`, `fuuuuck` → `fuck`. (Available after bot-agent Phase 2 — until then show static examples.)
4. **How verification works** — 4 steps: Verify button → Discord authorise → privacy-safe
   fingerprint → access granted; "alts and ban evaders are stopped"; SSO note.
5. **Anti-Nuke** section — Olympus-style owner/extra-owner model, per-action whitelist, emergency
   mode, instant revert, snapshots. **Honest wording:** recovery depends on Discord's API; deleted
   messages cannot be restored.
6. **FAQ** — Is my IP stored? (No — only a one-way keyed hash), why Administrator permission,
   what is SSO, how to appeal, how to delete my data.
7. **Footer** — © QUILL GUARD · Made by **Atiq Ur Rahman** · Privacy · Terms · Commands · Support.

### 4.2 Commands (`/commands`)
Read `apps/bot/commands.manifest.json` at build time (it is regenerated by the bot-agent with
`pnpm commands:manifest`). Group by `module`, show each subcommand, options and the required
permission label. Add a search box.

### 4.3 Verification — the critical flow

The bot sends members to `${WEBSITE_URL}/verify/<token>`. The token is created by
`signVerificationToken({ guildId, userId })` and must be checked with
`verifyVerificationToken(token, VERIFY_TOKEN_SECRET)` from `@quill/shared` (15-minute TTL).

**Sequence (all server-side unless noted):**

1. **Open link** `/verify/[token]` → `verifyVerificationToken`. Invalid/expired → friendly error
   page ("Press Verify again in Discord").
2. Load `guilds` row + `parseGuildConfig(guild_settings.config)`. If `verification.enabled` is false
   or `mode !== 'oauth'` → error page. Show the server name and icon.
3. **Create session** — insert `verification_sessions` (`guild_id`, `user_id`, `nonce = payload.n`
   (UNIQUE → token reuse fails), `expires_at = now + 15 min`). Store the session id in an
   httpOnly, SameSite=Lax, Secure cookie `qg_vs`.
4. **Consent screen** — explain exactly what is collected: Discord ID/username, a hashed network
   identifier, hashed device identifier, coarse browser signals; retention (180 days); link to
   privacy policy. If `config.verification.backup.enabled`: an **unchecked** checkbox
   "Allow {server} to re-add me to its backup server if the server is attacked" → `backup_consent`.
5. **Captcha** — Turnstile widget if keys exist; verify server-side in step 6.
6. **Fingerprint (client)** — load FingerprintJS OSS, get `visitorId`; collect coarse signals:
   `timezone`, `language`, `platform`, `screenBucket` (e.g. `1920x1080`), `colorDepth`,
   `hardwareConcurrency`, `deviceMemory`, `touch`, `browserFamily`. `POST /api/verify/fingerprint`
   with `{ visitorId, signals, turnstileToken, backupConsent }`.
   **Server:** verify captcha; read client IP (`cf-connecting-ip` → `x-real-ip` → first
   `x-forwarded-for`); compute
   `ipHash = hmacHash(ip, HASH_PEPPER)`, `ipPrefixHash = hmacHash(ipPrefix(ip), HASH_PEPPER)`,
   `deviceHash = hmacHash(visitorId, HASH_PEPPER)`; optional IP intel → `asn`, `country`, `isProxy`.
   **Never store or log the raw IP or visitorId.** Keep the fingerprint pending on the session
   (e.g. Redis key `redisKeys.verifySession(sessionId)`, 15 min TTL).
7. **Authorize** — `GET /api/verify/authorize` redirects to
   `https://discord.com/oauth2/authorize?response_type=code&client_id=…&scope=identify%20guilds.join&redirect_uri=${WEBSITE_URL}/api/verify/callback&state=<sessionId>.<hmac>&prompt=consent`.
   `state` = session id + HMAC(SESSION_SECRET) and must match the `qg_vs` cookie.
8. **Callback** `GET /api/verify/callback?code&state`:
   1. Validate `state` (HMAC + cookie). Exchange `code` at `POST https://discord.com/api/oauth2/token`.
   2. `GET https://discord.com/api/users/@me` with the access token. **The returned `id` must equal
      the session `user_id`**, otherwise fail ("You authorised a different Discord account").
   3. Upsert `oauth_grants` (`access_token_enc`/`refresh_token_enc` via `encryptSecret(…, ENCRYPTION_KEY)`,
      `scopes`, `expires_at`).
   4. Insert `fingerprints` row (hashes only + coarse signals + asn/country/isProxy).
   5. **Find linked accounts:** other `user_id`s in `fingerprints` (last 180 days) sharing
      `device_hash`, `ip_hash` or `ip_prefix_hash`. For each, compute confidence with
      `scoreIdentityLink()` from `@quill/core` and upsert `identity_links` (`user_a < user_b`).
   6. For each linked account load its standing **in this guild**: `guild_bans` row → banned;
      active `cases` of type `ban|timeout|quarantine|kick` in the last 30 days → punished.
      If `config.verification.network.shareSignals`, also count bans in other guilds that opted in.
   7. **Evaluate** with `evaluateVerification()` from `@quill/core` →
      `{ verdict: 'pass'|'flag'|'block', confidence, reasons, linkedUserIds }`. Whitelisted users
      (`verification.whitelistUserIds`) always pass. Account age from the snowflake.
   8. Persist: update `verification_sessions` (status `completed`, verdict, confidence, reasons,
      linked ids, backup_consent); upsert `guild_verifications` (`verified` for pass, `flagged` for
      flag, `denied` for block; `method: 'oauth'`, `backup_consent`); upsert `verified_identities`
      (bump count/last time) on pass.
   9. **Add to guild if needed:** if verdict is `pass` and the member is not in the guild
      (`GET /guilds/{g}/members/{u}` with the bot token → 404), call
      `PUT /guilds/{g}/members/{u}` with `{ access_token, roles: [verifiedRoleId] }` → `addedToGuild = true`.
   10. **Publish** `REDIS_CHANNELS.verificationCompleted` with a `VerificationCompletedMessage`
       (validate with the zod schema before publishing). The bot applies roles, review cards or blocks.
   11. Redirect to `/verify/result?s=<sessionId>`.
9. **Result page** shows the guild's template (`messages.templates.verification_success |
   verification_flagged | verification_blocked`, falling back to `DEFAULT_TEMPLATES`), with a
   button back to Discord (`https://discord.com/channels/<guildId>`).

**Errors to handle gracefully:** expired token, reused token, OAuth denied (`error=access_denied`),
wrong account, Discord API errors (retry with backoff on 429 honoring `retry_after`), user at the
100/200-server limit (`PUT` returns 30001), verification disabled mid-flow, captcha failure.

**`@quill/core` verification API** (implemented by bot-agent — Phase 2):
```ts
scoreIdentityLink(matches: Array<'device' | 'ip' | 'ip_prefix'>, opts: { isProxy: boolean; lastSeenDaysAgo: number }): number // 0–1
evaluateVerification(input: {
  userId: string;
  accountCreatedAt: Date;
  config: VerificationConfig;          // from parseGuildConfig
  whitelisted: boolean;
  isProxy: boolean;
  linked: Array<{ userId: string; confidence: number; bannedHere: boolean; punishedHere: boolean; networkBans: number }>;
}): { verdict: 'pass' | 'flag' | 'block'; confidence: number; reasons: string[]; linkedUserIds: string[] }
```
Reason codes: `VERIFICATION_REASON_CODES` in `@quill/shared`.

**SSO** needs no website work: the bot auto-verifies members who already have a recent
`verified_identities` row when the guild opts in.

### 4.4 Dashboard
- **Login:** `/api/auth/login` → Discord OAuth `identify guilds` → `/api/auth/callback` → session
  cookie `{ userId, username, avatar, accessToken(encrypted), expiresAt }`.
- **Server picker:** user's guilds (from `/users/@me/guilds`) where they have Manage Server
  (`permissions & 0x20`) **or** are the owner, intersected with `guilds` rows where `left_at IS NULL`.
  Others show an "Add QUILL" button.
- **Authorization on every API call:** recompute permission server-side (never trust the client).
  Levels mirror the bot (`apps/bot/src/framework/permissions.ts`):
  - owner = `guilds.owner_id`; extra owner = `trust_entries(kind='extra_owner')`;
  - manager = Manage Server permission or a `general.managerRoleIds` role (fetch member roles with the bot token).
  - **Anti-Nuke / whitelist / extra owners / backups: owner or extra owner only.**
- **Config editing:** `GET` returns `{ config: parseGuildConfig(raw).config, raw, version }`.
  `PATCH` body `{ version, changes: [{ path: string[], value?: unknown }] }` →
  apply with `setAtPath` / `unsetAtPath` (value omitted = reset to default) → `validateGuildConfig`
  → `guildRepo.saveGuildSettings({ expectedVersion: version })` (409 on `ConfigVersionConflictError`)
  → `guildRepo.recordConfigChange(… source: 'dashboard')` per change → publish
  `REDIS_CHANNELS.configInvalidate` `{ guildId, version, source: 'dashboard' }`.
- **Module pages** (forms built by hand from the schema files in `packages/shared/src/config/`):
  - AutoMod: master toggle; normalizer stage toggles; per-detector enable/shadow/response
    (delete, points multiplier, immediate action, notify); word categories with severity override;
    allowlist; links mode + domains; spam thresholds; AI section (provider/model/mode/limits — the
    API **key** is set only through the bot's `/ai key` modal, never through the website, unless you
    also implement encryption with `encryptSecret` into `ai_credentials`).
  - Risk: half-life, severity points, repeat window/multiplier, ladder editor (threshold + action).
  - Anti-Nuke (owner/extra owner): enable, mode, punishment, bot-add action, per-action module table
    (enabled, limit, window, punishment override), revert, anti-betray, threat thresholds,
    auto-emergency, emergency options, snapshot interval. Whitelist editor (user + action checkboxes)
    writes `trust_entries` then publishes `REDIS_CHANNELS.trustInvalidate`.
  - Anti-Raid, Verification (roles pickers, evasion policy, SSO, backup consent), Logging (channel
    pickers), Messages (template editor with live preview that mimics a Discord Components V2
    container — **no coloured side bar**).
- **Reviews:** list `guild_verifications` with `status='flagged'` joined with the session reasons and
  linked accounts. Approve / Deny / Ban → publish `REDIS_CHANNELS.verificationReview`
  (`VerificationReviewMessage`); the bot applies roles/bans and updates the row.
- **Cases & incidents:** read-only tables with filters and pagination (`cases`, `incidents`,
  `security_events`).

### 4.5 Data deletion (`/data`)
Discord login → confirm → delete the user's rows in `fingerprints`, `identity_links` (either side),
`oauth_grants` (also revoke the token at `POST https://discord.com/api/oauth2/token/revoke`),
`verified_identities`, `verification_sessions`; set their `guild_verifications` to `revoked`;
publish `REDIS_CHANNELS.identityRevoked`. Cases/bans stay (they belong to the servers' moderation
records) — say so on the page.

### 4.6 Privacy policy (must match reality)
What is collected (Discord ID/username, hashed IP, hashed network prefix, hashed device id, coarse
browser signals, ASN/country, OAuth tokens encrypted), why (verification, alt/ban-evasion
protection, member backup with explicit consent), retention (fingerprints 180 days, security events
90 days, sessions 7 days after expiry), sharing (only verdicts/links with servers you verify in;
cross-server signals only when both servers opt in), deletion (/data), contact.

---

## 5. Security checklist
- Validate every input with zod; never trust client-sent guild IDs/permissions.
- CSRF: OAuth `state` HMAC + cookie; dashboard mutations require same-origin + session.
- Cookies: `httpOnly`, `secure`, `sameSite=lax`, short TTL for verification (15 min).
- Rate limit verification + auth routes per IP hash (Redis `INCR` with TTL).
- Never log tokens, raw IPs, `visitorId`, API keys. Use `maskSecret` for display.
- Encrypt OAuth tokens (`encryptSecret`). Bot token only in server code.
- Honour Discord rate limits (429 + `retry_after`).
- Content Security Policy; no third-party trackers on verification pages.

## 6. Acceptance criteria
- [ ] `pnpm --filter @quill/website build` succeeds; `pnpm check` stays green.
- [ ] Lighthouse ≥ 90 (performance, accessibility, best practices) on `/`.
- [ ] Verification happy path works end-to-end against a test server: token → consent → captcha →
      fingerprint → OAuth → pass → bot receives `quill:verification:completed` and gives the role.
- [ ] Alt test: verify account A, ban A in the server, verify account B from the same browser →
      verdict `flag` (or `block` when `onMatch='block'`) with reason `alt_of_banned`.
- [ ] Reused/expired token and wrong-account flows show friendly errors.
- [ ] Dashboard: config change is visible in the bot immediately (cache invalidation), conflicting
      edits return 409, anti-nuke pages are hidden/forbidden for non-owners.
- [ ] No raw IP or token appears in the database or logs (grep the DB after a test run).
- [ ] Data deletion removes the user's fingerprint rows and revokes the OAuth grant.

## 7. Suggested milestones
1. Scaffold Next.js + Tailwind + brand system + landing + legal pages + commands page.
2. Verification flow (sessions, consent, Turnstile, fingerprint, OAuth, evaluation, publish, result).
3. Dashboard auth + server picker + config API + module pages.
4. Reviews, cases, incidents, data deletion, polish, accessibility pass.
