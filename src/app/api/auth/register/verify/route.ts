import { NextRequest, NextResponse } from 'next/server';
import { hashPassword } from '@/lib/passwordHash';
import { getEnv } from '@/lib/cloudflare';
import { verifyOtp, normalizeEmail } from '@/lib/otpService';
import { createSession, sessionCookieHeader } from '@/lib/sessionService';

export async function POST(req: NextRequest) {
  try {
    const { email, code, password } = (await req.json()) as { email?: string; code?: string; password?: string };
    if (typeof email !== 'string' || typeof code !== 'string' || typeof password !== 'string') {
      return NextResponse.json({ success: false, message: '参数不完整。' }, { status: 400 });
    }
    if (password.length < 4) {
      return NextResponse.json({ success: false, message: '密码长度至少为 4 位。' }, { status: 400 });
    }

    const normalizedEmail = normalizeEmail(email);
    const env = getEnv();

    if (normalizedEmail === normalizeEmail(env.ADMIN_EMAIL)) {
      return NextResponse.json({ success: false, message: '该邮箱无法注册。' }, { status: 400 });
    }

    const existing = await env.DB.prepare(`SELECT id FROM users WHERE email = ?1`).bind(normalizedEmail).first();
    if (existing) {
      return NextResponse.json({ success: false, message: '该邮箱已被注册。' }, { status: 409 });
    }

    const otpResult = await verifyOtp(normalizedEmail, 'register', code);
    if (!otpResult.valid) {
      return NextResponse.json({ success: false, message: otpResult.reason }, { status: 400 });
    }

    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(password);
    const now = Date.now();

    await env.DB.prepare(
      `INSERT INTO users (id, email, password_hash, is_admin, created_at) VALUES (?1, ?2, ?3, 0, ?4)`
    )
      .bind(id, normalizedEmail, passwordHash, now)
      .run();

    const session = await createSession(id, false);

    const res = NextResponse.json({ success: true, message: '注册成功。', email: normalizedEmail });
    res.headers.set('Set-Cookie', sessionCookieHeader(session.id, session.maxAgeSeconds));
    return res;
  } catch (err) {
    console.error('[register/verify]', err);
    return NextResponse.json(
      { success: false, message: '注册失败，请稍后重试。', debug: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
