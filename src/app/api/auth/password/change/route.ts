import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getEnv } from '@/lib/cloudflare';
import { getSession, SESSION_COOKIE } from '@/lib/sessionService';
import { verifyOtp } from '@/lib/otpService';

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  try {
    const sessionId = req.cookies.get(SESSION_COOKIE)?.value;
    const session = await getSession(sessionId);
    if (!session) {
      return NextResponse.json({ success: false, message: '请先登录。' }, { status: 401 });
    }

    const { code, newPassword } = (await req.json()) as { code?: string; newPassword?: string };
    if (typeof code !== 'string' || typeof newPassword !== 'string') {
      return NextResponse.json({ success: false, message: '参数不完整。' }, { status: 400 });
    }
    if (newPassword.length < 4) {
      return NextResponse.json({ success: false, message: '密码长度至少为 4 位。' }, { status: 400 });
    }

    const otpResult = await verifyOtp(session.email, 'reset_password', code);
    if (!otpResult.valid) {
      return NextResponse.json({ success: false, message: otpResult.reason }, { status: 400 });
    }

    const env = getEnv();
    const passwordHash = bcrypt.hashSync(newPassword, 8);
    await env.DB.prepare(`UPDATE users SET password_hash = ?1 WHERE id = ?2`)
      .bind(passwordHash, session.userId)
      .run();

    return NextResponse.json({ success: true, message: '密码已更新。' });
  } catch (err) {
    console.error('[password/change]', err);
    return NextResponse.json({ success: false, message: '修改密码失败，请稍后重试。' }, { status: 500 });
  }
}
