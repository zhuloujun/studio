import { NextRequest, NextResponse } from 'next/server';
import { destroySession, clearSessionCookieHeader, SESSION_COOKIE } from '@/lib/sessionService';

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  const sessionId = req.cookies.get(SESSION_COOKIE)?.value;
  await destroySession(sessionId);
  const res = NextResponse.json({ success: true });
  res.headers.set('Set-Cookie', clearSessionCookieHeader());
  return res;
}
