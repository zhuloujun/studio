// src/lib/otpService.ts
// Server-only. Generates, stores (hashed) and verifies one-time codes in D1.
import { getEnv } from '@/lib/cloudflare';
import { sendOtpEmail, type OtpPurpose } from '@/lib/emailService';

export type { OtpPurpose };

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds between sends

export class OtpCooldownError extends Error {
  constructor(public secondsRemaining: number) {
    super(`请等待 ${secondsRemaining} 秒后再重新发送验证码`);
  }
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function generateSixDigitCode(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(arr[0] % 1_000_000).padStart(6, '0');
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Creates a new OTP for (email, purpose), stores its hash in D1, and emails it.
 * Throws OtpCooldownError if one was already sent very recently.
 */
export async function requestOtp(email: string, purpose: OtpPurpose): Promise<void> {
  const env = getEnv();
  const normalizedEmail = normalizeEmail(email);
  const now = Date.now();

  const recent = await env.DB.prepare(
    `SELECT created_at FROM otp_codes WHERE email = ?1 AND purpose = ?2 ORDER BY created_at DESC LIMIT 1`
  )
    .bind(normalizedEmail, purpose)
    .first<{ created_at: number }>();

  if (recent && now - recent.created_at < OTP_RESEND_COOLDOWN_MS) {
    throw new OtpCooldownError(Math.ceil((OTP_RESEND_COOLDOWN_MS - (now - recent.created_at)) / 1000));
  }

  const code = generateSixDigitCode();
  const codeHash = await sha256Hex(code);
  const id = crypto.randomUUID();
  const expiresAt = now + OTP_TTL_MS;

  await env.DB.prepare(
    `INSERT INTO otp_codes (id, email, code_hash, purpose, expires_at, consumed, attempts, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 0, 0, ?6)`
  )
    .bind(id, normalizedEmail, codeHash, purpose, expiresAt, now)
    .run();

  await sendOtpEmail(normalizedEmail, code, purpose);
}

/**
 * Verifies a submitted code against the most recent unconsumed OTP for (email, purpose).
 * Returns true/false; also enforces a max-attempts lock on that OTP row.
 */
export async function verifyOtp(email: string, purpose: OtpPurpose, submittedCode: string): Promise<{ valid: boolean; reason?: string }> {
  const env = getEnv();
  const normalizedEmail = normalizeEmail(email);

  const row = await env.DB.prepare(
    `SELECT id, code_hash, expires_at, consumed, attempts FROM otp_codes
     WHERE email = ?1 AND purpose = ?2 ORDER BY created_at DESC LIMIT 1`
  )
    .bind(normalizedEmail, purpose)
    .first<{ id: string; code_hash: string; expires_at: number; consumed: number; attempts: number }>();

  if (!row) return { valid: false, reason: '尚未发送验证码，请先获取验证码。' };
  if (row.consumed) return { valid: false, reason: '验证码已被使用，请重新获取。' };
  if (Date.now() > row.expires_at) return { valid: false, reason: '验证码已过期，请重新获取。' };
  if (row.attempts >= OTP_MAX_ATTEMPTS) return { valid: false, reason: '验证码错误次数过多，请重新获取。' };

  const submittedHash = await sha256Hex(submittedCode.trim());
  if (submittedHash !== row.code_hash) {
    await env.DB.prepare(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?1`).bind(row.id).run();
    return { valid: false, reason: '验证码不正确。' };
  }

  await env.DB.prepare(`UPDATE otp_codes SET consumed = 1 WHERE id = ?1`).bind(row.id).run();
  return { valid: true };
}
