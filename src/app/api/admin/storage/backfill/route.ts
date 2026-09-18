import { NextRequest, NextResponse } from 'next/server';
import { getEnv } from '@/lib/cloudflare';
import { getSession, SESSION_COOKIE } from '@/lib/sessionService';

// documents/media_items rows created before the size_bytes column existed
// all default to 0 - which is why "存储用量" can show 0.00GB for an account
// that genuinely has files. This looks up each such row's real size from R2
// (env.UPLOADS.head) and fills it in. Safe to run more than once - rows that
// already have a nonzero size are skipped.
export async function POST(req: NextRequest) {
  const sessionId = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await getSession(sessionId);
  if (!session || !session.isAdmin) {
    return NextResponse.json({ success: false, message: '需要管理员权限。' }, { status: 403 });
  }

  try {
    const env = getEnv();
    let updated = 0;
    let missing = 0;

    for (const table of ['documents', 'media_items'] as const) {
      const { results } = await env.DB.prepare(`SELECT id, r2_key FROM ${table} WHERE size_bytes = 0`).all<{
        id: string;
        r2_key: string;
      }>();

      for (const row of results || []) {
        const head = await env.UPLOADS.head(row.r2_key);
        if (!head) {
          missing++;
          continue;
        }
        await env.DB.prepare(`UPDATE ${table} SET size_bytes = ?1 WHERE id = ?2`).bind(head.size, row.id).run();
        updated++;
      }
    }

    return NextResponse.json({ success: true, updated, missing });
  } catch (err) {
    console.error('[admin/storage/backfill]', err);
    return NextResponse.json(
      { success: false, message: '回填失败。', debug: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
