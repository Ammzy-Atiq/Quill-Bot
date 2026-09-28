<p align="center">
  <img src="assets/brand/quill-logo.webp" alt="QUILL GUARD" width="160" />
</p>

<h1 align="center">QUILL GUARD</h1>
<p align="center"><b>Advanced Discord server security — AutoMod, Verification & Anti-Nuke.</b><br/>
Made by <b>Atiq Ur Rahman</b>.</p>

---

## Features

- **AutoMod** — a normalizer that sees through Unicode lookalikes, invisible characters, spacing,
  repetition and leetspeak; 2000+ categorized words you can toggle; spam, scam (MrBeast/Elon/crypto,
  compromised accounts), link/advertising, harassment and toxicity detectors; **AI analysis with your
  own API key**; custom policies, words, severities and messages; shadow mode for safe tuning.
- **Risk Engine** — one decaying risk score per member with a configurable escalation ladder
  (warn → timeout → kick → ban).
- **Verification** — website + Discord OAuth2 (`identify`, `guilds.join`), privacy-preserving
  fingerprints to stop alts and ban/punishment evasion, SSO across QUILL servers, member backups.
- **Anti-Nuke** — Olympus-style owner/extra-owner model, per-action whitelist, strict or threshold
  detection from audit-log events, instant punishment + revert, emergency mode, snapshots & recovery,
  hardening audit, red-team simulation. **Anti-Raid** with raid mode.
- Every message is built with **Discord Components V2** — clean containers, no coloured side bars.

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

Works with any PostgreSQL (Neon, Supabase, Railway, Render, VPS) and any Redis.

## For contributors & AI agents

Start with [`AGENTS.md`](AGENTS.md) — architecture, conventions, contracts and the status board.
The website is specified in [`apps/website/AGENTS.md`](apps/website/AGENTS.md).

```bash
pnpm check   # lint + typecheck + tests
```
