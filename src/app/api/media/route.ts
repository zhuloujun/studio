import { NextRequest, NextResponse } from 'next/server';
import { getEnv } from '@/lib/cloudflare';
import { getSession, SESSION_COOKIE } from '@/lib/sessionService';
import { mediaR2Key, putFile, getFile, arrayBufferToBase64 } from '@/lib/r2Storage';

// GET: list this user's media items, INCLUDING file bytes (base64) - mirrors
// the previous IndexedDB behaviour of loading everything at once. For very
// large media libraries this could be optimized to lazy-load file bytes only
// when a specific item is played, but that would require also changing the
// media page's consuming code.
export async function GET(req: NextRequest) {
  const sessionId = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ success: false, message: '请先登录。' }, { status: 401 });
  }

  try {
    const env = getEnv();
    const { results } = await env.DB.prepare(
      `SELECT id, r2_key, metadata_json, created_at FROM media_items WHERE user_id = ?1 ORDER BY created_at DESC`
    )
      .bind(session.userId)
      .all<{ id: string; r2_key: string; metadata_json: string; created_at: number }>();

    const items = await Promise.all(
      (results || []).map(async (row) => {
        const metadata = JSON.parse(row.metadata_json);
        const fileBuffer = await getFile(row.r2_key);
        return {
          ...metadata,
          id: row.id,
          createdAt: row.created_at,
          fileDataBase64: fileBuffer ? arrayBufferToBase64(fileBuffer) : null,
        };
      })
    );

    return NextResponse.json({ success: true, items });
  } catch (err) {
    console.error('[media GET]', err);
    return NextResponse.json(
      { success: false, message: '获取媒体列表失败。', debug: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

// POST: create a media item. multipart/form-data with "metadata" (JSON, minus
// fileData) and "file" (Blob).
export async function POST(req: NextRequest) {
  const sessionId = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ success: false, message: '请先登录。' }, { status: 401 });
  }

  try {
    const form = await req.formData();
    const metadataRaw = form.get('metadata');
    const file = form.get('file');

    if (typeof metadataRaw !== 'string' || !(file instanceof Blob)) {
      return NextResponse.json({ success: false, message: '参数不完整。' }, { status: 400 });
    }

    const metadata = JSON.parse(metadataRaw) as { id?: string; originalType?: string };
    if (!metadata.id) {
      return NextResponse.json({ success: false, message: '缺少媒体 ID。' }, { status: 400 });
    }

    const env = getEnv();
    const existing = await env.DB.prepare(`SELECT user_id FROM media_items WHERE id = ?1`)
      .bind(metadata.id)
      .first<{ user_id: string }>();
    if (existing && existing.user_id !== session.userId) {
      return NextResponse.json({ success: false, message: '媒体 ID 冲突。' }, { status: 409 });
    }

    const r2Key = mediaR2Key(session.userId, metadata.id);
    const fileBuffer = await file.arrayBuffer();
    await putFile(r2Key, fileBuffer, metadata.originalType);

    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO media_items (id, user_id, r2_key, metadata_json, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(id) DO UPDATE SET metadata_json = ?4, r2_key = ?3`
    )
      .bind(metadata.id, session.userId, r2Key, metadataRaw, now)
      .run();

    return NextResponse.json({ success: true, id: metadata.id });
  } catch (err) {
    console.error('[media POST]', err);
    return NextResponse.json(
      { success: false, message: '保存媒体失败。', debug: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
