import { NextRequest, NextResponse } from 'next/server';
import { getSession, SESSION_COOKIE } from '@/lib/sessionService';
import { getSetting, setSetting } from '@/lib/adminSettings';
import { verifyOtp } from '@/lib/otpService';
import type { LibraryLink } from '@/app/api/settings/library-link/route';

export async function GET(req: NextRequest) {
  const sessionId = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await getSession(sessionId);
  if (!session || !session.isAdmin) {
    return NextResponse.json({ success: false, message: '需要管理员权限。' }, { status: 403 });
  }

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
}

export async function POST(req: NextRequest) {
  const sessionId = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await getSession(sessionId);
  if (!session || !session.isAdmin) {
    return NextResponse.json({ success: false, message: '需要管理员权限。' }, { status: 403 });
  }

  try {
    const { links, code } = (await req.json()) as { links?: LibraryLink[]; code?: string };
    if (typeof code !== 'string') {
      return NextResponse.json({ success: false, message: '请输入验证码。' }, { status: 400 });
    }
    const otpResult = await verifyOtp(session.email, 'admin_settings_change', code);
    if (!otpResult.valid) {
      return NextResponse.json({ success: false, message: otpResult.reason }, { status: 400 });
    }
    if (!Array.isArray(links)) {
      return NextResponse.json({ success: false, message: '参数格式不正确。' }, { status: 400 });
    }

    const cleaned: LibraryLink[] = [];
    for (const link of links) {
      const url = (link.url || '').trim();
      const label = (link.label || '').trim();
      if (!url) continue; // skip empty rows silently rather than rejecting the whole save
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
          return NextResponse.json({ success: false, message: `链接必须是 http(s) 地址：${url}` }, { status: 400 });
        }
      } catch {
        return NextResponse.json({ success: false, message: `链接格式不正确：${url}` }, { status: 400 });
      }
      cleaned.push({ url, label: label || '文献库' });
    }

    await setSetting('external_library_links', JSON.stringify(cleaned));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[admin/library-link POST]', err);
    return NextResponse.json(
      { success: false, message: '保存失败。', debug: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
