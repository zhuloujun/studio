import { NextRequest, NextResponse } from 'next/server';
import { getEnv } from '@/lib/cloudflare';
import { getSession, SESSION_COOKIE } from '@/lib/sessionService';
import type { NoteFavoriteItem } from '@/types';

// Note/annotation favorites ("笔记"), stored in D1 keyed by user so they
// sync across devices - previously localStorage only, same issue as the
// text-snippet favorites in /api/favorites.

export async function GET(req: NextRequest) {
  const sessionId = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ success: false, message: '请先登录。' }, { status: 401 });
  }

  try {
    const env = getEnv();
    const { results } = await env.DB.prepare(
      `SELECT item_json FROM note_favorites WHERE user_id = ?1 ORDER BY created_at DESC`
    )
      .bind(session.userId)
      .all<{ item_json: string }>();

    const items: NoteFavoriteItem[] = (results || []).map((row) => JSON.parse(row.item_json));
    return NextResponse.json({ success: true, items });
  } catch (err) {
    console.error('[notes-favorites GET]', err);
    return NextResponse.json(
      { success: false, message: '获取笔记收藏列表失败。', debug: err instanceof Error ? err.message : String(err) },
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
    const item = (await req.json()) as NoteFavoriteItem;
    if (!item?.id || !item.annotation) {
      return NextResponse.json({ success: false, message: '参数不完整。' }, { status: 400 });
    }

    const env = getEnv();
    const now = Date.now();
    // Mirrors the old saveNoteFavorite() behavior: don't clobber an existing
    // favorite with the same annotation id.
    const existing = await env.DB.prepare(`SELECT id FROM note_favorites WHERE id = ?1 AND user_id = ?2`)
      .bind(item.id, session.userId)
      .first();
    if (existing) {
      return NextResponse.json({ success: true });
    }

    await env.DB.prepare(
      `INSERT INTO note_favorites (id, user_id, item_json, created_at) VALUES (?1, ?2, ?3, ?4)`
    )
      .bind(item.id, session.userId, JSON.stringify(item), item.favoritedAt || now)
      .run();

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[notes-favorites POST]', err);
    return NextResponse.json(
      { success: false, message: '保存笔记收藏失败。', debug: err instanceof Error ? err.message : String(err) },
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
    return NextResponse.json({ success: false, message: '缺少笔记收藏 ID。' }, { status: 400 });
  }

  try {
    const env = getEnv();
    await env.DB.prepare(`DELETE FROM note_favorites WHERE id = ?1 AND user_id = ?2`)
      .bind(id, session.userId)
      .run();
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[notes-favorites DELETE]', err);
    return NextResponse.json(
      { success: false, message: '删除笔记收藏失败。', debug: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
