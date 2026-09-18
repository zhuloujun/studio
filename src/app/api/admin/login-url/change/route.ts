import { NextRequest, NextResponse } from 'next/server';
import { getSession, SESSION_COOKIE } from '@/lib/sessionService';
import { isVerificationTokenValid } from '@/lib/adminSettingsVerification';
import { setSetting } from '@/lib/adminSettings';

const SLUG_RE = /^[a-zA-Z0-9_-]{12,120}$/;

export async function POST(req: NextRequest) {
  const sessionId = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await getSession(sessionId);
  if (!session || !session.isAdmin) {
    return NextResponse.json({ success: false, message: '需要管理员权限。' }, { status: 403 });
  }

  try {
    const { verificationToken, newSlug } = (await req.json()) as { verificationToken?: string; newSlug?: string };
    if (typeof newSlug !== 'string') {
      return NextResponse.json({ success: false, message: '参数不完整。' }, { status: 400 });
    }
    if (!(await isVerificationTokenValid(verificationToken))) {
      return NextResponse.json({ success: false, message: '请先完成邮箱验证码验证，再修改设置。' }, { status: 403 });
    }

    const trimmedSlug = newSlug.trim();
    if (!SLUG_RE.test(trimmedSlug)) {
      return NextResponse.json(
        { success: false, message: '登录地址只能包含字母、数字、下划线和短横线，长度需在 12-120 位之间。' },
        { status: 400 }
      );
    }

    await setSetting('admin_login_slug', trimmedSlug);
    return NextResponse.json({ success: true, message: '登录地址已更新。', slug: trimmedSlug, path: `/login/${trimmedSlug}` });
  } catch (err) {
    console.error('[admin/login-url/change]', err);
    return NextResponse.json(
      { success: false, message: '修改登录地址失败。', debug: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
