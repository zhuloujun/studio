// src/lib/sessionService.ts
// Server-only. D1-backed sessions (no JWT needed - the cookie only carries a
// random opaque session id, so a session can be revoked instantly server-side).
import { getEnv } from '@/lib/cloudflare';

export const SESSION_COOKIE = 'studio_session';

const USER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours - admin re-verifies via OTP each login anyway

export interface SessionInfo {
  id: string;
  userId: string;
  email: string;
  isAdmin: boolean;
}

export async function createSession(userId: string, isAdmin: boolean): Promise<{ id: string; maxAgeSeconds: number }> {
  const env = getEnv();
  const id = crypto.randomUUID();
  const now = Date.now();
  const ttl = isAdmin ? ADMIN_SESSION_TTL_MS : USER_SESSION_TTL_MS;
  const expiresAt = now + ttl;

  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, is_admin, expires_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5)`
  )
    .bind(id, userId, isAdmin ? 1 : 0, expiresAt, now)
    .run();

  return { id, maxAgeSeconds: Math.floor(ttl / 1000) };
}

export async function getSession(sessionId: string | undefined | null): Promise<SessionInfo | null> {
  if (!sessionId) return null;
  const env = getEnv();

  const row = await env.DB.prepare(
    `SELECT s.id as id, s.user_id as userId, s.is_admin as isAdmin, s.expires_at as expiresAt, u.email as email
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ?1`
  )
    .bind(sessionId)
    .first<{ id: string; userId: string; isAdmin: number; expiresAt: number; email: string }>();

  if (!row) return null;

  if (Date.now() > row.expiresAt) {
    await env.DB.prepare(`DELETE FROM sessions WHERE id = ?1`).bind(sessionId).run();
    return null;
  }

  return { id: row.id, userId: row.userId, email: row.email, isAdmin: !!row.isAdmin };
}

export async function destroySession(sessionId: string | undefined | null): Promise<void> {
  if (!sessionId) return;
  const env = getEnv();
  await env.DB.prepare(`DELETE FROM sessions WHERE id = ?1`).bind(sessionId).run();
}

export function sessionCookieHeader(id: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
