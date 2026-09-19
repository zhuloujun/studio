import { NextRequest, NextResponse } from 'next/server';
import { getEnv } from '@/lib/cloudflare';
import { getSession, SESSION_COOKIE } from '@/lib/sessionService';
import type { FavoriteItem } from '@/types';

// Text-snippet favorites ("☆收藏"), stored in D1 keyed by user so they sync
// across devices - this used to live in localStorage only, which is why it
// never showed up on a second device/browser.

export async function GET(req: NextRequest) {
  const sessionId = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ success: false, message: '请先登录。' }, { status: 401 });
  }

  try {
    const env = getEnv();
    const { results } = await env.DB.prepare(
      `SELECT item_json FROM favorite_items WHERE user_id = ?1 ORDER BY created_at DESC`
    )
      .bind(session.userId)
      .all<{ item_json: string }>();

    const items: FavoriteItem[] = (results || []).map((row) => JSON.parse(row.item_json));
    return NextResponse.json({ success: true, items });
  } catch (err) {
    console.error('[favorites GET]', err);
    return NextResponse.json(
      { success: false, message: '获取收藏列表失败。', debug: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const sessionId = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ success: false, message: '请先登录。' }, { status: 401 });
  }

  try {
    const item = (await req.json()) as FavoriteItem;
    if (!item?.id || typeof item.text !== 'string') {
      return NextResponse.json({ success: false, message: '参数不完整。' }, { status: 400 });
    }

    const env = getEnv();
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO favorite_items (id, user_id, item_json, created_at)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(id) DO UPDATE SET item_json = ?3`
    )
      .bind(item.id, session.userId, JSON.stringify(item), item.createdAt || now)
      .run();

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[favorites POST]', err);
    return NextResponse.json(
      { success: false, message: '保存收藏失败。', debug: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const sessionId = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ success: false, message: '请先登录。' }, { status: 401 });
  }

  const id = req.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ success: false, message: '缺少收藏 ID。' }, { status: 400 });
  }

  try {
    const env = getEnv();
    await env.DB.prepare(`DELETE FROM favorite_items WHERE id = ?1 AND user_id = ?2`)
      .bind(id, session.userId)
      .run();
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[favorites DELETE]', err);
    return NextResponse.json(
      { success: false, message: '删除收藏失败。', debug: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
