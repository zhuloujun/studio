// src/lib/passwordHash.ts
// Password hashing using the Web Crypto API's PBKDF2 implementation.
//
// We deliberately avoid bcryptjs here: it does a bare `require('crypto')`
// internally which the Edge/webpack bundling used by @cloudflare/next-on-pages
// cannot resolve, causing the whole function to crash at runtime (a non-JSON
// 500 from Cloudflare, not something our try/catch can even see). PBKDF2 via
// crypto.subtle is natively supported in the Workers runtime with zero
// Node.js compatibility shims required.
const ITERATIONS = 100_000;
const HASH_ALGO = 'SHA-256';
const KEY_LENGTH_BITS = 256;
const SALT_LENGTH_BYTES = 16;

function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

async function deriveBits(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: HASH_ALGO }, keyMaterial, KEY_LENGTH_BITS);
}

/** Returns a self-describing hash string: pbkdf2:<iterations>:<saltHex>:<hashHex> */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES));
  const derived = await deriveBits(password, salt, ITERATIONS);
  return `pbkdf2:${ITERATIONS}:${toHex(salt)}:${toHex(derived)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = parseInt(parts[1], 10);
  const salt = fromHex(parts[2]);
  const expectedHex = parts[3];

  const derived = await deriveBits(password, salt, iterations);
  const actualHex = toHex(derived);

  if (actualHex.length !== expectedHex.length) return false;
  // constant-time comparison
  let diff = 0;
  for (let i = 0; i < actualHex.length; i++) {
    diff |= actualHex.charCodeAt(i) ^ expectedHex.charCodeAt(i);
  }
  return diff === 0;
}
