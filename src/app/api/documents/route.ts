import { NextRequest, NextResponse } from 'next/server';
import { getEnv } from '@/lib/cloudflare';
import { getSession, SESSION_COOKIE } from '@/lib/sessionService';
import { documentR2Key, putFile } from '@/lib/r2Storage';

// GET: list this user's documents (metadata only - no file bytes, keeps the
// response small even with many/large documents).
export async function GET(req: NextRequest) {
  const sessionId = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ success: false, message: '请先登录。' }, { status: 401 });
  }

  try {
    const env = getEnv();
    const { results } = await env.DB.prepare(
      `SELECT id, metadata_json, created_at FROM documents WHERE user_id = ?1 ORDER BY created_at DESC`
    )
      .bind(session.userId)
      .all<{ id: string; metadata_json: string; created_at: number }>();

    const documents = (results || []).map((row) => {
      const metadata = JSON.parse(row.metadata_json);
      return { ...metadata, id: row.id, createdAt: row.created_at };
    });

    return NextResponse.json({ success: true, documents });
  } catch (err) {
    console.error('[documents GET]', err);
    return NextResponse.json(
      { success: false, message: '获取文档列表失败。', debug: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

// POST: create or fully replace a document. Expects multipart/form-data with:
//  - "metadata": JSON string of everything except fileData (id, title, type, originalType, createdAt, annotations, ...)
//  - "file": the raw file bytes (Blob)
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

    const metadata = JSON.parse(metadataRaw) as { id?: string; title?: string; originalType?: string };
    if (!metadata.id) {
      return NextResponse.json({ success: false, message: '缺少文档 ID。' }, { status: 400 });
    }

    const env = getEnv();

    // If a document with this id already exists, it must belong to this user.
    const existing = await env.DB.prepare(`SELECT user_id FROM documents WHERE id = ?1`)
      .bind(metadata.id)
      .first<{ user_id: string }>();
    if (existing && existing.user_id !== session.userId) {
      return NextResponse.json({ success: false, message: '文档 ID 冲突。' }, { status: 409 });
    }

    const r2Key = documentR2Key(session.userId, metadata.id);

    // Pass the Blob straight through to R2 - avoids buffering the whole
    // file into Worker memory first, which is what made large EPUB/video
    // uploads fail intermittently.
    await putFile(r2Key, file, metadata.originalType);

    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO documents (id, user_id, r2_key, metadata_json, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(id) DO UPDATE SET metadata_json = ?4, r2_key = ?3`
    )
      .bind(metadata.id, session.userId, r2Key, metadataRaw, now)
      .run();

    return NextResponse.json({ success: true, id: metadata.id });
  } catch (err) {
    console.error('[documents POST]', err);
    return NextResponse.json(
      { success: false, message: '保存文档失败。', debug: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
