// Google OAuth 回调处理
import { signJWT, setAuthCookie } from '../../../lib/auth.js';
import { findOrCreateOAuthUser } from '../../../lib/oauth.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error || !code) {
    return Response.redirect(`${url.origin}/?error=auth_failed`, 302);
  }

  let step = 'init';
  try {
    const redirectUri = `${url.origin}/api/auth/callback/google`;
    step = 'token_exchange';

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
      const errText = await tokenRes.text();
      console.error('Token exchange failed:', errText);
      return Response.redirect(`${url.origin}/?error=token_failed`, 302);
    }

    const tokens = await tokenRes.json();
    step = 'userinfo';

    // 2. 获取用户信息
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userRes.ok) {
      return Response.redirect(`${url.origin}/?error=userinfo_failed`, 302);
    }

    const googleUser = await userRes.json();
    step = 'db';

    // 3. 查找或创建用户（通用多平台逻辑）
    let userId = googleUser.id;
    const db = env.DB;
    if (db) {
      try {
        userId = await findOrCreateOAuthUser(db, {
          provider: 'google',
          providerId: googleUser.id,
          email: googleUser.email,
          name: googleUser.name,
          avatar: googleUser.picture,
        });
      } catch (dbErr) {
        console.error('D1 error (non-fatal):', dbErr);
      }
    }

    step = 'jwt';

    // 4. 签发 JWT
    const secret = env.JWT_SECRET || 'clearcut-default-secret-change-me';
    const jwt = await signJWT({
      sub: String(userId),
      email: googleUser.email,
      name: googleUser.name,
      avatar: googleUser.picture,
    }, secret);

    step = 'cookie';

    // 5. 设置 cookie 并重定向回首页
    return new Response(null, {
      status: 302,
      headers: {
        'Location': `${url.origin}/`,
        'Set-Cookie': setAuthCookie(jwt),
      },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`OAuth callback error at step [${step}]:`, err);
    return Response.redirect(
      `${url.origin}/?error=server_error&step=${step}&detail=${encodeURIComponent(msg.substring(0, 200))}`,
      302
    );
  }
}
