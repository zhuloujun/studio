import { NextRequest, NextResponse } from 'next/server';
import { getEnv } from '@/lib/cloudflare';
import { getSession, SESSION_COOKIE } from '@/lib/sessionService';
import { mediaR2Key, putFile } from '@/lib/r2Storage';
import { getUserUsageBytes, getDefaultQuotaBytes } from '@/lib/storageQuota';

// GET: list this user's media items with metadata only, plus a streaming
// fileUrl for each (NOT the raw bytes - loading every media file's full
// content into one JSON response was the cause of the site crashing on
// video uploads: video files are large enough to blow past memory limits
// when base64-encoded all at once. Playback should hit fileUrl directly.)
export async function GET(req: NextRequest) {
  const sessionId = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ success: false, message: '请先登录。' }, { status: 401 });
  }

  try {
    const env = getEnv();
    const { results } = await env.DB.prepare(
      `SELECT id, metadata_json, created_at FROM media_items WHERE user_id = ?1 ORDER BY created_at DESC`
    )
      .bind(session.userId)
      .all<{ id: string; metadata_json: string; created_at: number }>();

    const items = (results || []).map((row) => {
      const metadata = JSON.parse(row.metadata_json);
      return { ...metadata, id: row.id, createdAt: row.created_at, fileUrl: `/api/media/${row.id}/file` };
    });

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
    const existing = await env.DB.prepare(`SELECT user_id, size_bytes FROM media_items WHERE id = ?1`)
      .bind(metadata.id)
      .first<{ user_id: string; size_bytes: number }>();
    if (existing && existing.user_id !== session.userId) {
      return NextResponse.json({ success: false, message: '媒体 ID 冲突。' }, { status: 409 });
    }

    const [usage, quota] = await Promise.all([getUserUsageBytes(session.userId), getDefaultQuotaBytes()]);
    const projectedUsage = usage - (existing?.size_bytes || 0) + file.size;
    if (projectedUsage > quota) {
      const usageGB = (usage / (1024 * 1024 * 1024)).toFixed(2);
      const quotaGB = (quota / (1024 * 1024 * 1024)).toFixed(2);
      return NextResponse.json(
        { success: false, message: `已超出存储空间限额（已用 ${usageGB}GB / 共 ${quotaGB}GB），请先删除一些文档或媒体文件再试。` },
        { status: 413 }
      );
    }

    const r2Key = mediaR2Key(session.userId, metadata.id);
    // Pass the Blob straight through to R2 - avoids buffering the whole
    // file into Worker memory first, which is what made large EPUB/video
    // uploads fail intermittently.
    await putFile(r2Key, file, metadata.originalType);

    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO media_items (id, user_id, r2_key, metadata_json, created_at, size_bytes)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(id) DO UPDATE SET metadata_json = ?4, r2_key = ?3, size_bytes = ?6`
    )
      .bind(metadata.id, session.userId, r2Key, metadataRaw, now, file.size)
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
