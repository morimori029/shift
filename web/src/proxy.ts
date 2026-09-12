import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME, isValidSessionToken } from '@/server/session';

/** 全員共通パスワードでのログインが必要なページを守るProxy。/dashboard・/login・静的アセットは対象外（誰でも閲覧可） */
export async function proxy(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const authenticated = await isValidSessionToken(token);

  if (!authenticated) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('next', req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * 以下を除く全パスに適用する:
     * - /dashboard（当日ダッシュボード、公開）
     * - /login（ログインページ自体）
     * - /_next（Next.jsの静的アセット）
     * - favicon.ico 等の静的ファイル
     */
    '/((?!dashboard|login|_next|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
