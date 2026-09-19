import { NextRequest, NextResponse } from 'next/server';
import { getEnv } from '@/lib/cloudflare';
import { getSession, SESSION_COOKIE } from '@/lib/sessionService';

// Lightweight cross-device sync for documents opened from "search external
// literature" (arxiv-/gutenberg-/etc. ids - see ephemeralDocumentStore.ts).
// Those documents' file bytes are intentionally never uploaded to our own
// storage, but the notes/annotations and TTS-box text edits a user makes
// while reading one are small and worth syncing on their own, keyed by the
// same deterministic search-result id so re-opening the same paper on
// another device can pick them back up.

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sessionId = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ success: false, message: '请先登录。' }, { status: 401 });
  }
  try {
    const env = getEnv();
    const row = await env.DB.prepare(
      `SELECT state_json FROM ephemeral_doc_state WHERE id = ?1 AND user_id = ?2`
    ).bind(id, session.userId).first<{ state_json: string }>();
    if (!row) {
      return NextResponse.json({ success: true, state: null });
    }
    return NextResponse.json({ success: true, state: JSON.parse(row.state_json) });
  } catch (err: any) {
    return NextResponse.json({ success: false, message: err?.message || '获取失败。' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sessionId = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ success: false, message: '请先登录。' }, { status: 401 });
  }
  try {
    const state = await req.json();
    const env = getEnv();
    await env.DB.prepare(
      `INSERT INTO ephemeral_doc_state (id, user_id, state_json, updated_at)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(id, user_id) DO UPDATE SET state_json = ?3, updated_at = ?4`
    ).bind(id, session.userId, JSON.stringify(state ?? {}), Date.now()).run();
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ success: false, message: err?.message || '保存失败。' }, { status: 500 });
  }
}
