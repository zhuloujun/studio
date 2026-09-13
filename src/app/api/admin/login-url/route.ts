import { NextRequest, NextResponse } from 'next/server';
import { getSession, SESSION_COOKIE } from '@/lib/sessionService';
import { getAdminLoginSlug } from '@/lib/adminSettings';

export async function GET(req: NextRequest) {
  const sessionId = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await getSession(sessionId);
  if (!session || !session.isAdmin) {
    return NextResponse.json({ success: false, message: '需要管理员权限。' }, { status: 403 });
  }

  try {
    const slug = await getAdminLoginSlug();
    return NextResponse.json({ success: true, slug, path: `/login/${slug}` });
  } catch (err) {
    console.error('[admin/login-url GET]', err);
    return NextResponse.json(
      { success: false, message: '获取登录地址失败。', debug: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
