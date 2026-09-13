import { NextRequest, NextResponse } from 'next/server';
import { getEnv } from '@/lib/cloudflare';
import { normalizeEmail, requestOtp, OtpCooldownError } from '@/lib/otpService';

export const runtime = 'edge';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// This is intentionally NOT session-gated (the whole point is the user is
// logged out and forgot their password). To avoid leaking which emails are
// registered, we always return the same success message - we just only
// actually send an email when the account exists.
export async function POST(req: NextRequest) {
  try {
    const { email } = (await req.json()) as { email?: string };
    if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
      return NextResponse.json({ success: false, message: '请输入有效的邮箱地址。' }, { status: 400 });
    }

    const env = getEnv();
    const normalizedEmail = normalizeEmail(email);

    // Admin account uses its own login/verification flow, not this one.
    if (normalizedEmail === normalizeEmail(env.ADMIN_EMAIL)) {
      return NextResponse.json({ success: false, message: '该邮箱无法通过此方式找回密码。' }, { status: 400 });
    }

    const user = await env.DB.prepare(`SELECT id FROM users WHERE email = ?1 AND is_admin = 0`)
      .bind(normalizedEmail)
      .first();

    if (user) {
      await requestOtp(normalizedEmail, 'reset_password');
    }

    // Same message whether or not the account exists.
    return NextResponse.json({ success: true, message: '如果该邮箱已注册，验证码已发送，请查收邮箱。' });
  } catch (err) {
    if (err instanceof OtpCooldownError) {
      return NextResponse.json({ success: false, message: err.message }, { status: 429 });
    }
    console.error('[password/forgot/request-otp]', err);
    return NextResponse.json(
      { success: false, message: '发送验证码失败，请稍后重试。', debug: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
