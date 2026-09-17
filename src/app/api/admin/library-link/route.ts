import { NextRequest, NextResponse } from 'next/server';
import { getSession, SESSION_COOKIE } from '@/lib/sessionService';
import { getSetting, setSetting } from '@/lib/adminSettings';

export async function GET(req: NextRequest) {
  const sessionId = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await getSession(sessionId);
  if (!session || !session.isAdmin) {
    return NextResponse.json({ success: false, message: '需要管理员权限。' }, { status: 403 });
  }

  const [url, label] = await Promise.all([
    getSetting('external_library_link_url'),
    getSetting('external_library_link_label'),
  ]);
  return NextResponse.json({ success: true, url: url || '', label: label || '' });
}

export async function POST(req: NextRequest) {
  const sessionId = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await getSession(sessionId);
  if (!session || !session.isAdmin) {
    return NextResponse.json({ success: false, message: '需要管理员权限。' }, { status: 403 });
  }

  try {
    const { url, label } = (await req.json()) as { url?: string; label?: string };
    const trimmedUrl = (url || '').trim();

    if (trimmedUrl) {
      try {
        const parsed = new URL(trimmedUrl);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
          return NextResponse.json({ success: false, message: '链接必须是 http(s) 地址。' }, { status: 400 });
        }
      } catch {
        return NextResponse.json({ success: false, message: '链接格式不正确。' }, { status: 400 });
      }
    }

    await setSetting('external_library_link_url', trimmedUrl);
    await setSetting('external_library_link_label', (label || '').trim());

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[admin/library-link POST]', err);
    return NextResponse.json(
      { success: false, message: '保存失败。', debug: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
