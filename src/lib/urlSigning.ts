// src/lib/urlSigning.ts
// Server-only. Signs URLs returned by /api/external-search so
// /api/external-search/proxy can safely fetch ANY domain a result happens
// to point to (open-access papers/books are hosted all over the place -
// publisher sites, institutional repositories, etc., not a fixed list of
// domains) while still preventing the proxy from being used as an open
// SSRF relay: it will only fetch a URL that was itself issued by our own
// search endpoint moments ago, verified via HMAC signature + short expiry.
import { getSetting, setSetting } from './adminSettings';

const SIGNING_SECRET_KEY = 'external_url_signing_secret';
const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes - plenty to click "read" after searching

async function getSigningSecret(): Promise<string> {
  let secret = await getSetting(SIGNING_SECRET_KEY);
  if (!secret) {
    secret = crypto.randomUUID() + crypto.randomUUID();
    await setSetting(SIGNING_SECRET_KEY, secret);
  }
  return secret;
}

async function hmacHex(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Wraps a real URL into an opaque, time-limited signed token. */
export async function signUrl(url: string): Promise<string> {
  const secret = await getSigningSecret();
  const expiry = Date.now() + TOKEN_TTL_MS;
  const payload = `${url}|${expiry}`;
  const sig = await hmacHex(payload, secret);
  return `${encodeURIComponent(url)}.${expiry}.${sig}`;
}

/** Returns the original URL if the token is validly signed and not expired, else null. */
export async function verifySignedUrl(token: string): Promise<string | null> {
  const lastDot = token.lastIndexOf('.');
  const secondLastDot = token.lastIndexOf('.', lastDot - 1);
  if (lastDot < 0 || secondLastDot < 0) return null;

  const encodedUrl = token.slice(0, secondLastDot);
  const expiryStr = token.slice(secondLastDot + 1, lastDot);
  const sig = token.slice(lastDot + 1);
  const expiry = parseInt(expiryStr, 10);
  if (!expiry || Number.isNaN(expiry) || Date.now() > expiry) return null;

  let url: string;
  try {
    url = decodeURIComponent(encodedUrl);
  } catch {
    return null;
  }

  const secret = await getSigningSecret();
  const expectedSig = await hmacHex(`${url}|${expiry}`, secret);
  if (expectedSig !== sig) return null;

  return url;
}
