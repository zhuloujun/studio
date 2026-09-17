import { NextRequest, NextResponse } from 'next/server';
import { getSession, SESSION_COOKIE } from '@/lib/sessionService';
import { getSetting } from '@/lib/adminSettings';

export async function GET(req: NextRequest) {
  const sessionId = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ success: false, message: '请先登录。' }, { status: 401 });
  }

  try {
    const [url, label] = await Promise.all([
      getSetting('external_library_link_url'),
      getSetting('external_library_link_label'),
    ]);
    if (!url) {
      return NextResponse.json({ success: true, link: null });
    }
    return NextResponse.json({ success: true, link: { url, label: label || '文献库' } });
  } catch (err) {
    console.error('[settings/library-link GET]', err);
    return NextResponse.json({ success: false, message: '获取失败。' }, { status: 500 });
  }
}
