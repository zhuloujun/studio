// src/lib/adminSettingsVerification.ts
// Server-only. Backs a single, unified "发送邮箱验证码" flow that gates
// every admin-configurable setting that doesn't already have its own OTP
// flow (login URL change and admin password change already have dedicated,
// well-tested OTP flows of their own and are left as-is; this covers the
// newer settings - the "文献库" links and the storage quota - which had no
// verification at all, so anyone with an admin session cookie could change
// them). One verified code unlocks a short-lived session token the admin
// can use for several saves in a row, rather than needing a fresh code per
// module.
import { getEnv } from '@/lib/cloudflare';

const SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes

export async function issueVerificationToken(): Promise<string> {
  const env = getEnv();
  const token = crypto.randomUUID();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  await env.DB.prepare(`INSERT INTO admin_settings_verification (token, expires_at) VALUES (?1, ?2)`)
    .bind(token, expiresAt)
    .run();
  return token;
}

export async function isVerificationTokenValid(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  const env = getEnv();
  const row = await env.DB.prepare(`SELECT expires_at FROM admin_settings_verification WHERE token = ?1`)
    .bind(token)
    .first<{ expires_at: number }>();
  if (!row) return false;
  if (Date.now() > row.expires_at) {
    await env.DB.prepare(`DELETE FROM admin_settings_verification WHERE token = ?1`).bind(token).run();
    return false;
  }
  return true;
}
