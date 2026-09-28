import { CUSTOM_ID_PREFIX, DISCORD_LIMITS } from '@quill/shared';

/**
 * custom_id scheme: `qg:<module>:<action>[:arg...]` (≤100 chars).
 * Arguments must not contain `:`. Use `lockedId` to bind a component to one user.
 */
export function cid(module: string, action: string, ...args: Array<string | number | boolean>): string {
  const parts = [CUSTOM_ID_PREFIX, module, action, ...args.map(String)];
  for (const part of parts.slice(1)) {
    if (part.includes(':')) throw new Error(`custom_id part contains ':' → ${part}`);
  }
  const id = parts.join(':');
  if (id.length > DISCORD_LIMITS.customIdLength) throw new Error(`custom_id too long (${id.length}): ${id}`);
  return id;
}

/** A custom id only `userId` may use (router enforces it for `locked` handlers). */
export function lockedId(
  userId: string,
  module: string,
  action: string,
  ...args: Array<string | number | boolean>
) {
  return cid(module, action, userId, ...args);
}

export interface ParsedCustomId {
  handlerId: string;
  args: string[];
}

export function parseCid(customId: string): ParsedCustomId | null {
  const parts = customId.split(':');
  if (parts[0] !== CUSTOM_ID_PREFIX || parts.length < 3) return null;
  return { handlerId: `${parts[1]}:${parts[2]}`, args: parts.slice(3) };
}
