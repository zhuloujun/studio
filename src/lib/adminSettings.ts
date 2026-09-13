// src/lib/adminSettings.ts
// Server-only. Small key-value store in D1 for admin-configurable settings
// (currently just the admin login page's URL slug).
import { getEnv } from '@/lib/cloudflare';

export const DEFAULT_ADMIN_LOGIN_SLUG =
  'i1lbklewq-6b24678_vvw019-qo0liuuu_w5sc2467-8do1yyvvye7z2nnmai17yt8b13hnhm_o01-ilylcgylbgc99';

export async function getSetting(key: string): Promise<string | null> {
  const env = getEnv();
  const row = await env.DB.prepare(`SELECT value FROM admin_settings WHERE key = ?1`).bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const env = getEnv();
  await env.DB.prepare(
    `INSERT INTO admin_settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2`
  )
    .bind(key, value)
    .run();
}

export async function getAdminLoginSlug(): Promise<string> {
  const value = await getSetting('admin_login_slug');
  return value || DEFAULT_ADMIN_LOGIN_SLUG;
}
