import { cpSync } from 'node:fs';
import { defineConfig } from 'tsup';

/**
 * Bundles the bot, shard and worker entrypoints. Workspace packages (@quill/*) are
 * compiled in; npm dependencies stay external (installed in the runtime image).
 * Database migrations are copied next to the bundle (dist/migrations).
 */
export default defineConfig({
  entry: ['src/index.ts', 'src/shard.ts', 'src/worker.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: true,
  dts: false,
  noExternal: [/^@quill\//],
  async onSuccess() {
    cpSync('../../packages/db/migrations', 'dist/migrations', { recursive: true });
  },
});
