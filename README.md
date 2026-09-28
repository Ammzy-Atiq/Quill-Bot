<p align="center">
  <img src="assets/brand/quill-logo.webp" alt="QUILL GUARD" width="160" />
</p>

<h1 align="center">QUILL GUARD</h1>
<p align="center"><b>Advanced Discord server security — AutoMod, Verification & Anti-Nuke.</b><br/>
Made by <b>Atiq Ur Rahman</b>.</p>

---

## Features

- **AutoMod** — a normalizer that sees through Unicode lookalikes, invisible characters, spacing,
  repetition and leetspeak; 2800+ categorized words in 14 languages you can toggle; spam, scam
  (MrBeast/Elon/crypto, compromised accounts), link/advertising, harassment and toxicity detectors;
  **AI analysis with your own API key**; custom policies, words, severities and messages; shadow mode
  for safe tuning; optional mirror of the worst terms into Discord's native AutoMod.
- **Risk Engine** — one decaying risk score per member with a configurable escalation ladder
  (warn → timeout → kick → ban).
- **Verification** — website + Discord OAuth2 (`identify`, `guilds.join`), privacy-preserving
  fingerprints to stop alts and ban/punishment evasion, SSO across QUILL servers, member backups.
- **Anti-Nuke** — Olympus-style owner/extra-owner model, per-action whitelist, strict or threshold
  detection from audit-log events, instant punishment + revert, emergency mode, snapshots & recovery,
  hardening audit, red-team simulation. **Anti-Raid** with raid mode.
- **Moderation** — cases for everything, warnings with expiry, timeouts, kicks, (soft)bans,
  quarantine, purge, and customisable messages for every DM and notice.
- Every message is built with **Discord Components V2** — clean containers, no coloured side bars.

## First steps in a server

1. **Invite** QUILL with Administrator and drag its role to the **top** of the role list.
2. `/setup` — pick a log channel (route categories with `/logs set`).
3. `/antinuke enable` (owner) → `/whitelist add` your staff and trusted bots → `/antinuke audit`.
4. `/verification setup` → `/verification panel` (website verification with alt & ban-evasion checks).
5. `/automod panel` — AutoMod is on with safe defaults; tune detectors, words and responses.
6. `/antiraid enable`, `/backup create`, and optionally `/backup server add` for member recovery.

## Commands

| Area | Commands |
|---|---|
| General | `/help` `/about` `/ping` `/setup` `/messages` `/logs` |
| AutoMod & risk | `/automod` (panel, test, detectors, words, links, scam, spam, native sync…) `/policy` `/ai` `/risk` |
| Anti-Nuke | `/antinuke` (panel, mode, punishment, limits, audit, simulate) `/whitelist` `/extraowner` `/emergency` `/backup` `/incident` |
| Anti-Raid | `/antiraid` |
| Verification | `/verification` `/data` |
| Moderation | `/warn` `/timeout` `/untimeout` `/kick` `/softban` `/ban` `/unban` `/quarantine` `/unquarantine` `/purge` `/case` |

Full reference: `apps/bot/commands.manifest.json` (also rendered on the website's commands page).

## Quick start (development)

```bash
pnpm install
docker compose up -d postgres redis
cp .env.example .env        # add your Discord token, client id and secrets
pnpm commands:deploy --dev  # register slash commands in DEV_GUILD_ID
pnpm dev:bot                # start the bot (auto-applies migrations)
```

In the Discord developer portal enable the **Server Members** and **Message Content** intents.
Invite the bot with Administrator and move its role to the top.

## Production

```bash
docker compose up -d --build           # postgres + redis + bot (sharded) + worker
# or
pnpm build && node apps/bot/dist/index.js   # + node apps/bot/dist/worker.js
```

Works with any PostgreSQL (Neon, Supabase, Railway, Render, VPS) and any Redis. The worker runs
retention cleanup and member-backup pulls (set `DISCORD_CLIENT_SECRET` so it can refresh tokens).

## For contributors & AI agents

Start with [`AGENTS.md`](AGENTS.md) — architecture, conventions, contracts and the status board.
The website is specified in [`apps/website/AGENTS.md`](apps/website/AGENTS.md).

```bash
pnpm check   # lint + typecheck + tests
```
