import { NextRequest, NextResponse } from 'next/server';
import { getEnv } from '@/lib/cloudflare';
import { getSession, SESSION_COOKIE } from '@/lib/sessionService';
import { normalizeEmail } from '@/lib/otpService';

export async function DELETE(req: NextRequest, { params }: { params: { email: string } }) {
  const sessionId = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await getSession(sessionId);
  if (!session || !session.isAdmin) {
    return NextResponse.json({ success: false, message: '需要管理员权限。' }, { status: 403 });
  }

  const env = getEnv();
  const targetEmail = normalizeEmail(decodeURIComponent(params.email));

  if (targetEmail === normalizeEmail(env.ADMIN_EMAIL)) {
    return NextResponse.json({ success: false, message: '无法删除管理员账户。' }, { status: 400 });
  }

  await env.DB.prepare(`DELETE FROM users WHERE email = ?1 AND is_admin = 0`).bind(targetEmail).run();
  await env.DB.prepare(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = ?1)`)
    .bind(targetEmail)
    .run();

  return NextResponse.json({ success: true });
}
