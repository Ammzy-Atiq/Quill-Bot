# AGENTS.md — apps/bot (Discord bot)

Owner: **bot-agent**. Read the root `AGENTS.md` first — the rules there (Components V2 only, no
accent colour, permission model, privacy) apply here.

## Layout
| Path | What |
|---|---|
| `src/index.ts` | Production entry: runs migrations, spawns shards (`ShardingManager`) |
| `src/shard.ts` | One shard; also the dev entry. `--dry-run` = boot check without secrets |
| `src/worker.ts`, `src/worker/*` | BullMQ worker (REST only): retention, restores, member pulls |
| `src/app.ts` | `App` container passed everywhere (client, env, logger, db, store, services) |
| `src/client.ts` | Intents, partials, cache limits |
| `src/framework/` | `types.ts` (SlashCommand, ComponentHandler, EventHandler, BotModule, UserError), `router.ts`, `permissions.ts`, `custom-id.ts`, `registry.ts` |
| `src/ui/` | `Card` builder, presets (success/error/warning/info/confirm), `reply`/`update`/`send`, V2 limit checks, emojis |
| `src/services/` | `configs` (cached guild config + updates, `replaceId`), `trust` (extra owners/whitelist), `logs` (log channels), `cases`, `moderation` (hierarchy-checked punishments → cases), `risk` (Redis + Postgres scores) |
| `src/modules/<name>/` | Feature modules. Each exports a `BotModule` registered in `src/modules/index.ts` |
| `src/modules/automod/` | pipeline service, data (matchers, scam data), image hashes, panel/cards, `/automod /policy /ai /risk`, `ai/` providers (BYOK) |
| `src/modules/antinuke/` | `mapping.ts` (audit entry → action), `service.ts` (`app.antinuke`: decisions, punish, incidents), `revert.ts` (`Reverter`), `emergency.ts` (`app.emergency`), `snapshots.ts` (`app.snapshots`), `serialize.ts` (snapshot format), `cards.ts` (incident card), `audit.ts` (hardening audit), `panel.ts`, commands: `antinuke-command.ts`, `trust-command.ts` (`/whitelist` `/extraowner`), `emergency-command.ts`, `backup-command.ts`, `incident-command.ts`; `index.ts` wires events (audit log, @everyone, delete caches, snapshot scheduler) |
| `src/modules/antiraid/` | `service.ts` (`app.antiraid`: join filters, raid mode), `command.ts` (`/antiraid`, raid card button) |
| `src/modules/moderation/` | `commands.ts` (`/warn /timeout /untimeout /kick /softban /ban /unban /quarantine /unquarantine /purge`), `quick-actions.ts` (log-card buttons, ban mirror) |
| `src/modules/general/messages.ts` | `/messages` template editor (modal) |
| `src/modules/automod/native.ts` | `/automod native` — Discord AutoMod keyword rule sync |
| `src/modules/verification/` | `service.ts` (`app.verification`: Verify flow, website verdicts, reviews, SSO/rejoin, kick timer), `command.ts` (`/verification`, Verify + review buttons), `data-command.ts` (`/data`), `cards.ts` |
| `src/modules/antinuke/member-backup.ts` | `/backup server …` and `/backup members …` (queues `QUEUES.memberPull`) |
| `src/worker/` | `jobs.ts` (queue → handler), `retention.ts`, `member-pull.ts` (guilds.join re-adds with token refresh) |
| `src/lib/jobs.ts` | `app.jobs` — BullMQ producers (needs `REDIS_URL`) |
| `src/lib/` | store (Redis/memory), LRU, formatting, links, migrations, action choices |
| `scripts/` | `deploy-commands.ts`, `export-manifest.ts`, `verify-link.ts` (dev: signed verification link for the website) |

## Add a command
```ts
// src/modules/example/index.ts
export const exampleModule: BotModule = {
  name: 'general',
  commands: [{
    module: 'general',
    permission: 'manager',                       // everyone | moderator | manager | extra_owner | owner
    subcommandPermissions: { reset: 'owner' },    // optional per-subcommand override
    data: new SlashCommandBuilder().setName('example').setDescription('…'),
    async execute({ app, interaction, guild, config }) {
      await reply(interaction, successCard('Done'), { ephemeral: true });
    },
  }],
};
```
Then add it to `MODULES` in `src/modules/index.ts`, run `pnpm commands:manifest` and
`pnpm commands:deploy --dev`.

## Add a button / select / modal handler
- Build ids with `lockedId(interaction.user.id, '<module>', '<action>', ...args)` (or `cid()` for
  public buttons such as the verification panel).
- Register `{ id: '<module>:<action>', permission, locked: true, execute }` in the module's
  `components`. The router checks the lock and permission, loads config, catches errors.
- Re-render panels with `update(interaction, newContainer)`.

## Rules of thumb
- Throw `new UserError('message', 'Title')` for expected failures — the router shows an error card.
- Settings changes go through `app.configs.set/update/reset` (validates, audits, broadcasts).
- Use `app.logs.send(guild, category, card)` for log channels and `app.cases.create()` for cases.
- Long work (> 3 s): `deferReply`, then `reply()` (it edits the deferred reply with the V2 flag).
- Anything heavy or rate-limit bound across many objects (restore, member pull) → worker queue.
- Tests live in `test/`; UI builders must stay within V2 limits (see `test/ui.test.ts`).
