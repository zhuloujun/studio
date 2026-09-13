// src/lib/r2Storage.ts
// Server-only helpers for storing user document/media file bytes in R2,
// with metadata (everything except the raw bytes) kept in D1 for fast listing.
import { getEnv } from '@/lib/cloudflare';

export function sanitizeIdSegment(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function documentR2Key(userId: string, docId: string): string {
  return `documents/${sanitizeIdSegment(userId)}/${sanitizeIdSegment(docId)}`;
}

export function mediaR2Key(userId: string, mediaId: string): string {
  return `media/${sanitizeIdSegment(userId)}/${sanitizeIdSegment(mediaId)}`;
}

export async function putFile(key: string, body: ArrayBuffer, contentType?: string): Promise<void> {
  const env = getEnv();
  await env.UPLOADS.put(key, body, {
    httpMetadata: contentType ? { contentType } : undefined,
  });
}

export async function getFile(key: string): Promise<ArrayBuffer | null> {
  const env = getEnv();
  const obj = await env.UPLOADS.get(key);
  if (!obj) return null;
  return obj.arrayBuffer();
}

export async function deleteFile(key: string): Promise<void> {
  const env = getEnv();
  await env.UPLOADS.delete(key);
}

/** Deletes every R2 object under a given prefix (e.g. all of one user's documents). */
export async function deletePrefix(prefix: string): Promise<void> {
  const env = getEnv();
  let cursor: string | undefined;
  do {
    const listed = await env.UPLOADS.list({ prefix, cursor });
    if (listed.objects.length > 0) {
      await Promise.all(listed.objects.map((o) => env.UPLOADS.delete(o.key)));
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

// --- base64 helpers (edge-safe, no Buffer dependency) ---

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
