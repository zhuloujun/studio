import { NextRequest, NextResponse } from 'next/server';
import { getEnv } from '@/lib/cloudflare';
import { getSession, SESSION_COOKIE } from '@/lib/sessionService';
import { normalizeEmail } from '@/lib/otpService';
import { verifyOtp } from '@/lib/otpService';
import { deletePrefix } from '@/lib/r2Storage';

export async function DELETE(req: NextRequest, { params }: { params: { email: string } }) {
  const sessionId = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await getSession(sessionId);
  if (!session || !session.isAdmin) {
    return NextResponse.json({ success: false, message: '需要管理员权限。' }, { status: 403 });
  }

  const code = req.nextUrl.searchParams.get('code');
  if (typeof code !== 'string') {
    return NextResponse.json({ success: false, message: '请输入验证码。' }, { status: 400 });
  }
  const otpResult = await verifyOtp(session.email, 'admin_settings_change', code);
  if (!otpResult.valid) {
    return NextResponse.json({ success: false, message: otpResult.reason }, { status: 400 });
  }

  try {
    const env = getEnv();
    const targetEmail = normalizeEmail(decodeURIComponent(params.email));

    if (targetEmail === normalizeEmail(env.ADMIN_EMAIL)) {
      return NextResponse.json({ success: false, message: '无法删除管理员账户。' }, { status: 400 });
    }

    const user = await env.DB.prepare(`SELECT id FROM users WHERE email = ?1 AND is_admin = 0`)
      .bind(targetEmail)
      .first<{ id: string }>();

    if (user) {
      // Purge this user's R2-stored documents and media, plus their D1 metadata rows.
      await deletePrefix(`documents/${user.id}`);
      await deletePrefix(`media/${user.id}`);
      await env.DB.prepare(`DELETE FROM documents WHERE user_id = ?1`).bind(user.id).run();
      await env.DB.prepare(`DELETE FROM media_items WHERE user_id = ?1`).bind(user.id).run();
      await env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?1`).bind(user.id).run();
      await env.DB.prepare(`DELETE FROM users WHERE id = ?1`).bind(user.id).run();
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[admin/users/:email DELETE]', err);
    return NextResponse.json(
      { success: false, message: '删除用户失败。', debug: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
