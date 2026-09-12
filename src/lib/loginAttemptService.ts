// src/lib/loginAttemptService.ts
// Server-only. Tracks failed login attempts per email in D1 to enforce a lockout,
// same policy as before but enforced server-side (can no longer be bypassed by
// clearing browser localStorage).
import { getEnv } from '@/lib/cloudflare';
import { normalizeEmail } from '@/lib/otpService';

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_PERIOD_MINUTES = 10; // window in which attempts accumulate
const LOCKOUT_DURATION_MINUTES = 30; // how long the account stays locked

export async function checkLockout(email: string): Promise<{ locked: boolean; minutesRemaining?: number }> {
  const env = getEnv();
  const normalizedEmail = normalizeEmail(email);
  const row = await env.DB.prepare(`SELECT locked_until FROM login_attempts WHERE email = ?1`)
    .bind(normalizedEmail)
    .first<{ locked_until: number | null }>();

  if (row?.locked_until && Date.now() < row.locked_until) {
    return { locked: true, minutesRemaining: Math.ceil((row.locked_until - Date.now()) / 60000) };
  }
  return { locked: false };
}

export async function recordFailedAttempt(email: string): Promise<{ lockedNow: boolean; attemptCount: number }> {
  const env = getEnv();
  const normalizedEmail = normalizeEmail(email);
  const now = Date.now();

  const existing = await env.DB.prepare(
    `SELECT count, first_attempt_at FROM login_attempts WHERE email = ?1`
  )
    .bind(normalizedEmail)
    .first<{ count: number; first_attempt_at: number }>();

  let newCount = 1;
  let firstAttemptAt = now;
  if (existing) {
    const minutesSinceFirst = (now - existing.first_attempt_at) / 60000;
    if (minutesSinceFirst <= LOCKOUT_PERIOD_MINUTES) {
      newCount = existing.count + 1;
      firstAttemptAt = existing.first_attempt_at;
    }
  }

  const lockedNow = newCount >= MAX_LOGIN_ATTEMPTS;
  const lockedUntil = lockedNow ? now + LOCKOUT_DURATION_MINUTES * 60000 : null;

  await env.DB.prepare(
    `INSERT INTO login_attempts (email, count, first_attempt_at, locked_until)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(email) DO UPDATE SET count = ?2, first_attempt_at = ?3, locked_until = ?4`
  )
    .bind(normalizedEmail, newCount, firstAttemptAt, lockedUntil)
    .run();

  return { lockedNow, attemptCount: newCount };
}

export async function clearAttempts(email: string): Promise<void> {
  const env = getEnv();
  const normalizedEmail = normalizeEmail(email);
  await env.DB.prepare(`DELETE FROM login_attempts WHERE email = ?1`).bind(normalizedEmail).run();
}

export { MAX_LOGIN_ATTEMPTS, LOCKOUT_DURATION_MINUTES };
