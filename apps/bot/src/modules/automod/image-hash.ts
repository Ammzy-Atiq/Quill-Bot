import { LruCache } from '../../lib/lru.js';

type SharpFactory = (input: Buffer) => {
  resize: (w: number, h: number, o: { fit: 'fill' }) => ReturnType<SharpFactory>;
  grayscale: () => ReturnType<SharpFactory>;
  raw: () => ReturnType<SharpFactory>;
  toBuffer: () => Promise<Buffer>;
};

let sharpLoader: Promise<SharpFactory | null> | null = null;

/** sharp is an optional dependency — image hashing is skipped when it is unavailable. */
async function loadSharp(): Promise<SharpFactory | null> {
  sharpLoader ??= import('sharp').then((m) => (m.default ?? m) as unknown as SharpFactory).catch(() => null);
  return sharpLoader;
}

const MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = /^image\/(png|jpeg|jpg|webp|gif)$/i;
const cache = new LruCache<string, string | null>(2_000, 60 * 60_000);

/** 64-bit difference hash (dHash) of an image buffer, as 16 hex chars. */
export async function dHashBuffer(buffer: Buffer): Promise<string | null> {
  const sharp = await loadSharp();
  if (!sharp) return null;
  const pixels = await sharp(buffer).resize(9, 8, { fit: 'fill' }).grayscale().raw().toBuffer();
  let hex = '';
  for (let row = 0; row < 8; row++) {
    let byte = 0;
    for (let col = 0; col < 8; col++) {
      const left = pixels[row * 9 + col]!;
      const right = pixels[row * 9 + col + 1]!;
      byte = (byte << 1) | (left > right ? 1 : 0);
    }
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/** Downloads (max 8 MB, 5 s) and hashes an image attachment. Results are cached by URL. */
export async function dHashUrl(
  url: string,
  contentType: string | null,
  size: number,
): Promise<string | null> {
  if (!contentType || !IMAGE_TYPES.test(contentType) || size > MAX_BYTES) return null;
  const key = url.split('?')[0]!;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const hash = buffer.byteLength <= MAX_BYTES ? await dHashBuffer(buffer) : null;
    cache.set(key, hash);
    return hash;
  } catch {
    return null;
  }
}
