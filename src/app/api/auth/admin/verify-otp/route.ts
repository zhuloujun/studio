import { NextRequest, NextResponse } from 'next/server';
import { getEnv } from '@/lib/cloudflare';
import { normalizeEmail, verifyOtp } from '@/lib/otpService';
import { createSession, sessionCookieHeader } from '@/lib/sessionService';
import { clearAttempts } from '@/lib/loginAttemptService';

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  try {
    const { email, code } = (await req.json()) as { email?: string; code?: string };
    if (typeof email !== 'string' || typeof code !== 'string') {
      return NextResponse.json({ success: false, message: '参数不完整。' }, { status: 400 });
    }

    const env = getEnv();
    const normalizedEmail = normalizeEmail(email);

    if (normalizedEmail !== normalizeEmail(env.ADMIN_EMAIL)) {
      return NextResponse.json({ success: false, message: '该账户无法登录。' }, { status: 403 });
    }

    const admin = await env.DB.prepare(`SELECT id FROM users WHERE email = ?1 AND is_admin = 1`)
      .bind(normalizedEmail)
      .first<{ id: string }>();
    if (!admin) {
      return NextResponse.json({ success: false, message: '管理员账户不存在。' }, { status: 404 });
    }

    const otpResult = await verifyOtp(normalizedEmail, 'admin_login', code);
    if (!otpResult.valid) {
      return NextResponse.json({ success: false, message: otpResult.reason }, { status: 400 });
    }

    await clearAttempts(normalizedEmail);
    const session = await createSession(admin.id, true);

    const res = NextResponse.json({ success: true, message: '登录成功。', email: normalizedEmail });
    res.headers.set('Set-Cookie', sessionCookieHeader(session.id, session.maxAgeSeconds));
    return res;
  } catch (err) {
    console.error('[admin/verify-otp]', err);
    return NextResponse.json({ success: false, message: '验证失败，请稍后重试。' }, { status: 500 });
  }
}
