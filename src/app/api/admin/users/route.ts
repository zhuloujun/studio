import { NextRequest, NextResponse } from 'next/server';
import { getEnv } from '@/lib/cloudflare';
import { getSession, SESSION_COOKIE } from '@/lib/sessionService';

export async function GET(req: NextRequest) {
  const sessionId = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await getSession(sessionId);
  if (!session || !session.isAdmin) {
    return NextResponse.json({ success: false, message: '需要管理员权限。' }, { status: 403 });
  }

  const env = getEnv();
  const { results } = await env.DB.prepare(
    `SELECT email FROM users WHERE is_admin = 0 ORDER BY created_at DESC`
  ).all<{ email: string }>();

  return NextResponse.json({ success: true, users: results });
}
