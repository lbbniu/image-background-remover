// 登出 — 清除 session cookie
import { clearAuthCookie } from '../../lib/auth.js';

export async function onRequestGet(context) {
  const url = new URL(context.request.url);

  return new Response(null, {
    status: 302,
    headers: {
      'Location': `${url.origin}/`,
      'Set-Cookie': clearAuthCookie(context.env.COOKIE_DOMAIN || ''),
    },
  });
}
