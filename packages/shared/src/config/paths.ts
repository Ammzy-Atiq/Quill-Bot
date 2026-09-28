/**
 * Helpers for editing the SPARSE stored config by path, e.g.
 * `setAtPath(raw, ['automod', 'spam', 'enabled'], false)`.
 * Both the bot and the website dashboard must edit configs this way and then
 * validate with `validateGuildConfig` before saving.
 */
export type ConfigPath = readonly (string | number)[];

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function cloneConfig<T>(value: T): T {
  return structuredClone(value);
}

export function getAtPath(raw: unknown, path: ConfigPath): unknown {
  let cur: unknown = raw;
  for (const key of path) {
    if (Array.isArray(cur) && typeof key === 'number') cur = cur[key];
    else if (isObject(cur)) cur = cur[String(key)];
    else return undefined;
  }
  return cur;
}

/** Returns a new object with `value` written at `path` (creating objects as needed). */
export function setAtPath<T extends object>(raw: T, path: ConfigPath, value: unknown): T {
  if (path.length === 0) throw new Error('Empty config path');
  const root = cloneConfig((raw ?? {}) as Json);
  let cur: Json = root;
  for (let i = 0; i < path.length - 1; i++) {
    const key = String(path[i]);
    if (!isObject(cur[key])) cur[key] = {};
    cur = cur[key] as Json;
  }
  cur[String(path[path.length - 1])] = value;
  return root as T;
}

/** Returns a new object with the key at `path` removed (restoring the default), pruning empty parents. */
export function unsetAtPath<T extends object>(raw: T, path: ConfigPath): T {
  if (path.length === 0) return {} as T;
  const root = cloneConfig((raw ?? {}) as Json);
  const stack: Json[] = [root];
  let cur: Json = root;
  for (let i = 0; i < path.length - 1; i++) {
    const next = cur[String(path[i])];
    if (!isObject(next)) return root as T;
    cur = next;
    stack.push(cur);
  }
  delete cur[String(path[path.length - 1])];
  for (let i = stack.length - 1; i > 0; i--) {
    const node = stack[i]!;
    if (Object.keys(node).length === 0) delete stack[i - 1]![String(path[i - 1])];
  }
  return root as T;
}
