import { NextRequest, NextResponse } from 'next/server';
import { getEnv } from '@/lib/cloudflare';
import { requestOtp, normalizeEmail, OtpCooldownError } from '@/lib/otpService';

export const runtime = 'edge';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  try {
    const { email } = (await req.json()) as { email?: string };
    if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
      return NextResponse.json({ success: false, message: '请输入有效的邮箱地址。' }, { status: 400 });
    }

    const env = getEnv();
    const normalizedEmail = normalizeEmail(email);

    const existing = await env.DB.prepare(`SELECT id FROM users WHERE email = ?1`).bind(normalizedEmail).first();
    if (existing) {
      return NextResponse.json({ success: false, message: '该邮箱已被注册。' }, { status: 409 });
    }

    await requestOtp(normalizedEmail, 'register');
    return NextResponse.json({ success: true, message: '验证码已发送，请查收邮箱。' });
  } catch (err) {
    if (err instanceof OtpCooldownError) {
      return NextResponse.json({ success: false, message: err.message }, { status: 429 });
    }
    console.error('[register/request-otp]', err);
    return NextResponse.json(
      { success: false, message: '发送验证码失败，请稍后重试。', debug: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
