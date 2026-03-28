// Google OAuth 回调处理 — 交换 token、存入 D1、签发 JWT
import { signJWT, setAuthCookie } from '../../../lib/auth.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error || !code) {
    return Response.redirect(`${url.origin}/?error=auth_failed`, 302);
  }

  try {
    const redirectUri = `${url.origin}/api/auth/callback/google`;

    // 1. 用 authorization code 换取 tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      console.error('Token exchange failed:', await tokenRes.text());
      return Response.redirect(`${url.origin}/?error=token_failed`, 302);
    }

    const tokens = await tokenRes.json();

    // 2. 获取用户信息
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userRes.ok) {
      return Response.redirect(`${url.origin}/?error=userinfo_failed`, 302);
    }

    const googleUser = await userRes.json();

    // 3. 存入 D1 数据库（创建或更新）
    const db = env.DB;
    const existingUser = await db.prepare(
      'SELECT id FROM users WHERE google_id = ?'
    ).bind(googleUser.id).first();

    let userId;
    if (existingUser) {
      await db.prepare(
        'UPDATE users SET name = ?, avatar = ?, last_login = datetime(\'now\') WHERE google_id = ?'
      ).bind(googleUser.name, googleUser.picture, googleUser.id).run();
      userId = existingUser.id;
    } else {
      const result = await db.prepare(
        'INSERT INTO users (google_id, email, name, avatar) VALUES (?, ?, ?, ?)'
      ).bind(googleUser.id, googleUser.email, googleUser.name, googleUser.picture).run();
      userId = result.meta.last_row_id;
    }

    // 4. 签发 JWT
    const secret = env.JWT_SECRET || 'clearcut-default-secret-change-me';
    const jwt = await signJWT({
      sub: String(userId),
      email: googleUser.email,
      name: googleUser.name,
      avatar: googleUser.picture,
    }, secret);

    // 5. 设置 cookie 并重定向回首页
    return new Response(null, {
      status: 302,
      headers: {
        'Location': `${url.origin}/`,
        'Set-Cookie': setAuthCookie(jwt),
      },
    });

  } catch (err) {
    console.error('OAuth callback error:', err);
    return Response.redirect(`${url.origin}/?error=server_error`, 302);
  }
}
