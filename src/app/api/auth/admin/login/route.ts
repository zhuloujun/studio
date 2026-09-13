import { NextRequest, NextResponse } from 'next/server';
import { verifyPassword } from '@/lib/passwordHash';
import { getEnv } from '@/lib/cloudflare';
import { normalizeEmail, requestOtp, OtpCooldownError } from '@/lib/otpService';
import { checkLockout, recordFailedAttempt, MAX_LOGIN_ATTEMPTS } from '@/lib/loginAttemptService';

// Step 1 of admin login: verify email + password, then email an OTP.
// No session is created here - that only happens after /api/auth/admin/verify-otp succeeds.
export async function POST(req: NextRequest) {
  try {
    const { email, password } = (await req.json()) as { email?: string; password?: string };
    if (typeof email !== 'string' || typeof password !== 'string') {
      return NextResponse.json({ success: false, message: '参数不完整。' }, { status: 400 });
    }

    const env = getEnv();
    const normalizedEmail = normalizeEmail(email);

    if (normalizedEmail !== normalizeEmail(env.ADMIN_EMAIL)) {
      return NextResponse.json({ success: false, message: '该账户无法登录。' }, { status: 403 });
    }

    const lockout = await checkLockout(normalizedEmail);
    if (lockout.locked) {
      return NextResponse.json(
        { success: false, message: `账户已被锁定，请在 ${lockout.minutesRemaining} 分钟后重试。` },
        { status: 423 }
      );
    }

    const admin = await env.DB.prepare(`SELECT password_hash FROM users WHERE email = ?1 AND is_admin = 1`)
      .bind(normalizedEmail)
      .first<{ password_hash: string }>();

    if (!admin || !await verifyPassword(password, admin.password_hash)) {
      const { attemptCount } = await recordFailedAttempt(normalizedEmail);
      return NextResponse.json(
        { success: false, message: `邮箱或密码错误。第 ${attemptCount} / ${MAX_LOGIN_ATTEMPTS} 次尝试。` },
        { status: 401 }
      );
    }

    await requestOtp(normalizedEmail, 'admin_login');
    return NextResponse.json({ success: true, message: '密码正确，验证码已发送至管理员邮箱。' });
  } catch (err) {
    if (err instanceof OtpCooldownError) {
      return NextResponse.json({ success: false, message: err.message }, { status: 429 });
    }
    console.error('[admin/login]', err);
    return NextResponse.json(
      { success: false, message: '登录失败，请稍后重试。', debug: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
