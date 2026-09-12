/**
 * セッショントークンの生成・検証ロジック。
 * middleware.ts（Edge runtime）と auth.ts（Server Action）の両方から使うため、
 * 'use server' を付けない通常モジュールとして分離している。
 */
export const SESSION_COOKIE_NAME = 'shift_session';

/** Web Crypto（Node/Edge両ランタイムで利用可能）で ADMIN_PASSWORD から決定的にトークンを導出する */
export async function computeSessionToken(): Promise<string> {
  const password = process.env.ADMIN_PASSWORD ?? '';
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode('shift-app-authenticated'));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function isValidSessionToken(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  const expected = await computeSessionToken();
  return token === expected;
}
