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

export function getEnv(): CloudflareEnv {
  return getRequestContext().env as unknown as CloudflareEnv;
}
