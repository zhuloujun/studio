import { NextRequest, NextResponse } from 'next/server';
import { getEnv } from '@/lib/cloudflare';
import { getSession, SESSION_COOKIE } from '@/lib/sessionService';
import { deleteFile } from '@/lib/r2Storage';

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const sessionId = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ success: false, message: '请先登录。' }, { status: 401 });
  }

  try {
    const env = getEnv();
    const row = await env.DB.prepare(`SELECT user_id, r2_key FROM media_items WHERE id = ?1`)
      .bind(params.id)
      .first<{ user_id: string; r2_key: string }>();

    if (!row || row.user_id !== session.userId) {
      return NextResponse.json({ success: false, message: '媒体不存在。' }, { status: 404 });
    }

    await deleteFile(row.r2_key);
    await env.DB.prepare(`DELETE FROM media_items WHERE id = ?1`).bind(params.id).run();

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[media/:id DELETE]', err);
    return NextResponse.json(
      { success: false, message: '删除媒体失败。', debug: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
