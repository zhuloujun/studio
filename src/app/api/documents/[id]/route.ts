import { NextRequest, NextResponse } from 'next/server';
import { getEnv } from '@/lib/cloudflare';
import { getSession, SESSION_COOKIE } from '@/lib/sessionService';
import { getFile, deleteFile, arrayBufferToBase64 } from '@/lib/r2Storage';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const sessionId = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ success: false, message: '请先登录。' }, { status: 401 });
  }

  try {
    const env = getEnv();
    const row = await env.DB.prepare(`SELECT user_id, r2_key, metadata_json, created_at FROM documents WHERE id = ?1`)
      .bind(params.id)
      .first<{ user_id: string; r2_key: string; metadata_json: string; created_at: number }>();

    if (!row || row.user_id !== session.userId) {
      return NextResponse.json({ success: false, message: '文档不存在。' }, { status: 404 });
    }

    const fileBuffer = await getFile(row.r2_key);
    if (!fileBuffer) {
      return NextResponse.json({ success: false, message: '文件内容丢失。' }, { status: 404 });
    }

    const metadata = JSON.parse(row.metadata_json);
    return NextResponse.json({
      success: true,
      document: {
        ...metadata,
        id: params.id,
        createdAt: row.created_at,
        fileDataBase64: arrayBufferToBase64(fileBuffer),
      },
    });
  } catch (err) {
    console.error('[documents/:id GET]', err);
    return NextResponse.json(
      { success: false, message: '获取文档失败。', debug: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const sessionId = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ success: false, message: '请先登录。' }, { status: 401 });
  }

  try {
    const env = getEnv();
    const row = await env.DB.prepare(`SELECT user_id, r2_key FROM documents WHERE id = ?1`)
      .bind(params.id)
      .first<{ user_id: string; r2_key: string }>();

    if (!row || row.user_id !== session.userId) {
      return NextResponse.json({ success: false, message: '文档不存在。' }, { status: 404 });
    }

    await deleteFile(row.r2_key);
    await env.DB.prepare(`DELETE FROM documents WHERE id = ?1`).bind(params.id).run();

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[documents/:id DELETE]', err);
    return NextResponse.json(
      { success: false, message: '删除文档失败。', debug: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
