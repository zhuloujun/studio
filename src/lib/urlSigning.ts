// src/lib/urlSigning.ts
// Server-only. Turns URLs returned by /api/external-search into short,
// opaque tokens that /api/external-search/proxy will accept, so the proxy
// can safely fetch ANY domain a result happens to point to (open-access
// papers/books are hosted all over the place - publisher sites,
// institutional repositories, etc., not a fixed list of domains) without
// being usable as an open SSRF relay for arbitrary URLs.
//
// This used to embed the URL itself (percent-encoded) plus an expiry and an
// HMAC signature directly in the token string. That worked for short URLs,
// but some sources (DOAJ especially, since full-text links there point to
// whatever journal platform hosts the article, often with long tracking/
// session query strings) produce very long URLs. The resulting token, once
// percent-encoded AGAIN to go in our own proxy's query string, could get
// long enough to be mangled somewhere in the pipeline - which surfaced as
// "this link has expired" (signature verification failing) for every
// single DOAJ result, even ones opened seconds after searching.
//
// Storing the mapping in D1 instead and handing back a short random token
// sidesteps the whole problem: the token's length never depends on the
// underlying URL's length.
import { getEnv } from './cloudflare';

const TOKEN_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

/** Stores a URL and returns a short, opaque token that resolves back to it (see verifySignedUrl) until it expires. */
export async function signUrl(url: string): Promise<string> {
  const env = getEnv();
  const token = crypto.randomUUID();
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  await env.DB.prepare(`INSERT INTO signed_urls (token, url, expires_at) VALUES (?1, ?2, ?3)`)
    .bind(token, url, expiresAt)
    .run();

  // Lightweight, occasional cleanup so this table doesn't grow forever -
  // no need to run it on every call, just often enough to keep it tidy.
  if (Math.random() < 0.02) {
    env.DB.prepare(`DELETE FROM signed_urls WHERE expires_at < ?1`).bind(Date.now()).run().catch(() => {});
  }

  return token;
}

/** Returns the original URL if the token is valid and not expired, else null. */
export async function verifySignedUrl(token: string): Promise<string | null> {
  const env = getEnv();
  const row = await env.DB.prepare(`SELECT url, expires_at FROM signed_urls WHERE token = ?1`)
    .bind(token)
    .first<{ url: string; expires_at: number }>();

  if (!row) return null;
  if (Date.now() > row.expires_at) {
    // Opportunistic cleanup of this one expired row; a broader periodic
    // sweep isn't necessary since D1 storage for this table stays tiny
    // (rows are only ever a token + a URL string).
    await env.DB.prepare(`DELETE FROM signed_urls WHERE token = ?1`).bind(token).run();
    return null;
  }
  return row.url;
}
