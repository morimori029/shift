'use server';

import { cookies } from 'next/headers';
import { SESSION_COOKIE_NAME, computeSessionToken } from './session';

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30日

/**
 * 全ページ共通の1パスワードによる簡易認証。
 * 個人アカウント・DBのUserモデルは今後の拡張用に用意済みだが、
 * Phase 1では配線せず、環境変数 ADMIN_PASSWORD 1本での共有パスワード運用とする。
 */
export async function login(password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (password !== (process.env.ADMIN_PASSWORD ?? '')) {
    return { ok: false, error: 'パスワードが違います' };
  }
  const token = await computeSessionToken();
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: '/',
  });
  return { ok: true };
}

export async function logout(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
}
