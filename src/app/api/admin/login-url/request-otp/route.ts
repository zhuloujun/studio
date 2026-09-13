import { NextRequest, NextResponse } from 'next/server';
import { getSession, SESSION_COOKIE } from '@/lib/sessionService';
import { requestOtp, OtpCooldownError } from '@/lib/otpService';

export async function POST(req: NextRequest) {
  const sessionId = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await getSession(sessionId);
  if (!session || !session.isAdmin) {
    return NextResponse.json({ success: false, message: '需要管理员权限。' }, { status: 403 });
  }

  try {
    await requestOtp(session.email, 'change_admin_login_url');
    return NextResponse.json({ success: true, message: '验证码已发送，请查收邮箱。' });
  } catch (err) {
    if (err instanceof OtpCooldownError) {
      return NextResponse.json({ success: false, message: err.message }, { status: 429 });
    }
    console.error('[admin/login-url/request-otp]', err);
    return NextResponse.json(
      { success: false, message: '发送验证码失败，请稍后重试。', debug: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
