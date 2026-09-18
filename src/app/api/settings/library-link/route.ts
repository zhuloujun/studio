import { NextRequest, NextResponse } from 'next/server';
import { getSession, SESSION_COOKIE } from '@/lib/sessionService';
import { getSetting } from '@/lib/adminSettings';

export interface LibraryLink {
  url: string;
  label: string;
}

export async function GET(req: NextRequest) {
  const sessionId = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ success: false, message: '请先登录。' }, { status: 401 });
  }

  try {
    const raw = await getSetting('external_library_links');
    let links: LibraryLink[] = [];
    if (raw) {
      try {
        links = JSON.parse(raw);
      } catch {
        links = [];
      }
    }
    return NextResponse.json({ success: true, links });
  } catch (err) {
    console.error('[settings/library-link GET]', err);
    return NextResponse.json({ success: false, message: '获取失败。' }, { status: 500 });
  }
}
