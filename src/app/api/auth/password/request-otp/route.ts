import { NextRequest, NextResponse } from 'next/server';
import { getSession, SESSION_COOKIE } from '@/lib/sessionService';
import { requestOtp, OtpCooldownError } from '@/lib/otpService';

export const runtime = 'edge';

// Requires an active session (regular user or admin). The email is taken from
// the session, never from the request body, so a user can't request a code
// for someone else's inbox.
export async function POST(req: NextRequest) {
  try {
    const sessionId = req.cookies.get(SESSION_COOKIE)?.value;
    const session = await getSession(sessionId);
    if (!session) {
      return NextResponse.json({ success: false, message: '请先登录。' }, { status: 401 });
    }

    await requestOtp(session.email, 'reset_password');
    return NextResponse.json({ success: true, message: '验证码已发送，请查收邮箱。' });
  } catch (err) {
    if (err instanceof OtpCooldownError) {
      return NextResponse.json({ success: false, message: err.message }, { status: 429 });
    }
    console.error('[password/request-otp]', err);
    return NextResponse.json(
      { success: false, message: '发送验证码失败，请稍后重试。', debug: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
