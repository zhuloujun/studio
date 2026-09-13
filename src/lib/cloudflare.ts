// src/lib/cloudflare.ts
// Helper to access Cloudflare bindings (D1, R2, env vars/secrets) from
// Next.js Route Handlers running on the Cloudflare Pages edge runtime.
//
// Requires the app to be built with `@cloudflare/next-on-pages` and the
// bindings declared in wrangler.toml (see [[d1_databases]] / [[r2_buckets]]).

import { getRequestContext } from '@cloudflare/next-on-pages';

export interface CloudflareEnv {
  DB: D1Database;
  UPLOADS: R2Bucket;
  // Secret: set with `wrangler pages secret put RESEND_API_KEY`
  // or via the Cloudflare Pages dashboard -> Settings -> Environment variables (Encrypt).
  RESEND_API_KEY: string;
  // Plain vars, safe to keep in wrangler.toml [vars]
  ADMIN_EMAIL: string;
  RESEND_FROM_EMAIL: string;
}

/**
 * Wraps getRequestContext() with clearer, distinguishable error messages so
 * that a 500 response tells us exactly which piece of Cloudflare
 * configuration is missing, instead of a generic "undefined" crash.
 */
export function getEnv(): CloudflareEnv {
  let env: Partial<CloudflareEnv>;
  try {
    env = getRequestContext().env as unknown as Partial<CloudflareEnv>;
  } catch (e) {
    throw new Error(
      `CONFIG_ERROR: 无法获取 Cloudflare 运行环境 (getRequestContext 失败: ${
        e instanceof Error ? e.message : String(e)
      })。这通常说明该接口没有真正运行在 Cloudflare Pages 的 Edge Function 环境里。`
    );
  }

  if (!env.DB) {
    throw new Error('CONFIG_ERROR: 缺少 D1 数据库绑定 (变量名应为 DB)，请检查 Pages 项目 Settings -> Functions -> D1 database bindings。');
  }
  if (!env.RESEND_API_KEY) {
    throw new Error('CONFIG_ERROR: 缺少 RESEND_API_KEY 环境变量/密钥，请检查 Pages 项目 Settings -> Environment variables。');
  }
  if (!env.ADMIN_EMAIL) {
    throw new Error('CONFIG_ERROR: 缺少 ADMIN_EMAIL 环境变量。');
  }
  if (!env.RESEND_FROM_EMAIL) {
    throw new Error('CONFIG_ERROR: 缺少 RESEND_FROM_EMAIL 环境变量。');
  }

  return env as CloudflareEnv;
}
