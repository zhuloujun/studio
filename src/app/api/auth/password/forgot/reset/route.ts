import { NextRequest, NextResponse } from 'next/server';
import { getEnv } from '@/lib/cloudflare';
import { normalizeEmail, verifyOtp } from '@/lib/otpService';
import { hashPassword } from '@/lib/passwordHash';

export async function POST(req: NextRequest) {
  try {
    const { email, code, newPassword } = (await req.json()) as { email?: string; code?: string; newPassword?: string };
    if (typeof email !== 'string' || typeof code !== 'string' || typeof newPassword !== 'string') {
      return NextResponse.json({ success: false, message: '参数不完整。' }, { status: 400 });
    }
    if (newPassword.length < 4) {
      return NextResponse.json({ success: false, message: '密码长度至少为 4 位。' }, { status: 400 });
    }

    const env = getEnv();
    const normalizedEmail = normalizeEmail(email);

    const user = await env.DB.prepare(`SELECT id FROM users WHERE email = ?1 AND is_admin = 0`)
      .bind(normalizedEmail)
      .first<{ id: string }>();

    if (!user) {
      // Don't reveal whether the account exists - just fail the OTP check generically.
      return NextResponse.json({ success: false, message: '验证码不正确或已过期。' }, { status: 400 });
    }

    const otpResult = await verifyOtp(normalizedEmail, 'reset_password', code);
    if (!otpResult.valid) {
      return NextResponse.json({ success: false, message: otpResult.reason }, { status: 400 });
    }

    const passwordHash = await hashPassword(newPassword);
    await env.DB.prepare(`UPDATE users SET password_hash = ?1 WHERE id = ?2`).bind(passwordHash, user.id).run();

    // Invalidate any existing sessions for this account for safety.
    await env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?1`).bind(user.id).run();

    return NextResponse.json({ success: true, message: '密码已重置，请使用新密码登录。' });
  } catch (err) {
    console.error('[password/forgot/reset]', err);
    return NextResponse.json(
      { success: false, message: '重置密码失败，请稍后重试。', debug: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
