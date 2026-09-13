import { NextRequest, NextResponse } from 'next/server';
import { getAdminLoginSlug } from '@/lib/adminSettings';

export async function GET(req: NextRequest) {
  try {
    const slug = req.nextUrl.searchParams.get('slug') || '';
    const currentSlug = await getAdminLoginSlug();
    return NextResponse.json({ valid: slug.length > 0 && slug === currentSlug });
  } catch (err) {
    console.error('[auth/admin/check-login-slug]', err);
    return NextResponse.json({ valid: false });
  }
}
