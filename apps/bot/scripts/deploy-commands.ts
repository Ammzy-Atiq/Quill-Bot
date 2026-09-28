/**
 * Registers slash commands.
 *   pnpm commands:deploy            → global (all servers, may take a few minutes to appear)
 *   pnpm commands:deploy --dev      → only DEV_GUILD_ID (instant, for development)
 *   pnpm commands:deploy --clear    → remove commands (combine with --dev for the dev guild)
 */
import { REST, Routes } from 'discord.js';
import { loadEnv } from '../src/env.js';
import { Registry } from '../src/framework/registry.js';
import { MODULES } from '../src/modules/index.js';

async function main() {
  const env = loadEnv();
  const dev = process.argv.includes('--dev');
  const clear = process.argv.includes('--clear');
  const body = clear ? [] : new Registry(MODULES).commandJson();
  const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);

  if (dev) {
    if (!env.DEV_GUILD_ID) throw new Error('Set DEV_GUILD_ID to deploy guild commands.');
    await rest.put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DEV_GUILD_ID), { body });
    console.log(`✔ ${body.length} command(s) deployed to guild ${env.DEV_GUILD_ID}`);
  } else {
    await rest.put(Routes.applicationCommands(env.DISCORD_CLIENT_ID), { body });
    console.log(`✔ ${body.length} global command(s) deployed`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
