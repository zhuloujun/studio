import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/cloudflare';
import { requestOtp, OtpCooldownError } from '@/lib/otpService';

// No email/password needed in the body - there is exactly one admin account,
// identified by the fixed ADMIN_EMAIL env var. This is the same trust model
// as regular users' "forgot password": knowing/controlling that inbox is
// what proves it's really the admin.
export async function POST() {
  try {
    const env = getEnv();
    await requestOtp(env.ADMIN_EMAIL, 'admin_reset_password');
    return NextResponse.json({ success: true, message: '验证码已发送至管理员邮箱。' });
  } catch (err) {
    if (err instanceof OtpCooldownError) {
      return NextResponse.json({ success: false, message: err.message }, { status: 429 });
    }
    console.error('[auth/admin/forgot/request-otp]', err);
    return NextResponse.json(
      { success: false, message: '发送验证码失败，请稍后重试。', debug: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
