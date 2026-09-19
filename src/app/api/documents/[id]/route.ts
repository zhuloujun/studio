import { NextRequest, NextResponse } from 'next/server';
import { getEnv } from '@/lib/cloudflare';
import { getSession, SESSION_COOKIE } from '@/lib/sessionService';
import { deleteFile } from '@/lib/r2Storage';

// Returns metadata + a streaming fileUrl - NOT the file bytes themselves.
// (Previously this base64-encoded the whole file into the JSON response,
// which could exceed Worker memory/resource limits for large PDFs/ebooks -
// see /api/documents/[id]/file for why that was replaced.)
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const sessionId = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ success: false, message: '请先登录。' }, { status: 401 });
  }

  try {
    const env = getEnv();
    const row = await env.DB.prepare(`SELECT user_id, metadata_json, created_at FROM documents WHERE id = ?1`)
      .bind(params.id)
      .first<{ user_id: string; metadata_json: string; created_at: number }>();

    if (!row || row.user_id !== session.userId) {
      return NextResponse.json({ success: false, message: '文档不存在。' }, { status: 404 });
    }

    const metadata = JSON.parse(row.metadata_json);
    return NextResponse.json({
      success: true,
      document: {
        ...metadata,
        id: params.id,
        createdAt: row.created_at,
        fileUrl: `/api/documents/${params.id}/file`,
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

// PATCH: update only metadata fields (annotations, ocrTextPerPage,
// extractedText, etc.) without touching the file in R2. The old approach
// re-uploaded the *entire file* through /api/documents' POST for even a
// single note or a few edited words in the TTS box - fine for a small text
// file, but for a large PDF/ebook that's a slow multipart upload on every
// edit, and more likely to silently fail or time out on a flaky connection
// (which is exactly what made cross-device sync of notes/edits look broken
// for real library documents). This endpoint only ever touches the D1 row's
// metadata_json, so saving a note is a small, fast, reliable JSON PATCH
// regardless of how large the underlying file is.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const sessionId = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ success: false, message: '请先登录。' }, { status: 401 });
  }

  try {
    const env = getEnv();
    const row = await env.DB.prepare(`SELECT user_id, metadata_json FROM documents WHERE id = ?1`)
      .bind(params.id)
      .first<{ user_id: string; metadata_json: string }>();

    if (!row || row.user_id !== session.userId) {
      return NextResponse.json({ success: false, message: '文档不存在。' }, { status: 404 });
    }

    const patch = (await req.json()) as Record<string, unknown>;
    const merged = { ...JSON.parse(row.metadata_json), ...patch };
    await env.DB.prepare(`UPDATE documents SET metadata_json = ?1 WHERE id = ?2`)
      .bind(JSON.stringify(merged), params.id)
      .run();

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[documents/:id PATCH]', err);
    return NextResponse.json(
      { success: false, message: '保存失败。', debug: err instanceof Error ? err.message : String(err) },
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
