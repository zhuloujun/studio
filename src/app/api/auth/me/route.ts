import { NextRequest, NextResponse } from 'next/server';
import { getSession, SESSION_COOKIE } from '@/lib/sessionService';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  const sessionId = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ user: null, isAdmin: false });
  }
  return NextResponse.json({ user: { email: session.email }, isAdmin: session.isAdmin });
}
