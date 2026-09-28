/**
 * Writes apps/bot/commands.manifest.json — the list of commands, subcommands,
 * options, module and required permission level. The website reads it to render
 * the public "Commands" page, so regenerate it whenever commands change:
 *   pnpm commands:manifest
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Registry } from '../src/framework/registry.js';
import { PERMISSION_LABELS } from '../src/framework/types.js';
import { MODULES } from '../src/modules/index.js';

const registry = new Registry(MODULES);
const manifest = {
  generatedAt: new Date().toISOString(),
  commands: [...registry.commands.values()].map((command) => ({
    module: command.module,
    permission: command.permission,
    permissionLabel: PERMISSION_LABELS[command.permission],
    subcommandPermissions: command.subcommandPermissions ?? {},
    ...command.data.toJSON(),
  })),
};

const out = fileURLToPath(new URL('../commands.manifest.json', import.meta.url));
writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`✔ wrote ${manifest.commands.length} commands to ${out}`);
