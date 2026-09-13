import { NextRequest, NextResponse } from 'next/server';
import { verifyPassword } from '@/lib/passwordHash';
import { getEnv } from '@/lib/cloudflare';
import { normalizeEmail } from '@/lib/otpService';
import { createSession, sessionCookieHeader } from '@/lib/sessionService';
import { checkLockout, recordFailedAttempt, clearAttempts, MAX_LOGIN_ATTEMPTS } from '@/lib/loginAttemptService';

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  try {
    const { email, password } = (await req.json()) as { email?: string; password?: string };
    if (typeof email !== 'string' || typeof password !== 'string') {
      return NextResponse.json({ success: false, message: '参数不完整。' }, { status: 400 });
    }

    const env = getEnv();
    const normalizedEmail = normalizeEmail(email);

    // Admins must use the dedicated admin login flow (OTP-gated every time).
    if (normalizedEmail === normalizeEmail(env.ADMIN_EMAIL)) {
      return NextResponse.json({ success: false, message: '该账户无法登录，请使用管理员登录入口。' }, { status: 403 });
    }

    const lockout = await checkLockout(normalizedEmail);
    if (lockout.locked) {
      return NextResponse.json(
        { success: false, message: `账户已被锁定，请在 ${lockout.minutesRemaining} 分钟后重试。` },
        { status: 423 }
      );
    }

    const user = await env.DB.prepare(`SELECT id, password_hash FROM users WHERE email = ?1`)
      .bind(normalizedEmail)
      .first<{ id: string; password_hash: string }>();

    if (!user || !await verifyPassword(password, user.password_hash)) {
      const { attemptCount } = await recordFailedAttempt(normalizedEmail);
      return NextResponse.json(
        { success: false, message: `邮箱或密码错误。第 ${attemptCount} / ${MAX_LOGIN_ATTEMPTS} 次尝试。` },
        { status: 401 }
      );
    }

    await clearAttempts(normalizedEmail);
    const session = await createSession(user.id, false);

    const res = NextResponse.json({ success: true, message: '登录成功。', email: normalizedEmail });
    res.headers.set('Set-Cookie', sessionCookieHeader(session.id, session.maxAgeSeconds));
    return res;
  } catch (err) {
    console.error('[auth/login]', err);
    return NextResponse.json(
      { success: false, message: '登录失败，请稍后重试。', debug: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
