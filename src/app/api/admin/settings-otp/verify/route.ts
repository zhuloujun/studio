import { NextRequest, NextResponse } from 'next/server';
import { getSession, SESSION_COOKIE } from '@/lib/sessionService';
import { verifyOtp } from '@/lib/otpService';
import { issueVerificationToken } from '@/lib/adminSettingsVerification';

export async function POST(req: NextRequest) {
  const sessionId = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await getSession(sessionId);
  if (!session || !session.isAdmin) {
    return NextResponse.json({ success: false, message: '需要管理员权限。' }, { status: 403 });
  }

  try {
    const { code } = (await req.json()) as { code?: string };
    if (!code) {
      return NextResponse.json({ success: false, message: '请输入验证码。' }, { status: 400 });
    }

    const result = await verifyOtp(session.email, 'admin_settings_change', code);
    if (!result.valid) {
      return NextResponse.json({ success: false, message: result.reason || '验证码不正确。' }, { status: 400 });
    }

    const token = await issueVerificationToken();
    return NextResponse.json({ success: true, token });
  } catch (err) {
    console.error('[admin/settings-otp/verify]', err);
    return NextResponse.json(
      { success: false, message: '验证失败，请稍后重试。', debug: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
